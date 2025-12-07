#!/bin/bash
# NPID Session Start Hook
# Reminds user to initialize session with NPID constraints

cat << 'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NPID FastAPI Plugin Active
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 Quick Commands:
  /npid:init-session        - Load all NPID skills & constraints
  /npid:validate-routers    - Check router compliance
  /npid:new-router <name>   - Create new router from template
  /npid:fix-email-router    - Fix known import violations

⚠️  Working with FastAPI routers? Run /npid:init-session first!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
