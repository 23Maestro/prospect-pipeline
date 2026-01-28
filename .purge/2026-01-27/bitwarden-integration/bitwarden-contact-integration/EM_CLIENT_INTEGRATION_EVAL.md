# eM Client Integration Evaluation

This document helps evaluate whether upgrading eM Client and integrating it with Raycast is a viable solution for contact management.

## Quick Check Questions

Answer these questions to determine if eM Client integration is feasible:

1. **What version of eM Client are you currently using?**
   - Free version: Limited features, no mobile apps
   - Pro version: Full features, mobile apps available

2. **Is it the free or Pro version?**
   - Free: May need to upgrade for mobile access
   - Pro: Already has mobile apps

3. **Where does eM Client store contacts?**
   - Check: `~/Library/Application Support/eM Client/`
   - Look for database files (SQLite, .db, .sqlite)
   - May be in subdirectories like `Database/` or `Data/`

4. **Can you export contacts to CSV/vCard currently?**
   - Test: File → Export → Contacts
   - Check available formats
   - Note export options

5. **Does eM Client Pro have better export/API features?**
   - Check Pro features list
   - Look for API or automation capabilities

## Database Location Investigation

### macOS Location
```bash
# Check default location
ls -la ~/Library/Application\ Support/eM\ Client/

# Look for database files
find ~/Library/Application\ Support/eM\ Client/ -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3"

# Check for contact-related files
find ~/Library/Application\ Support/eM\ Client/ -name "*contact*" -o -name "*address*"
```

### Database Structure Investigation

If you find a database file:

```bash
# Install sqlite3 if needed
brew install sqlite3

# Inspect database
sqlite3 <database_file> ".tables"
sqlite3 <database_file> ".schema contacts"
sqlite3 <database_file> "SELECT * FROM contacts LIMIT 1;"
```

## Integration Approaches

### Approach 1: Direct Database Access

**Pros:**
- Real-time access
- No sync needed
- Direct integration

**Cons:**
- Need to reverse-engineer schema
- Database may be locked when eM Client is running
- May break with eM Client updates

**Implementation:**
- Create Raycast command that reads SQLite database
- Query contacts table directly
- Extract playerId from custom fields or notes

### Approach 2: Export/Sync

**Pros:**
- Simple, uses existing export
- No database reverse-engineering
- Works with any eM Client version

**Cons:**
- Not real-time
- Manual or scheduled sync
- Need to maintain sync script

**Implementation:**
- Export contacts to CSV/vCard periodically
- Parse eM Client database directly
- Raycast reads from local SQLite database

### Approach 3: Script Bridge

**Pros:**
- Programmatic access
- Can add features
- Abstracts database complexity

**Cons:**
- Need to maintain script
- Another service to run
- More complex setup

**Implementation:**
- Python script reads eM Client database
- Exposes REST API
- Raycast calls API

## Testing Steps

1. **Find Database Location**
   ```bash
   find ~/Library/Application\ Support/eM\ Client/ -name "*.db"
   ```

2. **Inspect Database Structure**
   ```bash
   sqlite3 <db_file> ".tables"
   sqlite3 <db_file> ".schema"
   ```

3. **Test Export**
   - Export contacts to CSV
   - Check format and fields
   - Verify playerId is included

4. **Test Pro Features** (if considering upgrade)
   - Check mobile app availability
   - Test export options
   - Look for API/automation features

## Decision Matrix

| Factor | Direct DB | Export/Sync | Script Bridge |
|--------|-----------|------------|---------------|
| Complexity | Medium | Low | High |
| Real-time | Yes | No | Yes |
| Maintenance | Low | Medium | High |
| Reliability | Medium | High | Medium |
| Setup Time | Medium | Low | High |

## Recommendation

**If eM Client database is accessible and schema is simple:**
- Use Direct Database Access (Approach 1)
- Fastest integration
- Real-time access

**If database is complex or locked:**
- Use Export/Sync (Approach 2)
- More reliable
- Easier to maintain

**If you need advanced features:**
- Use Script Bridge (Approach 3)
- Most flexible
- Can add custom logic

## Next Steps

1. Run investigation commands above
2. Document findings
3. Choose integration approach
4. Implement chosen solution
5. Test with real data

