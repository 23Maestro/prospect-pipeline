# Contact Management Integration Brainstorm

## Requirements

- Student Athlete contacts with Parent 1 and Parent 2
- Mobile access to add/edit contacts
- Integration with Bitwarden (for credentials)
- Canonical ID: playerId

## Integration Approach

### eM Client with Local Database Integration

**Structure:**
- eM Client has local SQLite database that can be accessed directly
- Upgrade to eM Client Pro for mobile apps (iOS/Android)
- Raycast reads eM Client's local database directly
- Bitwarden for passwords only

**Pros:**
- Already familiar with the tool
- Mobile apps available (iOS/Android)
- Unified contact management
- Direct database access - no sync needed
- No new infrastructure required

**Cons:**
- Need to locate and understand database schema
- Database may be locked when eM Client is running

**Integration:**
- Locate eM Client database: `~/Library/Application Support/eM Client/`
- Inspect SQLite database schema
- Create Raycast command to query database directly
- Link contacts to Bitwarden via playerId

---

## Recommended Approach

### eM Client with Local Database

1. **eM Client** for contact management
   - Upgrade to Pro for mobile apps
   - Use existing local SQLite database
   - Manage all contacts in eM Client

2. **Bitwarden** for credentials
   - Stores Hudl passwords
   - Links to eM Client contacts via playerId

3. **Raycast integration**
   - Command: "Get Athlete Contact" - reads eM Client database, shows contact info
   - Command: "Get Athlete Credentials" - searches Bitwarden, copies password
   - Combined command: Shows contact + credentials together

4. **Implementation steps**
   - Locate eM Client database file
   - Inspect database schema
   - Create Raycast command to query SQLite database
   - Map eM Client fields to athlete data structure

---

---

## Next Steps

1. Locate eM Client database file
2. Inspect database schema
3. Create Raycast command to query SQLite database
4. Map eM Client fields to athlete data structure
5. Link contacts to Bitwarden via playerId
6. Test database access and queries

