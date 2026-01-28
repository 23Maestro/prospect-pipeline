# Credential Management with Vaultwarden/Bitwarden

This guide covers setting up and using Vaultwarden (self-hosted Bitwarden) for managing Hudl credentials for student athletes.

## Overview

- **Vaultwarden**: Self-hosted Bitwarden server running on your VPS
- **Bitwarden CLI**: Command-line tool for programmatic access
- **Raycast Integration**: Fetch credentials directly from Raycast
- **Keyboard Maestro**: Auto-fill credentials into Hudl login forms

## Setup

### 1. Deploy Vaultwarden on VPS

```bash
# On your VPS
mkdir -p /srv/vaultwarden/{data,ssl}

docker run -d --name vaultwarden \
  -v /srv/vaultwarden/data:/data \
  -p 8082:80 \
  --restart=always \
  vaultwarden/server:latest
```

- Access web UI at `http://<VPS_IP>:8082`
- Create your admin account
- Document access URL and credentials securely

### 2. Install Bitwarden CLI Locally

```bash
brew install bitwarden-cli jq
```

### 3. Configure CLI

```bash
# Point to your self-hosted instance
bw config server http://<VPS_IP>:8082

# Login
bw login you@example.com

# Unlock and save session
bw unlock --raw > ~/.bw_session
chmod 600 ~/.bw_session
```

### 4. Mobile App Setup

1. Install Bitwarden iOS/Android app
2. Point to self-hosted server: `http://<VPS_IP>:8082`
3. Enable Face ID/Touch ID
4. Test sync (add item on Mac, verify on iPhone)

## Item Structure

Each athlete credential should be structured as:

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

## Usage

### Raycast Command

Use the "Fetch Athlete Credentials" command:
1. Search by athlete name or PlayerID
2. Password is automatically copied to clipboard
3. View username, password, and PlayerID

### Import Existing Credentials

Use the import script:

```bash
./scripts/import-credentials-to-vaultwarden.sh input.csv
```

CSV format (columns):
```
name, username, password, uri, playerId, class_year, sport, parent_email, dropbox_link, tags
```

Example:
```
John Smith, john.smith@example.com, password123, https://hudl.com/profile/123, PID-12345, 2027, football, parent@example.com, https://dropbox.com/..., ProspectID,2027,football
```

### Keyboard Maestro Integration

See `docs/KEYBOARD_MAESTRO_SETUP.md` for Hudl auto-login macro setup.

## Troubleshooting

### Session Expired

If you get "session expired" errors:

```bash
bw unlock --raw > ~/.bw_session
```

### CLI Not Found

Make sure Bitwarden CLI is installed:

```bash
brew install bitwarden-cli
```

### Can't Connect to Server

Verify Vaultwarden is running:

```bash
# On VPS
docker ps | grep vaultwarden

# Test connection
curl http://<VPS_IP>:8082
```

## Security Notes

- Session file (`~/.bw_session`) should have 0600 permissions
- Never commit credentials or session files to git
- Use environment variables for VPS IP/URL
- Enable 2FA on Vaultwarden admin account
- Mobile apps use same encryption as desktop (end-to-end encrypted)

