# NPID n8n Workflows - Spec

## Status: ✅ DEPLOYED & CONCURRENT

**Phase**: Production  
**Last Updated**: 2025-10-05 @ 3:22 AM  
**Owner**: Jerami Singleton | prospect.id automation

---

## Overview

Autonomous NPID inbox scraper and assignment handler using Playwright + n8n + Supabase.

**Key Features:**
- ✅ Fully autonomous (400+ day session via saved Playwright state)
- ✅ No manual cookie management
- ✅ Runs every 90 minutes
- ✅ Webhook-triggered assignments
- ✅ Supabase integration for thread tracking

---

## Architecture

```
[NPID Website] 
    ↓
[Playwright (Saved State)]
    ↓
[n8n Workflows]
    ├─ Workflow 1: Inbox Scraper (Schedule: 90min)
    └─ Workflow 2: Assignment Handler (Webhook)
    ↓
[Supabase: npid_inbox_threads]
    ↓
[Raycast Extension / External Apps]
```

---

## Workflows

### **Workflow 1: NPID Inbox Scraper (CONCURRENT)**
- **ID**: `SACtUFzibc8mSgDw`
- **Name**: `pipeline.n8n_INBOX1`
- **Trigger**: Schedule (every 90 minutes)
- **Function**: Scrapes inbox, extracts threads, saves to Supabase
- **Status**: ✅ Active
- **Method**: Execute Command → Playwright (bypasses Code node sandbox)

**Nodes:**
1. Schedule Trigger (90 min)
2. Execute Playwright: Fetch Inbox (uses saved state from `/Users/singleton23/Raycast/scout-singleton/state/playwright_state.json`)
3. Parse Inbox Threads (regex extraction)
4. Has Threads? (filter)
5. Create in Supabase (npid_inbox_threads)
6. Log Summary

### **Workflow 2: NPID Assignment Handler (CONCURRENT)**
- **ID**: `dbhOsJw3IRUc9qO6`
- **Name**: `pipeline.n8n_ASSIGN2`
- **Trigger**: Webhook POST `/webhook/assign-inbox`
- **Function**: Assigns threads to video team members via Playwright
- **Status**: ✅ Active
- **Method**: Execute Command → Playwright (bypasses Code node sandbox)

**Webhook URL:**
```
http://localhost:5678/webhook/assign-inbox
```

**Payload:**
```json
{
  "thread_id": "message_id12403",
  "owner": "user@example.com",
  "contact": "athlete@example.com",
  "stage": "In Queue",
  "status": "HUDL"
}
```

**Nodes:**
1. Webhook Trigger (`/webhook/assign-inbox`)
2. Validate Payload (thread_id & owner required)
3. Execute Playwright: Assign Thread (uses saved state from `/Users/singleton23/Raycast/scout-singleton/state/playwright_state.json`)
4. Update Supabase (set can_assign=false, assigned_at=NOW())
5. Respond Success/Error (JSON response)

---

## Credentials

### **n8n API**
- **Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (see credentials.md)
- **URL**: http://localhost:5678

### **Supabase NPID**
- **Host**: `nmsynhztuelwxjlwezpn.supabase.co`
- **Key Type**: Service Role (or Anon for testing)
- **Table**: `npid_inbox_threads`

### **Playwright Saved State**
- **Location**: `/Users/singleton23/Raycast/scout-singleton/state/playwright_state.json`
- **Cookie**: `remember_82e5d2c56bdd0811318f0cf078b78bfc`
- **Expiry**: 400+ days (until ~2027)
- **Embedded**: Yes (hardcoded in both workflows)

---

## Database Schema

### **Supabase Table: npid_inbox_threads**

```sql
CREATE TABLE npid_inbox_threads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT,
  email TEXT,
  timestamp TEXT,
  can_assign BOOLEAN DEFAULT true,
  assigned_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_can_assign ON npid_inbox_threads(can_assign);
```

---

## Integration Points

### **1. Raycast Extension → n8n Webhook**
Raycast triggers assignments via n8n webhook:
```typescript
// In src/assign-videoteam-inbox.tsx
const response = await fetch('http://localhost:5678/webhook/assign-inbox', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    thread_id: messageId,
    owner: assignee,
    stage: 'In Queue',
    status: 'HUDL'
  })
});

const result = await response.json();
console.log('Assignment result:', result);
```

### **2. Raycast Extension → Supabase Direct**
Raycast reads assignable threads directly from Supabase:
```typescript
// In src/lib/supabase-client.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://nmsynhztuelwxjlwezpn.supabase.co',
  process.env.SUPABASE_KEY
);

// Get assignable threads
const { data: threads } = await supabase
  .from('npid_inbox_threads')
  .select('*')
  .eq('can_assign', true)
  .order('timestamp', { ascending: false });
```

---

## Monitoring

### **n8n Executions**
- URL: http://localhost:5678/executions
- Check workflow runs, errors, execution times

### **Supabase Dashboard**
- URL: https://supabase.com/dashboard/project/nmsynhztuelwxjlwezpn/editor
- View thread data, assignment status

### **Logs**
- n8n console logs show Playwright actions
- Check for "Session expired" errors (unlikely with 400-day cookie)

---

## Troubleshooting

### **Issue: Playwright session expired**
**Unlikely** (400-day cookie), but if it happens:

1. Regenerate saved state:
```bash
cd ~/Raycast/scout-singleton
python tests/test_playwright_mcp.py
```

2. Copy new state:
```bash
cat ~/Raycast/scout-singleton/state/playwright_state.json
```

3. Update `savedState` variable in both workflow code nodes

### **Issue: Supabase connection failed**
- Check service role key in n8n credentials
- Verify table exists: `npid_inbox_threads`
- Check Supabase project status

### **Issue: Webhook not responding**
- Verify workflow is **Active**
- Check n8n is running: `lsof -i :5678`
- Test with curl (see examples above)

---

## Next Steps

- [ ] Add error notifications (Slack/Email)
- [ ] Track assignment metrics
- [ ] Add more NPID operations (video progress, athlete updates)
- [ ] Deploy n8n to production server
- [ ] Add rate limiting/retry logic

---

## Files

```
/Users/singleton23/Raycast/prospect-pipeline/
├── .kiro/specs/npid-n8n-workflows/
│   ├── README.md (this file - updated 2025-10-05 @ 3:22 AM)
│   └── credentials.md
├── src/
│   ├── assign-videoteam-inbox.tsx (Raycast → n8n webhook)
│   ├── lib/supabase-client.ts (Raycast → Supabase direct)
│   └── types/video-team.ts (TypeScript types)
└── README.md (main project README)

/Users/singleton23/Raycast/scout-singleton/
└── state/playwright_state.json (400-day NPID session)

n8n Workflows (localhost:5678):
├── pipeline.n8n_INBOX1 (ID: SACtUFzibc8mSgDw) ✅ Active
└── pipeline.n8n_ASSIGN2 (ID: dbhOsJw3IRUc9qO6) ✅ Active
```

---

## Status Summary

**Last Validated**: 2025-10-05 @ 3:22 AM  
**Status**: ✅ Production Ready & Concurrent  
**Architecture**: Raycast (Lead) → n8n (Router) → Supabase (Database)  
**Playwright**: Execute Command nodes (bypasses Code sandbox)  
**Session**: 400+ day cookie (no re-auth until ~2027)  
**Deployment**: Local (localhost:5678)  

**Ready to rip through assignments!** 🚀
