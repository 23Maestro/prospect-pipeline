# REFACTOR SPEC: Remove n8n & Docker Dependencies

**Status**: 🔄 IN PROGRESS (Phase 1: 70% Complete)  
**Date**: 2025-10-06  
**Priority**: HIGH  
**Linear Project**: [Prospect Pipeline](https://linear.app/23maestro/project/prospect-pipeline-7b8492242b9d)

---

## Overview

**Goal**: Complete migration from n8n/Docker architecture to direct Python/Playwright automation with Raycast as the primary interface.

---

## Current Architecture Issues

### Legacy Systems (TO BE REMOVED):
1. **n8n workflows** - Local server on port 5678
2. **Docker containers** - Playwright containerization
3. **n8n webhook endpoints** - `/webhook/assign-inbox`
4. **Saved n8n workflow JSONs** - `workflow1_updated.json`, `workflow2_updated.json`
5. **n8n documentation** - `.kiro/specs/npid-n8n-workflows/`

### Active Systems (KEEP & FIX):
1. ✅ **Python/Playwright automation** - `npid_automator_complete.py`
2. ✅ **Raycast extension** - Direct UI for NPID operations
3. ✅ **Supabase** - `npid_inbox_threads` table
4. ✅ **Saved Playwright state** - 400-day session cookie
5. ⚠️ **Python server wrapper** - `npid_simple_server.py` (needs env fix)

---

## Latest Commit Review (98a5961)

### ✅ Completed in Latest Commit:
- Replaced n8n webhook calls with direct Python process spawning
- Added proper timeout handling (30s default) for Python server calls
- Implemented incremental JSON parsing for faster response times
- Improved error handling with detailed error messages
- Both `assign-videoteam-inbox.tsx` and `read-videoteam-inbox.tsx` now use direct automation

### ⚠️ Issues Identified:
1. **Code Duplication**: `callPythonServer` function duplicated across 3 files with inconsistent implementations
2. **Hardcoded Paths**: `read-videoteam-inbox.tsx` and `video-updates.tsx` use absolute paths instead of `resolveNPIDServerPath()`
3. **video-updates.tsx Broken**: Still using old Python call pattern without timeout handling
4. **Shell Wrapper Not Integrated**: `run_server.sh` created but not being used

---

## Issues to Fix

### 1. Code Duplication (Critical) 🔴
**Problem**: `callPythonServer` function exists in 3 files with different implementations  
**Files Affected**:
- `src/assign-videoteam-inbox.tsx` (✅ Has timeout handling)
- `src/read-videoteam-inbox.tsx` (✅ Has timeout handling, ❌ hardcoded path)
- `src/video-updates.tsx` (❌ Old implementation, no timeout)

**Solution**: Create shared module `src/lib/python-server-client.ts`

### 2. video-updates.tsx Command Error 🔴 CRITICAL
**Problem**: Using old `callNPIDServer` without timeout handling  
**File**: `src/video-updates.tsx`  
**Impact**: Command will timeout and fail under load

### 3. Inconsistent Path Resolution 🟡
**Problem**: Three different approaches to finding Python server  
**Solution**: Use `resolveNPIDServerPath()` consistently across all files

### 4. Shell Wrapper Not Integrated 🟡
**Problem**: `run_server.sh` exists but not being called  
**Solution**: Update spawn calls to use bash wrapper

---

## Migration Checklist

### Phase 1: Fix Current Blocking Issues (70% Complete)
- [x] Fix Python environment path (shell wrapper created)
- [x] Replace n8n calls with direct Python spawning (2/3 files complete)
- [x] Implement timeout handling (2/3 files complete)
- [ ] **Create shared Python client module** ← NEXT
- [ ] **Fix video-updates.tsx** ← NEXT
- [ ] **Integrate shell wrapper across all files** ← NEXT
- [ ] Test all 5 commands end-to-end

### Phase 2: Remove n8n Legacy (Not Started)
- [ ] Archive n8n workflow JSONs
- [ ] Remove `.kiro/specs/npid-n8n-workflows/`
- [ ] Update main README to remove n8n references
- [ ] Remove any webhook endpoint documentation
- [ ] Check for n8n dependencies in `package.json`

### Phase 3: Optimize Current Architecture (Planned)
- [ ] Add proper error handling to Python server
- [ ] Implement video progress sync (planned feature)
- [ ] Add retry logic for Playwright operations
- [ ] Document new architecture in `.kiro/specs/`

### Phase 4: Production Readiness (Planned)
- [ ] Add logging/monitoring
- [ ] Create backup of Playwright state
- [ ] Document recovery procedures
- [ ] Add health checks for Python server

---

## New Architecture (Target State)

```
[Raycast Extension Commands]
          ↓
[Shared Python Client Module] ← NEW
          ↓
[run_server.sh (bash wrapper)] ← TO INTEGRATE
          ↓
[npid_simple_server.py]
          ↓
[npid_automator_complete.py]
          ↓
[Playwright Browser (Saved State)]
          ↓
[NPID Dashboard Website]
          ↓
[Supabase: npid_inbox_threads]
```

**Key Benefits**:
- No Docker overhead
- No n8n server management
- Direct Python-Raycast integration
- Simpler debugging
- 400-day persistent sessions
- Consistent error handling
- Shared code reduces bugs

---

## Implementation Plan

### Step 1: Create Shared Python Client (Priority 1)
**File**: `src/lib/python-server-client.ts`

**Features**:
- Centralized `callPythonServer()` function with timeout handling
- Shared `resolveNPIDServerPath()` with environment variable support
- Incremental JSON parsing
- Proper error handling and cleanup
- TypeScript types for requests/responses

**Migration Path**:
1. Create new module
2. Update `assign-videoteam-inbox.tsx` to use it
3. Update `read-videoteam-inbox.tsx` to use it
4. Update `video-updates.tsx` to use it (fixes the critical bug)
5. Delete duplicated code

### Step 2: Integrate Shell Wrapper
**Changes**:
- Update `resolveNPIDServerPath()` to prefer `run_server.sh`
- Change spawn from `python3 [script]` to `/bin/bash [wrapper]`
- Test Python environment isolation

### Step 3: End-to-End Testing
Test all commands:
- [ ] Read Video Team Inbox
- [ ] Assign Video Team Inbox
- [ ] Active Tasks
- [ ] Email Student Athletes
- [ ] Video Updates

---

## Files Status

### Keep & Maintain:
```
/mcp-servers/npid-native/
├── npid_automator_complete.py ✅
├── npid_simple_server.py ✅
├── run_server.sh ✅ (needs integration)
└── (Python environment with playwright)

/src/
├── read-videoteam-inbox.tsx ⚠️ (needs shared client)
├── assign-videoteam-inbox.tsx ⚠️ (needs shared client)
├── active-tasks.tsx ✅ (needs testing)
├── email-student-athletes.tsx ✅
└── video-updates.tsx 🔴 (BROKEN - priority fix)

/src/lib/ (TO CREATE)
└── python-server-client.ts 🆕 (shared module)

/Raycast/scout-singleton/state/
└── playwright_state.json ✅ (400-day cookie)
```

### Archive/Remove:
```
workflow1_updated.json ❌
workflow2_updated.json ❌
.kiro/specs/npid-n8n-workflows/ ❌
```

---

## Linear Issues Created

1. **PP-1**: Create shared Python client module
2. **PP-2**: Fix video-updates.tsx timeout handling
3. **PP-3**: Integrate shell wrapper across all files
4. **PP-4**: End-to-end testing of all 5 commands
5. **PP-5**: Archive n8n legacy files and documentation

---

## Testing Plan

### Manual Tests:
- [ ] Read Video Team Inbox - Load assigned messages
- [ ] Assign Video Team Inbox - Assign thread to team member
- [ ] Active Tasks - Load from Motion/Supabase
- [ ] Email Student Athletes - Send emails
- [ ] Video Updates - View/update video progress

### Integration Tests:
- [ ] Python server responds within 30s
- [ ] Playwright state persists across restarts
- [ ] Supabase writes succeed
- [ ] Error handling works correctly
- [ ] Shell wrapper provides correct Python environment

---

## Success Criteria

✅ **Complete when**:
1. All 5 Raycast commands work without errors
2. No code duplication in Python client calls
3. Shell wrapper integrated and tested
4. No n8n/Docker dependencies remain
5. Python environment issues resolved
6. Documentation updated
7. All Linear issues closed

---

## Notes

**Estimated Time to Complete Phase 1**: 2-3 hours
- Shared client module: 1 hour
- Migration of 3 files: 1 hour
- Testing: 1 hour

**Risk Assessment**: LOW
- Changes are incremental
- Each file can be migrated independently
- Shell wrapper is already created
- Python automation is proven and working

**Last Updated**: 2025-10-06 (after commit 98a5961 review)  
**Next Review**: After shared client module is created
