in. <!-- 6249917c-588a-43f8-a356-d684a3e2d19e 87b2efe3-303a-4438-a805-ba5aa6b2d271 -->
# Implementation Plan: Icon Fix → Bitwarden → Contact Integration Brainstorm

## Phase 1: Icon Fix (Immediate)

1. **Verify icon files exist**

   - Check all icon paths in `package.json` match actual files in `assets/`
   - Confirm `assets/prospect-pipeline.png` exists and is properly sized

2. **Rebuild extension**

   - Run `npm install` to ensure dependencies are current
   - Run `npm run dev` to test icon display
   - Verify all command icons show correctly in Raycast

3. **Fix any remaining icon issues**

   - Resize `prospect-pipeline.png` if needed (should be 512x512)
   - Update paths if any mismatches found

## Phase 2: Vaultwarden/Bitwarden Setup (100% Implementation)

### 2.1 Vaultwarden Deployment

4. **Deploy Vaultwarden on VPS**

   - Create Docker container: `docker run -d --name vaultwarden -v /srv/vaultwarden/data:/data -p 8082:80 --restart=always vaultwarden/server:latest`
   - Access web UI at `http://<VPS_IP>:8082`
   - Create admin account
   - Document access URL and credentials (store securely)

5. **Configure Vaultwarden item structure**

   - Item name: `Lastname, Firstname — <playerId>`
   - Username: Hudl email
   - Password: Hudl password
   - URI: Hudl profile URL
   - Notes: Non-secret athlete info
   - Custom fields:
     - `playerId` (text)
     - `class_year` (text, e.g., "2027")
     - `sport` (text, e.g., "football")
     - `parent_email` (text)
     - `dropbox_link` (text)
     - `pid_uid` (text, ULID fallback)
   - Tags: `ProspectID`, year tags (`2027`, `2026`), sport tags

### 2.2 Local Bitwarden CLI Setup

6. **Install Bitwarden CLI**

   - `brew install bitwarden-cli jq`
   - Configure: `bw config server http://<VPS_IP>:8082`
   - Login: `bw login you@example.com`
   - Unlock and save session: `bw unlock --raw > ~/.bw_session`
   - Set permissions: `chmod 600 ~/.bw_session`

7. **Test CLI access**

   - Verify `bw list items` works
   - Test search: `bw list items --search "test"`
   - Verify custom fields accessible via `jq`

### 2.3 Raycast Integration

8. **Create Raycast credential fetch command**

   - New file: `src/fetch-athlete-creds.tsx`
   - Command: "Fetch Athlete Credentials"
   - Input: Athlete name or playerId
   - Functionality:
     - Reads `~/.bw_session`
     - Searches Vaultwarden via `bw list items --search`
     - Extracts playerId, username, password
     - Copies password to clipboard
     - Shows success toast with playerId and username
   - Error handling for no matches, session expired

9. **Update package.json**

   - Add command entry:
     ```json
     {
       "name": "fetch-athlete-creds",
       "title": "Fetch Athlete Credentials",
       "description": "Get Hudl credentials from Vaultwarden",
       "mode": "view",
       "icon": "assets/generate-titles.png"
     }
     ```


### 2.4 Keyboard Maestro Integration

10. **Create KM macro for Hudl login**

    - Macro name: "Hudl Login from Vaultwarden"
    - Trigger: Hotkey or variable prompt for playerId
    - Steps:

      1. Execute shell script:
         ```bash
         SESSION=$(cat ~/.bw_session)
         bw get item "$KMVAR_playerId" --session "$SESSION" | \
           jq -r '.login.username + "\n" + .login.password' > /tmp/pid_creds.txt
         ```

      1. Type keystroke: Focus username field
      2. Insert text: First line of `/tmp/pid_creds.txt`
      3. Tab to password field
      4. Insert text: Second line of `/tmp/pid_creds.txt`
      5. Cleanup: `rm /tmp/pid_creds.txt`

    - Document macro steps in `docs/KEYBOARD_MAESTRO_SETUP.md`

### 2.5 Data Import

11. **Create credential import script**

    - File: `scripts/import-credentials-to-vaultwarden.sh`
    - Reads CSV with columns: name, username, password, uri, playerId, class_year, sport, parent_email, dropbox_link, tags
    - Converts to Bitwarden CSV format
    - Uses `bw import` command
    - Normalizes names to "Lastname, Firstname — <playerId>"
    - Handles custom fields and tags

12. **Mobile app setup**

    - Install Bitwarden iOS app
    - Point to self-hosted server: `http://<VPS_IP>:8082`
    - Enable Face ID/Touch ID
    - Test sync (add item on Mac, verify on iPhone)
    - Test autofill in mobile Safari

## Phase 3: Contact Management Integration Brainstorm

### 3.1 Requirements

- Student Athlete contacts with Parent 1 and Parent 2
- Mobile access to add/edit contacts
- Integration with Bitwarden (for credentials)
- Canonical ID: playerId

### 3.2 Integration Approaches (Brainstorm)

**Option A: Notion as Source of Truth**

- Create "Student Athletes" database in Notion
- Fields: Name, playerId, sport, class_year, Parent 1 (name/email/phone), Parent 2 (name/email/phone)
- Bitwarden item links via playerId (stored in Notion notes or custom field)
- Pros: Single source, mobile app, already using Notion
- Cons: Notion not ideal for contact management, password storage still in Bitwarden
- Integration: Raycast reads Notion, fetches password from Bitwarden when needed

**Option B: Hybrid - Notion + Bitwarden Direct**

- Notion: Athlete metadata (name, playerId, sport, parents)
- Bitwarden: Credentials + same metadata in custom fields
- Raycast: Search Notion for contact info, fetch password from Bitwarden
- Pros: Uses existing tools, minimal new infrastructure
- Cons: Some duplication, Notion mobile app for contacts

**Option C: eM Client Upgrade + Integration (SIMPLEST?)**

**eM Client Pro Features:**
- Mobile apps for iOS/Android (contacts, tasks, calendar, notes)
- Unified contact management
- Syncs with Exchange, Gmail, Office 365
- You're already using it

**Integration Approaches:**
1. **Direct DB access**: Raycast reads eM Client's local SQLite database
   - Location: `~/Library/Application Support/eM Client/` (likely)
   - Requires finding database file and schema
   - Pros: Direct access, no sync needed
   - Cons: Need to reverse-engineer database structure

2. **Export/Sync**: Export contacts to CSV/vCard (if needed)
   - Use eM Client's export feature
   - Periodic export for backups
   - Pros: Simple, uses existing export
   - Cons: Not real-time, manual or scheduled sync

3. **Script bridge**: Python script reads eM Client DB, exposes via API
   - Reads SQLite database
   - Exposes REST API for Raycast
   - Pros: Programmatic access, can add features
   - Cons: Need to maintain script, another service

**Pros of eM Client Path:**
- Already familiar with the tool
- Mobile apps available (iOS/Android)
- Unified contact management
- No new infrastructure needed
- Potentially simplest solution

**Cons:**
- Need to solve Raycast integration (database access or export)
- No direct Bitwarden integration
- May need to maintain sync scripts
- eM Client database structure may be complex

**Evaluation Needed:**
1. What version of eM Client are you currently using?
2. Is it the free or Pro version?
3. Where does eM Client store contacts? (Check: `~/Library/Application Support/eM Client/` or similar)
4. Can you export contacts to CSV/vCard currently?
5. Does eM Client Pro have better export/API features?

**If Upgrading eM Client Works:**
- Upgrade to latest Pro version (mobile apps, better contact management)
- Find eM Client database location
- Create Raycast command that reads eM Client database directly
- Bitwarden still handles passwords separately

### 3.3 Recommended Approach (Soft Recommendation)

**Hybrid Approach (Option B Enhanced):**

1. **Notion** as primary contact database

   - "Student Athletes" database with all contact fields
   - Mobile app for adding/editing
   - Links to tasks via playerId

2. **Bitwarden** for credentials

   - Stores Hudl passwords
   - Custom fields mirror key Notion data (playerId, class_year, sport)
   - Links via playerId

3. **Raycast integration**

   - Command: "Get Athlete Contact" - searches Notion, shows contact info
   - Command: "Get Athlete Credentials" - searches Bitwarden, copies password
   - Combined command: Shows contact + credentials together

4. **Sync strategy**

   - Manual: Add athlete in Notion, add credentials in Bitwarden, link via playerId
   - Automated (future): Script to sync playerId between systems

**Alternative: eM Client Path (if evaluation shows it's simpler)**
- Upgrade eM Client to Pro
- Use eM Client for all contact management (mobile apps)
- Direct database access from Raycast extension
- Bitwarden for passwords only

**Files to Create (Documentation Only):**

- `docs/CONTACT_MANAGEMENT_BRAINSTORM.md` - Full analysis of options
- `docs/EM_CLIENT_INTEGRATION_EVAL.md` - eM Client evaluation guide
- `docs/BITWARDEN_NOTION_INTEGRATION.md` - How systems link together

## Files to Create/Modify

**New Files:**

- `src/fetch-athlete-creds.tsx`
- `scripts/import-credentials-to-vaultwarden.sh`
- `docs/CREDENTIAL_MANAGEMENT.md`
- `docs/KEYBOARD_MAESTRO_SETUP.md`
- `docs/CONTACT_MANAGEMENT_BRAINSTORM.md`
- `docs/EM_CLIENT_INTEGRATION_EVAL.md`
- `docs/BITWARDEN_NOTION_INTEGRATION.md`

**Modified Files:**

- `package.json` (add fetch-athlete-creds command)

## Testing Checklist

**Phase 1:**

- [ ] All icons display correctly in Raycast after rebuild
- [ ] No console errors related to icons

**Phase 2:**

- [ ] Vaultwarden accessible from Mac and iPhone
- [ ] Bitwarden CLI login and unlock work
- [ ] Raycast command fetches credentials successfully
- [ ] Password copied to clipboard
- [ ] KM macro pastes credentials into Hudl correctly
- [ ] Import script handles CSV correctly
- [ ] Mobile app syncs items automatically

**Phase 3:**

- [ ] Brainstorm document created
- [ ] eM Client evaluation completed
- [ ] Decision made on contact management approach
- [ ] Integration implemented (Notion or eM Client)

