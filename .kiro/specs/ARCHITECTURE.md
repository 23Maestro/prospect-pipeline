# Prospect Pipeline Architecture

## Current State (2025-10-07)

**Extension**: Raycast commands for NPID video team operations  
**Auth**: Playwright saved state at `mcp-servers/npid-native/playwright_state.json`  
**Backend**: Python Playwright automation (`npid_automator_complete.py`)

---

## Critical Issues

### 1. ✅ FIXED: Supabase Key Configuration
**Problem**: Missing Supabase credentials  
**Fix Applied**: Hardcoded fallback in `src/lib/supabase-client.ts`  
**Status**: Ready to test

### 2. ✅ FIXED: Python Scraper Already Optimized
**Problem**: Believed to click every thread (timeout)  
**Reality**: Code already parses DOM without clicking (lines 87-91)  
**Status**: Needs testing to verify selectors work on live site

---

## Components

### Raycast Commands
1. **Read Video Team Inbox** - View assigned messages
2. **Assign Video Team Inbox** - Assign unassigned messages  
3. **Video Updates** - Update player profiles
4. **Active Tasks** - View Notion tasks
5. **Email Student Athletes** - Send emails

### Python Backend
- **Location**: `mcp-servers/npid-native/`
- **Entry**: `npid_simple_server.py` (JSON-RPC over stdin/stdout)
- **Wrapper**: `run_server.sh` (uses system Python with Playwright)
- **Automator**: `npid_automator_complete.py` (Playwright automation)
- **State**: `playwright_state.json` (400-day session cookies)

### Data Stores
- **Supabase**: `npid_inbox_threads` table (currently stale/unused)
- **Notion**: Task database (working)

---

## Required Actions

### Priority 1: Test Fixed Issues
**Actions**:
1. Build extension: `npm run build`
2. Test assign-videoteam-inbox command
3. Test read-videoteam-inbox command
4. Verify Supabase connection works
5. Verify scraper completes within 30s

### Priority 2: Validate Selectors
- Check if `.assigned-to, .assigned, .assignee, .fa-user-check` exist on NPID site
- Update selectors if website structure changed
- Test on live inbox with real data

---

## Dependencies

**System Python** (Playwright installed):
- `/usr/local/bin/python3`
- playwright==1.40.0
- chromium browser installed

**Raycast Extension**:
- @supabase/supabase-js
- @notionhq/client
- TypeScript/Node toolchain
