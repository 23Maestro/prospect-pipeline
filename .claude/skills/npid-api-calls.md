---
name: npid-api-calls
description: Use when implementing ANY NPID API call in TypeScript/JavaScript - enforces checking Python reference implementation first
---

# NPID API Call Implementation Protocol

## MANDATORY PRE-IMPLEMENTATION CHECKLIST

Before writing ANY code that calls NPID API endpoints, you MUST:

### 1. Find the Python Reference Implementation

Check these files IN ORDER:
- `src/python/npid_api_client.py`
- `src/python/vps_broker_api_client.py`
- `src/python/npid_rest_client.py`

Use Grep to find the exact endpoint implementation.

### 2. Extract EXACT Implementation Details

Copy these EXACTLY from Python code:
- ✅ HTTP method (GET/POST)
- ✅ URL path
- ✅ ALL headers (especially `X-Requested-With: XMLHttpRequest`)
- ✅ Form data structure (field names, values)
- ✅ Response parsing logic (JSON vs HTML)

### 3. Critical NPID API Facts

**The `/videoteammsg/videoprogress` endpoint:**
- Returns HTML by default
- Returns JSON ONLY with `X-Requested-With: XMLHttpRequest` header
- This is NOT a session expiration issue
- This is NOT an authentication problem
- This is the AJAX convention

**Headers ALWAYS Required:**
```typescript
{
  'Content-Type': 'application/x-www-form-urlencoded',
  'X-Requested-With': 'XMLHttpRequest',
  ...authHeaders
}
```

## FORBIDDEN ACTIONS

❌ NEVER assume session is expired when you see HTML
❌ NEVER implement NPID API calls without checking Python first
❌ NEVER add "session expired" error messages for HTML responses
❌ NEVER guess at header requirements

## CORRECT WORKFLOW

1. User asks for NPID feature
2. Read this skill (you're here)
3. Grep Python files for endpoint
4. Read the Python implementation
5. Copy headers, form data, response handling EXACTLY
6. Implement in TypeScript with same structure
7. Test

## POSITION HANDLING RULES

From CLAUDE.md:
- Preserve API values exactly (pipe-separated abbreviations, etc.)
- If value is missing, leave it blank
- Never invent placeholders like "NA"

## WHY THIS MATTERS

The user has debugged this pattern 100+ times. Every time I:
1. Don't check Python code first
2. Make assumptions about HTML = expired session
3. Add wrong error handling
4. Break working code

This skill exists to stop that cycle.
