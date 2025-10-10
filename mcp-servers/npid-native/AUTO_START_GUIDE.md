# ✅ AUTO-START CONFIGURED - SSE Server

## 🎉 SUCCESS!

The NPID SSE Server is now configured to **automatically start** when you log in to your Mac!

## 📊 Current Status

✅ **LaunchAgent:** Installed and loaded
✅ **Server:** Running on http://127.0.0.1:5050 (PID: 21496)
✅ **Auto-start:** Enabled (starts at login)
✅ **Auto-restart:** Enabled (restarts if it crashes)

## 🚀 What This Means

### Before:
You had to manually run `./start_sse_server.sh` every time you rebooted.

### Now:
The server starts **automatically** when you log in. You never have to think about it!

## 🔧 Management Scripts

I've created easy scripts to manage the server:

### Check Status:
```bash
cd ~/Raycast/prospect-pipeline/mcp-servers/npid-native
./check_server_status.sh
```

### Stop Server:
```bash
./stop_server.sh
```

### Restart Server:
```bash
./restart_server.sh
```

### View Live Logs:
```bash
tail -f ~/Raycast/prospect-pipeline/mcp-servers/npid-native/logs/sse-server.log
```

### View Error Logs:
```bash
tail -f ~/Raycast/prospect-pipeline/mcp-servers/npid-native/logs/sse-server.error.log
```

## 📁 Files Locations

**LaunchAgent:**
```
~/Library/LaunchAgents/com.user.npid-sse-server.plist
```

**Server Logs:**
```
~/Raycast/prospect-pipeline/mcp-servers/npid-native/logs/
├── sse-server.log        # Normal output
└── sse-server.error.log  # Errors only
```

**Management Scripts:**
```
~/Raycast/prospect-pipeline/mcp-servers/npid-native/
├── check_server_status.sh
├── stop_server.sh
└── restart_server.sh
```

## 🎯 How Auto-Start Works

The LaunchAgent (`com.user.npid-sse-server.plist`) tells macOS to:

1. **Start the server** when you log in (`RunAtLoad`)
2. **Restart automatically** if it crashes (`KeepAlive`)
3. **Log everything** to files in the `logs/` directory
4. **Run in the background** (no terminal window needed)

## 🧪 Testing Auto-Start

To test that it works:

1. Stop the server:
   ```bash
   ./stop_server.sh
   ```

2. Start it again (simulates login):
   ```bash
   launchctl load ~/Library/LaunchAgents/com.user.npid-sse-server.plist
   ```

3. Check status:
   ```bash
   ./check_server_status.sh
   ```

## 🔄 What Happens on Reboot?

1. You log in to your Mac
2. macOS automatically loads the LaunchAgent
3. LaunchAgent starts the SSE server
4. Server runs in the background
5. Your Raycast commands work immediately!

**You don't need to do anything!**

## 🛠️ Manual Control (Advanced)

If you ever need to manually control the LaunchAgent:

### Load (start):
```bash
launchctl load ~/Library/LaunchAgents/com.user.npid-sse-server.plist
```

### Unload (stop):
```bash
launchctl unload ~/Library/LaunchAgents/com.user.npid-sse-server.plist
```

### Check if loaded:
```bash
launchctl list | grep npid-sse
```

### Remove auto-start completely:
```bash
launchctl unload ~/Library/LaunchAgents/com.user.npid-sse-server.plist
rm ~/Library/LaunchAgents/com.user.npid-sse-server.plist
```

## 🐛 Troubleshooting

### Server not starting after reboot?
```bash
# Check status
./check_server_status.sh

# View error log
cat ~/Raycast/prospect-pipeline/mcp-servers/npid-native/logs/sse-server.error.log

# Manually restart
./restart_server.sh
```

### Port 5050 already in use?
```bash
# Kill whatever is using the port
lsof -ti:5050 | xargs kill -9

# Restart the server
./restart_server.sh
```

### Need to see what's happening?
```bash
# Watch logs in real-time
tail -f ~/Raycast/prospect-pipeline/mcp-servers/npid-native/logs/sse-server.log
```

## ✨ Benefits

✅ **No manual startup** - Just log in and it works
✅ **Survives reboots** - Always ready when you need it
✅ **Auto-recovery** - Restarts if it crashes
✅ **Clean logs** - Everything saved to files
✅ **Easy management** - Simple scripts to control it

## 🎊 You're All Set!

The SSE server will now:
- Start automatically when you log in
- Run silently in the background
- Be ready whenever you use Raycast
- Restart itself if something goes wrong

**Just reboot your Mac to see it in action!** When you log back in, the server will already be running.

---

**Created:** $(date)
**Status:** Operational ✅
