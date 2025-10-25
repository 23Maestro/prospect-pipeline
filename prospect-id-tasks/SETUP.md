# Setup Guide - Video Pipeline Kanban

Complete setup instructions to replace Notion with this custom Kanban board.

## Prerequisites

- Node.js 20+
- Python 3.13+
- Supabase account
- MCP Gateway running (for database access)
- NPID account credentials
- Gemini API key (for Related Tasks feature)

## Step 1: Database Setup

### 1.1 Create Supabase Project
1. Go to https://supabase.com
2. Create a new project
3. Copy your project URL and anon key

### 1.2 Run Database Schema
1. Open Supabase SQL Editor
2. Copy contents of `supabase-schema.sql`
3. Execute the SQL
4. Verify tables created: `athletes`, `tasks`

## Step 2: Get Gemini API Key

1. Go to https://ai.google.dev/
2. Click "Get API Key"
3. Create a new API key
4. Copy the key (starts with `AIza...`)

## Step 3: Environment Configuration

### 3.1 Create .env.local
```bash
cp .env.example .env.local
```

### 3.2 Fill in Environment Variables
```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://nmsynhztuelwxjlwezpn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
NEXT_PUBLIC_MCP_GATEWAY_URL=http://127.0.0.1:8812
PYTHON_SERVER_URL=http://localhost:5000
NPID_EMAIL=jsingleton@prospectid.com
NPID_PASSWORD=your_password_here
GEMINI_API_KEY=AIza...your_key_here
```

## Step 4: Install Dependencies

### 4.1 Node.js Dependencies
```bash
npm install
```

### 4.2 Python Dependencies
```bash
cd python-server
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Step 5: Start Development Servers

### Terminal 1: MCP Gateway (if not running)
```bash
# Your existing MCP gateway should be running on port 8812
# Check with: curl http://127.0.0.1:8812/health
```

### Terminal 2: Python Email Server
```bash
cd python-server
source venv/bin/activate
python server.py
# Should start on http://localhost:5000
```

### Terminal 3: Next.js Dev Server
```bash
npm run dev
# Should start on http://localhost:3000
```

## Step 6: Verify Setup

### 6.1 Test Database Connection
```bash
curl http://127.0.0.1:8812/mcp-call \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "server": "supabase",
    "tool": "select",
    "arguments": {"table": "athletes", "limit": 5}
  }'
```

### 6.2 Test Python Server
```bash
curl http://localhost:5000/health
# Should return: {"status": "ok", "service": "npid-email-server"}
```

### 6.3 Open Kanban Board
Navigate to http://localhost:3000

You should see:
- 6 columns (HUDL, Dropbox, Not Approved, Revise, Upload, Done)
- Sample tasks (if you ran the SQL inserts)
- Drag-and-drop working

### 6.4 Test Embeddings (Optional)
```bash
# Generate embedding for a task
curl http://localhost:3000/api/tasks/{task-id}/generate-embedding -X POST
```

## Step 7: Supabase MCP Configuration

Make sure your MCP server config includes Supabase:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-supabase"],
      "env": {
        "SUPABASE_URL": "https://nmsynhztuelwxjlwezpn.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your_service_role_key_here"
      }
    }
  }
}
```

## Step 8: Generate Embeddings for Existing Tasks

To enable "Related Tasks" feature, generate embeddings:

```bash
# Backfill all tasks (run once)
curl http://localhost:3000/api/tasks -X GET | jq -r '.tasks[].id' | while read id; do
  curl http://localhost:3000/api/tasks/$id/generate-embedding -X POST
  echo "Generated embedding for task $id"
done
```

## Step 9: Test Email Workflow

### 9.1 Drag Task to "Done"
1. Open Kanban at http://localhost:3000
2. Drag a task to "Done" column
3. Check Python server logs for email attempt

### 9.2 Manual Email Test
```bash
curl http://localhost:5000/send-email \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "athlete_name": "Test Athlete",
    "template_name": "Editing Done"
  }'
```

## Features Overview

### ✅ Drag & Drop
- Move tasks between columns (HUDL → Dropbox → Revise → Done)
- Optimistic updates (instant UI feedback)
- Auto-saves to database via MCP

### ✅ Task Details
- Click any task to see full details
- View athlete information
- See YouTube links, notes, due dates

### ✅ Related Tasks (Powered by Gemini)
- Semantic similarity using pgvector
- Shows 8 most similar tasks
- Based on content, sport, athlete

### ✅ Automatic Emails
- When task moved to "Done" → sends "Editing Done" email
- Uses existing NPID Python client
- No manual email sending needed

### ✅ Real-time Updates (Future)
- Supabase Realtime subscriptions
- See changes from other users instantly
- No page refresh needed

## Deployment

### Railway (Recommended)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Deploy
railway up
```

**Environment variables to set in Railway:**
- All variables from `.env.local`
- Set `PYTHON_SERVER_URL` to Railway internal URL

### Vercel + Fly.io

**Vercel:** Next.js app
```bash
vercel
```

**Fly.io:** Python server
```bash
cd python-server
fly launch
```

## Troubleshooting

### Related Tasks Not Showing
- Check Gemini API key is valid
- Run embedding generation endpoint
- Verify `embedding` column populated in database

### MCP Connection Failed
- Ensure MCP gateway running: `curl http://127.0.0.1:8812/health`
- Check Supabase MCP server configured
- Verify `NEXT_PUBLIC_MCP_GATEWAY_URL`

### Email Not Sending
- Check Python server logs
- Verify NPID credentials
- Test with manual curl request

## Success Checklist

- [ ] Database schema created
- [ ] Environment variables set
- [ ] MCP Gateway connected
- [ ] Python server running
- [ ] Next.js dev server running
- [ ] Gemini API key configured
- [ ] Kanban board loads
- [ ] Drag-and-drop works
- [ ] Task details open
- [ ] Related tasks showing
- [ ] Email sent on "Done" status

**Notion is now replaced! 🎉**
