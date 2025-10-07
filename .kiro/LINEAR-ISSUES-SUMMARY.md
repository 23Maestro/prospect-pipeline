# Linear Issues Summary - Prospect Pipeline

**Project**: [Prospect Pipeline](https://linear.app/23maestro/project/prospect-pipeline-7b8492242b9d)  
**Team**: 23Maestro  
**Created**: 2025-10-06  
**Total Issues**: 5

---

## 📋 Issue Overview

### Phase 1: Core Refactor (Priority 1 - Urgent)

#### [23M-11: Create shared Python client module](https://linear.app/23maestro/issue/23M-11/create-shared-python-client-module)
**Status**: Backlog  
**Priority**: Urgent (P1)  
**Estimated Time**: 1 hour  
**Labels**: Bug, Refactor

**Goal**: Extract duplicated `callPythonServer` function into shared module

**Key Tasks**:
- Create `src/lib/python-server-client.ts`
- Implement `callPythonServer(method, args, timeoutMs)` with 30s default timeout
- Implement `resolveNPIDServerPath()` with environment variable support
- Add incremental JSON parsing
- Add proper TypeScript types

**Files to Update After**:
- `src/assign-videoteam-inbox.tsx`
- `src/read-videoteam-inbox.tsx`
- `src/video-updates.tsx`

---

#### [23M-12: Fix video-updates.tsx timeout handling](https://linear.app/23maestro/issue/23M-12/fix-video-updatestsx-timeout-handling)
**Status**: Backlog  
**Priority**: Urgent (P1)  
**Estimated Time**: 30 minutes  
**Blocked By**: 23M-11

**Goal**: Fix broken video-updates command using old Python call pattern

**Key Tasks**:
- Import `callPythonServer` from shared module
- Replace all `callNPIDServer` calls
- Remove old function definition
- Test video update flow end-to-end
- Verify timeout handling (30s)

---

### Phase 2: Integration & Testing (Priority 2 - High)

#### [23M-13: Integrate shell wrapper across all files](https://linear.app/23maestro/issue/23M-13/integrate-shell-wrapper-across-all-files)
**Status**: Backlog  
**Priority**: High (P2)  
**Estimated Time**: 30 minutes

**Goal**: Use `run_server.sh` for proper Python environment isolation

**Key Changes**:
- Update `resolveNPIDServerPath()` to prefer shell wrapper
- Change spawn from `python3` to `/bin/bash`
- Ensure execute permissions on wrapper
- Test with fresh terminal (no venv activated)

---

#### [23M-14: End-to-end testing of all 5 commands](https://linear.app/23maestro/issue/23M-14/end-to-end-testing-of-all-5-commands)
**Status**: Backlog  
**Priority**: High (P2)  
**Estimated Time**: 2 hours

**Goal**: Comprehensive testing to ensure n8n removal didn't break functionality

**Commands to Test**:
1. ✅ Read Video Team Inbox
2. ✅ Assign Video Team Inbox
3. ✅ Active Tasks
4. ✅ Email Student Athletes
5. ⚠️ Video Updates (currently broken)

**Test Categories**:
- Functional tests (all commands work)
- Integration tests (Python server, Supabase, Playwright)
- Performance tests (< 30s timeout, < 2s launch)
- Error handling tests

---

### Phase 3: Cleanup (Priority 3 - Medium)

#### [23M-15: Archive n8n legacy files and documentation](https://linear.app/23maestro/issue/23M-15/archive-n8n-legacy-files-and-documentation)
**Status**: Backlog  
**Priority**: Medium (P3)  
**Estimated Time**: 1 hour  
**Blocked By**: 23M-14 (should be tested first)

**Goal**: Clean up n8n files after confirming new architecture works

**Key Tasks**:
- Create `.archive/n8n-legacy/2025-10-06/`
- Move `workflow1_updated.json`, `workflow2_updated.json`
- Move `.kiro/specs/npid-n8n-workflows/`
- Update README (remove n8n/Docker references)
- Create `.kiro/specs/architecture.md`
- Verify no n8n/webhook/docker references in codebase

---

## 🎯 Execution Order

### Recommended Workflow:

1. **Start**: 23M-11 (Create shared module) - 1 hour
   - Creates foundation for all other work
   - Enables consistent Python server calls

2. **Next**: 23M-12 (Fix video-updates) - 30 min
   - Unblocks critical command
   - Uses shared module from step 1

3. **Then**: 23M-13 (Shell wrapper integration) - 30 min
   - Ensures proper Python environment
   - Can be done in parallel with step 2

4. **After**: 23M-14 (E2E testing) - 2 hours
   - Validates all changes work
   - Must pass before cleanup

5. **Finally**: 23M-15 (Archive n8n) - 1 hour
   - Safe to remove legacy only after testing

**Total Estimated Time**: ~5 hours

---

## 📊 Progress Tracking

### Current Status
- **Phase 1**: 70% complete (commit 98a5961)
  - ✅ Timeout handling added to 2/3 files
  - ✅ n8n removed from 2/3 files
  - ❌ Code still duplicated
  - ❌ video-updates.tsx still broken

### Next Milestone
- **Complete Phase 1**: All issues 23M-11 and 23M-12 closed
- **Target**: Before end of day 2025-10-06

---

## 🔗 Dependency Graph

```
23M-11 (Create shared module)
    ↓
    ├── 23M-12 (Fix video-updates)
    └── 23M-13 (Shell wrapper)
         ↓
         23M-14 (E2E testing)
              ↓
              23M-15 (Archive n8n)
```

---

## 📝 Notes

### Critical Path
- 23M-11 → 23M-12 → 23M-14 → 23M-15
- 23M-13 can be done in parallel with 23M-12

### Risk Mitigation
- All changes are incremental
- Each file can be migrated independently
- Shell wrapper is already created
- Python automation proven and working

### Success Criteria
✅ All 5 Raycast commands work without errors  
✅ No code duplication in Python client calls  
✅ Shell wrapper integrated and tested  
✅ No n8n/Docker dependencies remain  
✅ Documentation updated  
✅ All Linear issues closed

---

## 🔄 Updates

**2025-10-06**: Initial issue creation
- Created 5 Linear issues
- Updated REFACTOR-REMOVE-N8N.md spec
- Linked to commit 98a5961 review

---

## 📚 Related Documents

- `.kiro/REFACTOR-REMOVE-N8N.md` - Main refactor spec
- `README.md` - Project documentation (to be updated)
- `.kiro/specs/architecture.md` - Architecture docs (to be created in 23M-15)

---

**Last Updated**: 2025-10-06  
**Next Review**: After 23M-11 is completed
