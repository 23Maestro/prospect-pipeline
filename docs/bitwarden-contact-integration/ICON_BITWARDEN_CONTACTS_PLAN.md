# Implementation Plan: Icon Fix → Bitwarden → Contact Integration

**Status**: Planning Phase - Ready for Research & Implementation  
**Created**: 2025-11-08

---

## Phase 1: Icon Fix (Immediate)

### 1.1 Verify Icon Files
- Check all icon paths in `package.json` match actual files in `assets/`
- Confirm `assets/prospect-pipeline.png` exists and is properly sized (512x512)
- Verify all command icons exist:
  - `assets/active-video-tasks.png`
  - `assets/assign-video-team-inbox.png`
  - `assets/read-video-team-inbox.png`
  - `assets/student-athlete-video-edits-2-resized.png`
  - `assets/video-updates.png`
  - `assets/generate-titles.png`
  - `assets/sync-notion-backfill.png`

### 1.2 Rebuild Extension
- Run `npm install` to ensure dependencies are current
- Run `npm run dev` to test icon display
- Verify all command icons show correctly in Raycast
- Check for console errors related to icons

### 1.3 Fix Any Remaining Issues
- Resize `prospect-pipeline.png` if needed (should be 512x512, currently 2048x2048)
- Update paths if any mismatches found
- Verify file permissions are correct

---

## Phase 2: Vaultwarden/Bitwarden Setup (100% Implementation)

### 2.1 Vaultwarden Deployment

**Deploy Vaultwarden on VPS:**
```bash
# On VPS
mkdir -p /srv/vaultwarden/{data,ssl}

docker run -d --name vaultwarden \
  -v /srv/vaultwarden/data:/data \
  -p 8082:80 \
  --restart=always \
  vaultwarden/server:latest
```

- Access web UI at `http://<VPS_IP>:8082`
- Create admin account
- Document access URL and credentials (store securely)
- Optional: Set up Nginx + TLS later (fine to start on port 8082)

### 2.2 Vaultwarden Item Structure

**Configure each athlete item with:**
- **Item name**: `Lastname, Firstname — <playerId>`
- **Username**: Hudl email
- **Password**: Hudl password
- **URI**: Hudl profile URL
- **Notes**: Any non-secret athlete information

**Custom fields:**
- `playerId` (text) - Primary identifier
- `class_year` (text) - e.g., "2027"
- `sport` (text) - e.g., "football"
- `parent_email` (text)
- `dropbox_link` (text)
- `pid_uid` (text) - ULID fallback if no playerId

**Tags:**
- `ProspectID` (all items)
- Year tags: `2027`, `2026`, etc.
- Sport tags: `football`, `basketball`, etc.

### 2.3 Local Bitwarden CLI Setup

**Install dependencies:**
```bash
brew install bitwarden-cli jq
```

**Configure CLI:**
```bash
bw config server http://<VPS_IP>:8082
bw login you@example.com
bw unlock --raw > ~/.bw_session
chmod 600 ~/.bw_session
```

**Test CLI access:**
- Verify `bw list items` works
- Test search: `bw list items --search "test"`
- Verify custom fields accessible via `jq`

### 2.4 Raycast Integration

**Create credential fetch command:**
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

**Update package.json:**
```json
{
  "name": "fetch-athlete-creds",
  "title": "Fetch Athlete Credentials",
  "description": "Get Hudl credentials from Vaultwarden",
  "mode": "view",
  "icon": "assets/generate-titles.png"
}
```

### 2.5 Keyboard Maestro Integration

**Create KM macro for Hudl login:**
- Macro name: "Hudl Login from Vaultwarden"
- Trigger: Hotkey or variable prompt for playerId
- Steps:
  1. Execute shell script:
     ```bash
     SESSION=$(cat ~/.bw_session)
     bw get item "$KMVAR_playerId" --session "$SESSION" | \
       jq -r '.login.username + "\n" + .login.password' > /tmp/pid_creds.txt
     ```
  2. Type keystroke: Focus username field
  3. Insert text: First line of `/tmp/pid_creds.txt`
  4. Tab to password field
  5. Insert text: Second line of `/tmp/pid_creds.txt`
  6. Cleanup: `rm /tmp/pid_creds.txt`

### 2.6 Data Import

**Create credential import script:**
- File: `scripts/import-credentials-to-vaultwarden.sh`
- Reads CSV with columns: name, username, password, uri, playerId, class_year, sport, parent_email, dropbox_link, tags
- Converts to Bitwarden CSV format
- Uses `bw import` command
- Normalizes names to "Lastname, Firstname — <playerId>"
- Handles custom fields and tags

### 2.7 Mobile App Setup

- Install Bitwarden iOS app
- Point to self-hosted server: `http://<VPS_IP>:8082`
- Enable Face ID/Touch ID
- Test sync (add item on Mac, verify on iPhone)
- Test autofill in mobile Safari

---

## Phase 3: Contact Management Integration Brainstorm

### 3.1 Requirements

- Student Athlete contacts with Parent 1 and Parent 2
- Mobile access to add/edit contacts
- Integration with Bitwarden (for credentials)
- Canonical ID: playerId

### 3.2 Integration Approach

#### eM Client with Local Database Integration

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

### 3.3 Implementation Approach

**eM Client with Local Database:**

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
   - Map eM Client fields to athlete data structure (Parent 1, Parent 2, playerId)

---

## Files to Create/Modify

### New Files:
- `src/fetch-athlete-creds.tsx` - Raycast credential fetch command
- `scripts/import-credentials-to-vaultwarden.sh` - CSV import script
- `docs/CREDENTIAL_MANAGEMENT.md` - Bitwarden setup guide
- `docs/KEYBOARD_MAESTRO_SETUP.md` - KM macro documentation
- `docs/CONTACT_MANAGEMENT_BRAINSTORM.md` - Full analysis of contact options
- `docs/EM_CLIENT_INTEGRATION_EVAL.md` - eM Client evaluation guide
- `docs/BITWARDEN_NOTION_INTEGRATION.md` - How systems link together

### Modified Files:
- `package.json` - Add fetch-athlete-creds command

---

## Testing Checklist

### Phase 1: Icon Fix
- [ ] All icons display correctly in Raycast after rebuild
- [ ] No console errors related to icons
- [ ] Main extension icon shows correctly

### Phase 2: Bitwarden Setup
- [ ] Vaultwarden accessible from Mac and iPhone
- [ ] Bitwarden CLI login and unlock work
- [ ] Raycast command fetches credentials successfully
- [ ] Password copied to clipboard
- [ ] KM macro pastes credentials into Hudl correctly
- [ ] Import script handles CSV correctly
- [ ] Mobile app syncs items automatically
- [ ] Custom fields and tags work correctly

### Phase 3: Contact Management
- [ ] Brainstorm document created
- [ ] eM Client evaluation completed
- [ ] Decision made on contact management approach
- [ ] Integration implemented (Notion or eM Client)
- [ ] Mobile access verified

---

## Security Considerations

- Store `~/.bw_session` with 0600 permissions
- Never commit Vaultwarden credentials to git
- Use environment variables for VPS IP/URL
- Enable 2FA on Vaultwarden admin account
- Document session timeout/auto-lock behavior
- Mobile apps use same encryption as desktop (end-to-end encrypted)
- If using eM Client database access, ensure proper file permissions

---

## Next Steps

1. **Immediate**: Fix icons (Phase 1)
2. **Research**: Evaluate eM Client upgrade path (check version, database location, export capabilities)
3. **Implement**: Bitwarden setup (Phase 2)
4. **Decide**: Choose contact management approach based on eM Client evaluation
5. **Implement**: Contact integration (Phase 3)

---

## Questions to Answer

1. What version of eM Client are you using? (Free/Pro, version number)
2. Where does eM Client store its database? (Check `~/Library/Application Support/eM Client/`)
3. Can you export contacts from eM Client currently?
4. Do you want to continue using eM Client with Bitwarden integration?
5. How important is real-time sync vs. periodic export?

