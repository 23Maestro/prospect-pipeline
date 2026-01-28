# Bitwarden + Notion Integration Guide

This document explains how Bitwarden (Vaultwarden) and Notion work together for managing student athlete credentials and contacts.

## Architecture Overview

```
┌─────────────┐         ┌──────────────┐
│   Notion    │────────▶│   Raycast    │
│  Contacts   │         │  Extension   │
└─────────────┘         └──────────────┘
                              │
                              │ playerId
                              ▼
                        ┌──────────────┐
                        │  Bitwarden    │
                        │  Credentials  │
                        └──────────────┘
```

## Linking Strategy

### Canonical ID: playerId

Both systems use `playerId` as the linking key:

- **Notion**: Stored in PlayerID URL property (e.g., `https://dashboard.nationalpid.com/athlete/profile/12345`)
- **Bitwarden**: Stored in custom field `playerId` (e.g., `12345`)

### Data Flow

1. **Add New Athlete**
   - Create entry in Notion with PlayerID
   - Create Bitwarden item with `playerId` custom field
   - Link via playerId

2. **Lookup Credentials**
   - Raycast searches Notion by name/PlayerID
   - Extract playerId from Notion entry
   - Search Bitwarden for item with matching `playerId` custom field
   - Return credentials

3. **Update Contact Info**
   - Update in Notion (primary source)
   - Optionally sync metadata to Bitwarden custom fields

## Raycast Commands

### Command 1: Get Athlete Contact

**Purpose**: Search Notion for athlete contact information

**Flow**:
1. User searches by name or PlayerID
2. Query Notion database
3. Display contact info (parents, school, etc.)
4. Show PlayerID link

**Implementation**:
```typescript
// Search Notion database
const response = await notion.databases.query({
  database_id: ATHLETES_DB_ID,
  filter: {
    or: [
      { property: 'Name', title: { contains: query } },
      { property: 'PlayerID', url: { contains: query } }
    ]
  }
});
```

### Command 2: Get Athlete Credentials

**Purpose**: Fetch Hudl credentials from Bitwarden

**Flow**:
1. User searches by name or PlayerID
2. Search Bitwarden items
3. Match by `playerId` custom field
4. Copy password to clipboard
5. Display username and PlayerID

**Implementation**: See `src/fetch-athlete-creds.tsx`

### Command 3: Get Athlete Contact + Credentials (Combined)

**Purpose**: Show both contact info and credentials together

**Flow**:
1. Search Notion for contact info
2. Extract playerId
3. Search Bitwarden for credentials
4. Display both in unified view

## Data Synchronization

### Manual Sync (Current)

- Add athlete in Notion
- Add credentials in Bitwarden
- Manually ensure playerId matches

### Automated Sync (Future)

**Option 1: Notion → Bitwarden**
- Script reads Notion database
- Updates Bitwarden custom fields (class_year, sport, etc.)
- Keeps metadata in sync

**Option 2: Bidirectional**
- Sync changes both ways
- More complex, requires conflict resolution

## Best Practices

1. **Always use playerId as link**
   - Never rely on name matching
   - playerId is canonical identifier

2. **Keep metadata in sync**
   - Update class_year, sport in both systems
   - Or choose one as source of truth

3. **Handle missing data gracefully**
   - Athlete may exist in Notion but not Bitwarden
   - Or vice versa
   - Show appropriate messages

4. **Security**
   - Never store passwords in Notion
   - Keep credentials only in Bitwarden
   - Use playerId to link, not passwords

## Troubleshooting

### Can't Find Credentials

**Problem**: Raycast finds Notion entry but not Bitwarden item

**Solutions**:
- Verify playerId matches exactly
- Check Bitwarden custom field name is `playerId`
- Test CLI: `bw list items --search "<playerId>"`

### playerId Mismatch

**Problem**: playerId in Notion doesn't match Bitwarden

**Solutions**:
- Extract playerId from Notion URL: `https://dashboard.nationalpid.com/athlete/profile/{playerId}`
- Verify Bitwarden custom field value matches
- Update one system to match the other

### Missing Custom Fields

**Problem**: Bitwarden item doesn't have `playerId` custom field

**Solutions**:
- Add custom field manually
- Use import script to ensure fields are set
- Update existing items via Bitwarden web UI

## Example Workflow

1. **New Athlete Assignment**
   - Receive assignment with athlete name
   - Search Notion for contact info
   - Get PlayerID from Notion
   - Fetch credentials from Bitwarden using PlayerID
   - Login to Hudl with credentials

2. **Update Contact Info**
   - Edit in Notion (mobile or desktop)
   - Changes sync automatically
   - Credentials remain in Bitwarden

3. **Add New Credentials**
   - Create Bitwarden item
   - Set `playerId` custom field
   - Link to Notion entry via PlayerID

