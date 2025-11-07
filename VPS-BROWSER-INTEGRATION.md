# VPS Broker + Browser Integration

## Current Status

### ✅ Working
- **VPS Broker Client**: `src/python/vps_broker_api_client.py`
  - 12 REST API endpoints for NPID video team operations
  - Session cookie persistence (`~/.vps_broker_session.pkl`)
  - Automatic CSRF token handling
  
- **TypeScript Adapter**: `src/lib/vps-broker-adapter.ts`
  - Ready to use in Raycast extension
  - Methods: `updateVideoStage`, `updateVideoStatus`, `postVideo`, `sendReply`, etc.

### 🎯 Integration Points

## 1. Authentication Flow

```
Browser (Playwright) ──> Login ──> Save Cookies ──> VPS Broker Client
                                         │
                                         ▼
                                   REST API Calls
```

**Options:**

### Option A: Manual Browser Login (Recommended for initial setup)
```bash
# User logs in via browser once
# Playwright saves cookies to ~/.vps_broker_session.pkl
# VPS broker client reuses cookies for 400 days
```

### Option B: Programmatic Login
```typescript
// VPS broker client has authenticate() method
// Extracts CSRF token automatically
// Works if valid session exists
```

## 2. Browser-Assisted Operations

Some operations benefit from browser automation:

### When to use Browser:
- **Initial Login**: Save long-lived cookies
- **Complex Forms**: Multi-step video uploads
- **Visual Confirmation**: Screenshot verification
- **MFA/Captcha**: Human interaction needed

### When to use REST API:
- **Bulk Operations**: Update multiple thread stages
- **Background Tasks**: Scheduled status updates
- **Quick Actions**: Send replies, update progress
- **Data Fetching**: Get threads, search contacts

## 3. Raycast Extension Usage

```typescript
// Example: Update video progress from extension
import { updateVideoStage, postVideo } from "./lib/vps-broker-adapter";

// Update stage (no browser needed)
await updateVideoStage("11147", "in_queue");

// Post video link (no browser needed)
await postVideo({
  contactId: "1234",
  youtubeUrl: "https://youtu.be/VIDEO_ID",
  athleteId: "5678"
});
```

## 4. Browser Integration Workflow

```
┌─────────────────────────────────────────────────────┐
│              Raycast Extension                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Action Selected → Check if browser needed         │
│         │                                           │
│         ├─ Simple API? → VPS Broker Client         │
│         │                                           │
│         └─ Complex/Visual? → Open Browser          │
│                               │                     │
│                               ├─ Playwright script  │
│                               ├─ Save cookies       │
│                               └─ Return to extension│
│                                                     │
└─────────────────────────────────────────────────────┘
```

## 5. Recommended Commands

### Create new Raycast commands:

**A. `update-video-progress.tsx`**
- Select thread from list
- Choose stage/status from dropdown
- Update via REST API (fast)

**B. `post-athlete-video.tsx`**  
- Enter athlete name, YouTube URL
- Search contact via API
- Post video via REST API

**C. `open-video-dashboard.tsx`** (Browser)
- Quick action to open browser
- Navigate to specific thread
- Manual intervention when needed

## 6. Next Steps

1. **Test VPS Broker**:
   ```bash
   cd src/python
   ./venv/bin/python3 vps_broker_api_client.py authenticate
   ```

2. **Import into Extension**:
   ```typescript
   import { updateVideoStage } from "./lib/vps-broker-adapter";
   ```

3. **Create UI Commands**:
   - Add to `package.json` commands array
   - Create `.tsx` files for each operation
   
4. **Browser Script** (if needed):
   - Copy Playwright script for login
   - Save to `src/python/vps_browser_login.py`
   - Call from extension when needed

## 7. Available VPS Operations

### Progress Tracking
- `updateVideoStage()` - Change: On Hold, In Queue, Done
- `updateVideoStatus()` - Change: Revisions, HUDL, Dropbox, etc.

### Deliverables
- `postVideo()` - Upload YouTube link to athlete profile
- `unapproveVideo()` - Remove old approved video

### Communication
- `sendReply()` - Reply to video team thread
- `getEmailTemplates()` - Load available templates

All operations work without browser - cookies provide authentication.

