#!/bin/bash
# FastAPI Router Validation Pre-Commit Hook
# Blocks commits if FastAPI router violations detected
# Enforces npid-fastapi-skill.md patterns

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Only run if router files changed
ROUTER_FILES=$(git diff --cached --name-only | grep "npid-api-layer/app/routers/.*\.py$" || true)

if [ -z "$ROUTER_FILES" ]; then
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Validating FastAPI Routers..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

VIOLATIONS_FOUND=0

# Check 1: Import violations
echo "Checking import patterns..."
IMPORT_VIOLATIONS=$(grep -n "from app.session import get_session" npid-api-layer/app/routers/*.py 2>/dev/null || true)

if [ -n "$IMPORT_VIOLATIONS" ]; then
  echo -e "${RED}❌ VIOLATION: Import Pattern${NC}"
  echo "$IMPORT_VIOLATIONS"
  echo ""
  echo -e "${YELLOW}Fix:${NC} Use 'from app.session import NPIDSession' and define local get_session()"
  echo "See: .claude/skills/npid-fastapi-skill.md section 3.5"
  echo "Quick fix: /npid:fix-email-router"
  echo ""
  VIOLATIONS_FOUND=1
fi

# Check 2: Inline form construction
echo "Checking for inline form construction..."
INLINE_FORMS=$(grep -n "form_data = {" npid-api-layer/app/routers/*.py 2>/dev/null || true)

if [ -n "$INLINE_FORMS" ]; then
  echo -e "${RED}❌ VIOLATION: Inline Form Construction${NC}"
  echo "$INLINE_FORMS"
  echo ""
  echo -e "${YELLOW}Fix:${NC} Use LegacyTranslator methods instead"
  echo "See: .claude/skills/npid-fastapi-skill.md section 2"
  echo ""
  VIOLATIONS_FOUND=1
fi

# Check 3: Inline HTML parsing
echo "Checking for inline HTML parsing..."
INLINE_PARSING=$(grep -n "BeautifulSoup" npid-api-layer/app/routers/*.py 2>/dev/null || true)

if [ -n "$INLINE_PARSING" ]; then
  echo -e "${RED}❌ VIOLATION: Inline HTML Parsing${NC}"
  echo "$INLINE_PARSING"
  echo ""
  echo -e "${YELLOW}Fix:${NC} Move parsing logic to LegacyTranslator"
  echo "See: .claude/skills/npid-fastapi-skill.md section 2"
  echo ""
  VIOLATIONS_FOUND=1
fi

# Check 4: JSON body usage (forbidden)
echo "Checking for JSON body usage..."
JSON_USAGE=$(grep -n "json=" npid-api-layer/app/routers/*.py 2>/dev/null || true)

if [ -n "$JSON_USAGE" ]; then
  echo -e "${RED}❌ VIOLATION: JSON Body Usage${NC}"
  echo "$JSON_USAGE"
  echo ""
  echo -e "${YELLOW}Fix:${NC} Laravel requires form-encoding, use data= not json="
  echo "See: .claude/skills/npid-fastapi-skill.md section 1"
  echo ""
  VIOLATIONS_FOUND=1
fi

# Check 5: Direct client.post() usage
echo "Checking for session wrapper compliance..."
DIRECT_POST=$(grep -n "\.post(" npid-api-layer/app/routers/*.py 2>/dev/null | grep -v "session.post" | grep -v "@router.post" || true)

if [ -n "$DIRECT_POST" ]; then
  echo -e "${RED}❌ VIOLATION: Direct client.post() Usage${NC}"
  echo "$DIRECT_POST"
  echo ""
  echo -e "${YELLOW}Fix:${NC} Use session.post() wrapper instead of client.post()"
  echo "See: .claude/skills/npid-fastapi-skill.md section 1"
  echo ""
  VIOLATIONS_FOUND=1
fi

# Check 6: api_key in translator methods (FORBIDDEN - curl verified 2025-12-07)
echo "Checking translator for api_key usage..."
TRANSLATOR_API_KEY=$(grep -n '"api_key"' npid-api-layer/app/translators/legacy.py 2>/dev/null | grep -E "(stage_update_to_legacy|status_update_to_legacy|due_date_update_to_legacy)" || true)

if [ -n "$TRANSLATOR_API_KEY" ]; then
  echo -e "${RED}❌ VIOLATION: api_key in Translator${NC}"
  echo "$TRANSLATOR_API_KEY"
  echo ""
  echo -e "${YELLOW}Fix:${NC} video-stage, video-status, video-duedate do NOT require api_key"
  echo "Curl verified 2025-12-07: Only _token (auto-injected), video_msg_id, and target field"
  echo "Remove 'api_key' from form_data in translator methods"
  echo ""
  VIOLATIONS_FOUND=1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $VIOLATIONS_FOUND -eq 1 ]; then
  echo -e "${RED}❌ COMMIT BLOCKED${NC}"
  echo ""
  echo "FastAPI router violations detected. Fix violations before committing."
  echo ""
  echo "Quick commands:"
  echo "  /npid:validate-routers  - Full validation report"
  echo "  /npid:fix-email-router  - Fix email router automatically"
  echo ""
  echo "Documentation:"
  echo "  .claude/skills/npid-fastapi-skill.md"
  echo "  .claude/plugins/npid-fastapi/agents/validator.md"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
else
  echo -e "${GREEN}✅ FastAPI routers validated successfully${NC}"
  echo ""
  echo "All routers comply with npid-fastapi-skill.md patterns."
  echo "Commit allowed!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi
