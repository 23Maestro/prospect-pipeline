# Contact Resolution Rules for Video Team Assignment

## CRITICAL: Contact Type Determination

**This rule is MANDATORY and must NEVER be violated.**

When assigning video team inbox messages, the system must determine whether the message is from:
- **Student Athlete** (the player themselves)
- **Parent** (parent/guardian of the player)

### The Rule

```
IF contact data exists for "athlete" search:
  → Message is from STUDENT ATHLETE
  → Use "athlete" contact results

ELSE IF no contact data found for "athlete":
  → Message is from PARENT
  → Search for "parent" and use those results

ELSE IF no contact data found at all:
  → Show toast: "Search manually on NPID website (not video progress - that's assignment modal only)"
  → Use fallback contact data from modal if available
```

### Why This Matters

When contact data is missing or incomplete, the system MUST automatically fall back to searching for parents. This prevents:

1. **Data Loss**: Not being able to assign messages because athlete data is incomplete
2. **Manual Work**: Having to manually select "parent" from a dropdown every time
3. **Assignment Failures**: Messages getting stuck in the inbox because no contact was found

### IMPORTANT: Video Progress vs Website Search

- **Video Progress Search**: ONLY used in assignment modal for Student Athletes
- **Website Search**: For manual contact lookup when automated search fails

Never confuse these two - they are completely different search systems.

### Implementation

The logic is implemented in `src/lib/npid-mcp-adapter.ts:39-75`:

```typescript
export async function resolveContactsForAssignment(
  searchValue: string,
  defaultSearchFor: VideoTeamSearchCategory
): Promise<{ contacts: VideoTeamContact[]; searchForUsed: VideoTeamSearchCategory }> {
  // STEP 1: Always try athlete first
  let contacts = await callPythonServer<VideoTeamContact[]>("search_contacts", {
    query: searchValue,
    search_type: defaultSearchFor,
  });

  // STEP 2: If no results and we searched for athlete, fallback to parent
  if (contacts.length === 0 && defaultSearchFor === 'athlete') {
    contacts = await callPythonServer<VideoTeamContact[]>("search_contacts", {
      query: searchValue,
      search_type: 'parent',
    });

    if (contacts.length > 0) {
      return { contacts, searchForUsed: 'parent' };
    }
  }

  // STEP 3: Return whatever we found
  return { contacts, searchForUsed: defaultSearchFor };
}
```

Toast message on failure in `src/assign-videoteam-inbox.tsx:392-397`:

```typescript
if (contactPool.length === 0) {
  toast.style = Toast.Style.Failure;
  toast.title = 'No contacts found';
  toast.message = 'Search manually on NPID website (not video progress - that\'s assignment modal only)';
  return;
}
```

### Testing Requirements

Any changes to the assignment flow MUST be tested with:

1. **Student Athlete message**: Message where athlete contact exists
   - Expected: Search finds athlete, uses "athlete" type

2. **Parent message**: Message where athlete contact does NOT exist, but parent exists
   - Expected: Search finds no athlete, automatically searches parent, uses "parent" type

3. **Unknown contact**: Message where neither athlete nor parent exists
   - Expected: Shows helpful toast directing to manual website search, falls back to embedded contact data from modal if available

### Historical Context

This rule was established because the assignment workflow was repeatedly breaking when:
- New athletes were added but their full contact data wasn't synced
- Parents emailed from addresses not yet in the system
- Contact search would fail and require manual dropdown selection every time

The automatic fallback to "parent" eliminates this friction and ensures messages can always be assigned.

## Related Files

- `src/assign-videoteam-inbox.tsx`: Assignment UI and workflow (line 392-397 for toast)
- `src/lib/npid-mcp-adapter.ts`: Contact resolution logic (line 39-75)
- `src/types/video-team.ts`: Type definitions for contacts

## Last Updated

2025-01-14: Initial creation to prevent regression of contact fallback logic
