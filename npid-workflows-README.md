# NPID Video Team Automation - n8n Workflows

## 📋 Workflows Created

### **pipeline.n8n.w_flow1** - NPID Inbox Scraper
- **Purpose**: Scrape videomailbox inbox every 90 minutes
- **Detects**: Assignable threads (has #assignvideoteam button)
- **Output**: Stores threads in Supabase with `can_assign` flag

### **pipeline.n8n.w_flow2** - Playwright Assignment Handler
- **Purpose**: Automate assignment via Playwright browser automation
- **Trigger**: Webhook from Raycast
- **Actions**: Click buttons, fill forms, update Supabase

---

## 🚀 Import Instructions

### 1. Open n8n
Navigate to: http://localhost:5678

### 2. Import Workflow 1 (Inbox Scraper)
1. Click **Import from File**
2. Select: `pipeline.n8n.w_flow1.json`
3. Update credentials:
   - **HTTP Request node**: Select "NPID Session Cookies"
   - **Supabase node**: Select "Supabase NPID"
4. Save workflow

### 3. Import Workflow 2 (Assignment Handler)
1. Click **Import from File**
2. Select: `pipeline.n8n.w_flow2.json`
3. Update credentials:
   - **Supabase node**: Select "Supabase NPID"
4. Note the webhook URL (will be like: `http://localhost:5678/webhook/assign-inbox`)
5. Save workflow

---

## ✅ Prerequisites

### **n8n Credentials Setup**

**1. NPID Session Cookies** (Header Auth)
```json
{
  "Cookie": "YOUR_FULL_COOKIE_STRING",
  "X-XSRF-TOKEN": "YOUR_XSRF_TOKEN_VALUE"
}
```

**2. Supabase NPID**
- Host: `nmsynhztuelwxjlwezpn.supabase.co`
- Service Role Key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### **Supabase Table**
Table `npid_inbox_threads` must exist with columns:
- `id` (TEXT, PRIMARY KEY)
- `name` (TEXT)
- `subject` (TEXT)
- `email` (TEXT)
- `timestamp` (TEXT)
- `can_assign` (BOOLEAN)
- `assigned_at` (TIMESTAMP)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

---

## 🧪 Testing

### Test Workflow 1 (Scraper)
1. Open workflow in n8n
2. Click **Execute Workflow** (manual trigger)
3. Check execution log for:
   - `✅ Parsed X threads`
   - `📊 Assignable: X`
4. Verify Supabase has new rows

### Test Workflow 2 (Assignment)
```bash
curl -X POST http://localhost:5678/webhook/assign-inbox \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": "message_id_test",
    "owner": "Jerami Singleton",
    "contact": "Test Contact",
    "stage": "In Queue",
    "status": "Pending"
  }'
```

---

## 🔧 Troubleshooting

### Cheerio Error
✅ **Fixed** - Using regex-based parsing instead

### 401/403 from NPID
- Re-extract cookies from Chrome DevTools
- Update "NPID Session Cookies" credential

### Playwright Not Found
- Already installed via n8n's langchain package
- Available at: `require('playwright')`

### No Threads Parsed
- Check HTML selectors in "Parse Inbox Threads" node
- NPID may have changed HTML structure
- Add console.log to debug

---

## 📂 File Structure

```
/Users/singleton23/npid-automation/
├── pipeline.n8n.w_flow1.json  (Inbox Scraper)
├── pipeline.n8n.w_flow2.json  (Assignment Handler)
└── README.md                   (This file)
```

---

## 🎯 Integration with Raycast

Update your Raycast extension to call the webhook:

```typescript
// In assign-videoteam-inbox.tsx
const assignToNPID = async (threadId: string, owner: string, contact: string, stage: string, status: string) => {
  const response = await fetch('http://localhost:5678/webhook/assign-inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      thread_id: threadId,
      owner,
      contact,
      stage,
      status
    })
  });
  
  return await response.json();
};
```

---

## 📝 Next Steps

1. ✅ Import both workflows
2. ✅ Set up credentials
3. ✅ Test Workflow 1 manually
4. ✅ Test Workflow 2 via curl
5. ⏳ Activate Workflow 1 (auto-runs every 90 min)
6. ⏳ Update Raycast to call Workflow 2 webhook
7. ⏳ Test end-to-end flow

---

**Created**: October 2, 2025  
**Last Updated**: October 2, 2025
