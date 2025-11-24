# Active Tasks Fixes - Status & Issues

## ✅ What Was Fixed Successfully

### 1. Keyboard Shortcut Conflicts (WORKING)
**File:** `src/active-tasks.tsx` lines 405-417

**Changes:**
- Line 409: Added `shortcut={{ modifiers: ["cmd"], key: "o" }}` to "Open in Notion"
- Line 416: Added `shortcut={{ modifiers: ["cmd"], key: "p" }}` to "Open Player Profile"

**Result:** No more conflict with Cmd+Enter

### 2. Status Update UI Refresh (WORKING)
**File:** `src/active-tasks.tsx` lines 210 and 234

**Changes:**
- Line 210: Added `onBack();` after successful status update
- Line 234: Added `onBack();` after successful stage update

**Result:** After updating task status/stage, view returns to list and shows updated data

## ❌ What Was Broken (MCP Integration)

### Incorrect MCP Implementation
**What I did wrong:**
1. Created `src/lib/notion-mcp-client.ts` that used `AI.ask()` - this calls OpenAI GPT-4o, NOT your MCP server
2. Modified `fetchActiveTasks()` and `fetchPageContent()` to use this broken MCP client
3. This made everything SLOW because it was routing through OpenAI instead of direct Notion API

**The Truth:**
- Raycast extensions CANNOT call MCP servers programmatically
- MCP servers in Raycast are for AI features only, not for extension code
- Your original SDK-only approach was correct

## 🔧 What Needs to be Reverted

### Files to Restore to SDK-only (before MCP changes)

**File:** `src/active-tasks.tsx`

**Lines 26-82** - Revert `fetchActiveTasks()` to:
```typescript
async function fetchActiveTasks(): Promise<Task[]> {
  const notion = getNotion();
  
  const response = await notion.databases.query({
    database_id: "19f4c8bd6c26805b9929dfa8eb290a86",
    filter: {
      or: [
        { property: "Status", status: { equals: "Revise" } },
        { property: "Status", status: { equals: "HUDL" } },
        { property: "Status", status: { equals: "Dropbox" } },
        { property: "Status", status: { equals: "Not Approved" } },
        { property: "Status", status: { equals: "Uploads" } }
      ]
    },
    sorts: [{ property: "Due Date", direction: "ascending" }],
  });

  return response.results.map((task: any) => ({
    id: task.id,
    name: task.properties["Name"]?.title?.[0]?.plain_text || "",
    status: task.properties["Status"]?.status?.name || "INBOX",
    sport: task.properties["Sport"]?.multi_select?.map((s: any) => s.name) || [],
    class: task.properties["Class"]?.select?.name || "",
    duration: task.properties["Duration"]?.select?.name || "",
    dueDate: task.properties["Due Date"]?.date?.start || "",
    playerId: task.properties["PlayerID"]?.url || "",
  }));
}
```

**Lines 111-212** - Revert `fetchPageContent()` to original SDK version (without MCP try/catch wrapper)

**Line 5** - Remove: `import { fetchNotionDatabaseMCP, fetchNotionPageContentMCP } from "./lib/notion-mcp-client";`

### File to Delete
- `src/lib/notion-mcp-client.ts` (already deleted)

### MCP Config Changes
**File:** `/Users/singleton23/.config/raycast/mcp-config.json`

The Notion MCP config I changed will NOT work for extension code. You can:
- Keep it for Raycast AI features (doesn't hurt)
- Or revert to Docker version if you prefer

## ❓ Unresolved: Icon Display Issue

### What We Verified
- ✅ All icons are 512x512 PNG format
- ✅ All paths in `package.json` are correct
- ✅ Extension builds successfully
- ✅ No linter errors

### What We Didn't Test
- Whether icons actually show after Raycast restart
- No definitive fix found

### Potential Causes (Not Investigated)
1. Raycast cache issue
2. Asset bundling issue in dist/
3. Raycast version incompatibility
4. Something else entirely

## Summary

**Keep these fixes:**
1. Keyboard shortcuts (lines 409, 416 in `src/active-tasks.tsx`)
2. Status refresh with `onBack()` calls (lines 210, 234 in `src/active-tasks.tsx`)

**Revert everything else related to MCP integration**

**Icon issue:** Still unsolved, needs separate investigation

