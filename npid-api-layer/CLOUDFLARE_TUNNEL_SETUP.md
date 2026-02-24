# Cloudflare Tunnel + Access Setup

This runbook exposes your FastAPI service at:

- `https://recruiting-api.prospectid.com`

with Cloudflare Access protection and launchd auto-start for both FastAPI and cloudflared.

## 1) Prerequisites

1. Domain `prospectid.com` managed in Cloudflare.
2. `cloudflared` installed on this Mac:
   - `brew install cloudflared`
3. FastAPI already working locally:
   - `curl http://127.0.0.1:8000/health`

## 2) Create tunnel and DNS route

Run from any shell on this Mac:

```bash
cloudflared tunnel login
cloudflared tunnel create recruiting-api
cloudflared tunnel route dns recruiting-api recruiting-api.prospectid.com
```

After `create`, Cloudflare prints a tunnel UUID and writes credentials to:

- `~/.cloudflared/<TUNNEL_UUID>.json`

## 3) Configure tunnel ingress

1. Copy template:

```bash
cp /Users/singleton23/Raycast/prospect-pipeline/npid-api-layer/cloudflared/config.yml.template \
   /Users/singleton23/Raycast/prospect-pipeline/npid-api-layer/cloudflared/config.yml
```

2. Edit `config.yml` and replace both `<REPLACE_WITH_TUNNEL_ID>` values with your real tunnel UUID.

3. Validate locally:

```bash
/Users/singleton23/Raycast/prospect-pipeline/npid-api-layer/start-cloudflared.sh
```

## 4) Configure Cloudflare Access (shared password)

In Cloudflare Zero Trust dashboard:

1. Access -> Applications -> Add application.
2. Type: Self-hosted.
3. Domain: `recruiting-api.prospectid.com`.
4. Policy action: Allow.
5. Identity selector: configure your preferred shared-password or one-time-pin flow.
6. Save and enable.

## 5) Keep both services running on reboot

### FastAPI launchd (already present)

```bash
cp /Users/singleton23/Raycast/prospect-pipeline/npid-api-layer/com.npid.fastapi.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.npid.fastapi.plist 2>/dev/null || true
launchctl load -w ~/Library/LaunchAgents/com.npid.fastapi.plist
```

### cloudflared launchd

```bash
cp /Users/singleton23/Raycast/prospect-pipeline/npid-api-layer/com.npid.cloudflared.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.npid.cloudflared.plist 2>/dev/null || true
launchctl load -w ~/Library/LaunchAgents/com.npid.cloudflared.plist
```

## 6) Verification

### Local API

```bash
curl http://127.0.0.1:8000/health
```

### External URL (after Access login)

Open:

- `https://recruiting-api.prospectid.com`

Then verify API endpoint in browser session:

- `https://recruiting-api.prospectid.com/health`

## 7) Operations (Termius quick commands)

### Restart FastAPI service

```bash
launchctl unload ~/Library/LaunchAgents/com.npid.fastapi.plist
launchctl load -w ~/Library/LaunchAgents/com.npid.fastapi.plist
```

### Restart cloudflared service

```bash
launchctl unload ~/Library/LaunchAgents/com.npid.cloudflared.plist
launchctl load -w ~/Library/LaunchAgents/com.npid.cloudflared.plist
```

### Logs

```bash
tail -f /tmp/npid-fastapi.out
tail -f /tmp/npid-fastapi.err
tail -f /tmp/cloudflared.out
tail -f /tmp/cloudflared.err
```
