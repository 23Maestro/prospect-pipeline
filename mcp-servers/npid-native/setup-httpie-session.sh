#!/bin/bash
# HTTPie Session Setup Helper for Prospect ID REST API Migration
# This script helps you create an HTTPie session with your browser cookies

echo "🔧 HTTPie Session Setup for Prospect ID Dashboard"
echo "=================================================="
echo ""
echo "📋 Step 1: Extract Cookies from Chrome"
echo "1. Open Chrome and navigate to: https://dashboard.nationalpid.com"
echo "2. Press Cmd+Option+I to open DevTools"
echo "3. Go to Application tab → Cookies → dashboard.nationalpid.com"
echo "4. Find and copy these three cookie values:"
echo ""
echo "   - remember_82e5d2c56bdd0811318f0cf078b78bfc"
echo "   - XSRF-TOKEN"
echo "   - myapp_session"
echo ""
echo "Press Enter when you have the cookies ready..."
read -r

echo ""
echo "✏️  Step 2: Enter Cookie Values"
echo ""
echo -n "Paste remember_82e5d2c56bdd0811318f0cf078b78bfc: "
read -r REMEMBER_TOKEN

echo -n "Paste XSRF-TOKEN: "
read -r XSRF_TOKEN

echo -n "Paste myapp_session: "
read -r SESSION_TOKEN

echo ""
echo "🔨 Step 3: Creating HTTPie Session"
echo ""

# Create session directory
mkdir -p ~/.config/httpie/sessions/dashboard.nationalpid.com

# Create session file
cat > ~/.config/httpie/sessions/dashboard.nationalpid.com/prospect-id.json << EOF
{
  "__meta__": {
    "about": "HTTPie session file",
    "help": "https://httpie.io/docs#sessions",
    "httpie": "3.2.2"
  },
  "auth": {
    "password": null,
    "type": null,
    "username": null
  },
  "cookies": {
    "remember_82e5d2c56bdd0811318f0cf078b78bfc": {
      "expires": null,
      "path": "/",
      "secure": true,
      "value": "$REMEMBER_TOKEN"
    },
    "XSRF-TOKEN": {
      "expires": null,
      "path": "/",
      "secure": true,
      "value": "$XSRF_TOKEN"
    },
    "myapp_session": {
      "expires": null,
      "path": "/",
      "secure": true,
      "value": "$SESSION_TOKEN"
    }
  },
  "headers": {
    "User-Agent": "HTTPie/3.2.2",
    "Accept": "application/json"
  }
}
EOF

echo "✅ Session file created at:"
echo "   ~/.config/httpie/sessions/dashboard.nationalpid.com/prospect-id.json"
echo ""
echo "🧪 Step 4: Testing Session"
echo ""
echo "Testing inbox endpoint..."

# Test the session with inbox endpoint
http --session=prospect-id --check-status --timeout=10 \
  POST 'https://dashboard.nationalpid.com/videoteammsg/getvideomailthreads' \
  thread_status=all \
  assigned_to= \
  search_keyword= \
  _token="$XSRF_TOKEN" \
  2>&1 | head -20

echo ""
echo "✅ If you see JSON with thread data above, the session works!"
echo "✅ If you see authentication errors, verify your cookies are current"
echo ""
echo "📝 Next Step: Run Phase 2 of the migration"
echo "   Claude will now replace the Python Selenium code with HTTPie calls"
