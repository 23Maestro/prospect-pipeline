# NPID SSE Streaming Server

**Solves stdout/stderr issues with clean HTTP Server-Sent Events (SSE) streaming**

## 🎯 Problem Solved

No more:
- ❌ Broken stdout pipes
- ❌ Half-printed tracebacks
- ❌ Missing logs
- ❌ Subprocess exit mysteries

Instead:
- ✅ Real-time streaming over HTTP
- ✅ Every message delivered
- ✅ Browser-viewable events
- ✅ Raycast/MCP compatible

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd ~/Raycast/prospect-pipeline/mcp-servers/npid-native
python3 -m pip install flask flask-sse gunicorn
```

### 2. Start the Server

```bash
python3 session_stream_server.py
```

You should see:
```
============================================================
🚀 NPID SSE Streaming Server
============================================================
Server starting on http://127.0.0.1:5050

Available endpoints:
  • Health check:     GET  http://127.0.0.1:5050/health
  • Main stream:      GET  http://127.0.0.1:5050/stream
  • Inbox threads:    GET  http://127.0.0.1:5050/api/inbox/threads?limit=50
  • Init session:     POST http://127.0.0.1:5050/api/session/init
  • Session status:   GET  http://127.0.0.1:5050/api/session/status

Connect from Raycast or browser to receive real-time SSE events!
============================================================
```

### 3. Test the Server

**Option A: Python Test Client**
```bash
python3 test_sse_client.py
```

**Option B: Browser Monitor**
```bash
open test_sse_monitor.html
```

**Option C: Curl**
```bash
curl -N http://127.0.0.1:5050/stream
```

## 📡 API Endpoints

### GET /health
Health check endpoint
```bash
curl http://127.0.0.1:5050/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-08T10:30:00",
  "automator_initialized": true
}
```

### GET /stream

data: {"type": "thread", "data": {"index": 1, "total": 5, "thread": {...}}}
data: {"type": "thread", "data": {"index": 2, "total": 5, "thread": {...}}}
data: {"type": "operation_complete", "data": {"operation": "get_inbox_threads", "total_threads": 5}}
```

### POST /api/session/init
Initialize or reinitialize the automation session

```bash
curl -X POST -N http://127.0.0.1:5050/api/session/init
```

### GET /api/session/status
Get current session status (non-streaming)

```bash
curl http://127.0.0.1:5050/api/session/status
```

Response:
```json
{
  "initialized": true,
  "timestamp": "2025-10-08T10:30:00"
}
```

## 🎨 Event Types

All SSE events follow this format:
```json
{
  "type": "event_type",
  "timestamp": "2025-10-08T10:30:00.123456",
  "data": {
    // event-specific data
  }
}
```

### Event Types:

| Type | Description | Data Fields |
|------|-------------|-------------|
| `connected` | Initial connection established | `message` |
| `heartbeat` | Keep-alive ping (every 30s) | `{}` |
| `operation_start` | Operation beginning | `operation`, `limit` |
| `status` | Status update | `message` |
| `thread` | Inbox thread data | `index`, `total`, `thread` |
| `operation_complete` | Operation finished | `operation`, `total_threads` |
| `error` | Error occurred | `operation`, `error`, `traceback` |

## 🔧 Integration Examples

### JavaScript/Browser

```javascript
const eventSource = new EventSource('http://127.0.0.1:5050/stream');

eventSource.onmessage = function(e) {
  const event = JSON.parse(e.data);
  console.log(`[${event.type}]`, event.data);
};

eventSource.onerror = function(err) {
  console.error('SSE error:', err);
  eventSource.close();
};
```

### Python

```python
import requests
import json

with requests.get('http://127.0.0.1:5050/stream', stream=True) as response:
    for line in response.iter_lines():
        if line:
            decoded = line.decode('utf-8')
            if decoded.startswith('data: '):
                event = json.loads(decoded[6:])
                print(f"[{event['type']}]", event['data'])
```

### Raycast Extension

In your Raycast extension's MCP configuration:
```json
{
  "mcpServers": {
    "npid-sse": {
      "url": "http://127.0.0.1:5050/stream",
      "type": "sse"
    }
  }
}
```

### curl (with jq for pretty printing)

```bash
curl -N http://127.0.0.1:5050/stream | \
  grep --line-buffered "^data:" | \
  sed 's/^data: //' | \
  jq -c '{type: .type, data: .data}'
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│  Raycast / Browser / Python Client              │
│  (connects via HTTP SSE)                        │
└────────────────┬────────────────────────────────┘
                 │
                 │ HTTP GET /stream
                 │ text/event-stream
                 ▼
┌─────────────────────────────────────────────────┐
│  Flask SSE Server (session_stream_server.py)    │
│  - Port 5050                                    │
│  - Thread-safe event queue                      │
│  - StreamLogger for event emission              │
└────────────────┬────────────────────────────────┘
                 │
                 │ Calls methods
                 ▼
┌─────────────────────────────────────────────────┐
│  NpidAutomator (npid_automator_complete.py)     │
│  - get_inbox_threads()                          │
│  - Other automation methods                     │
└────────────────┬────────────────────────────────┘
                 │
                 │ Uses
                 ▼
┌─────────────────────────────────────────────────┐
│  SessionManager (session_manager.py)            │
│  - Selenium WebDriver                           │
│  - Persistent sessions                          │
│  - Cookie management                            │
└─────────────────────────────────────────────────┘
```

## 🐛 Debugging

### Check if server is running
```bash
curl http://127.0.0.1:5050/health
```

### Monitor raw SSE stream
```bash
curl -N http://127.0.0.1:5050/stream
```

### View server logs
The server logs to stdout, so you'll see all activity in the terminal where you started it.

### Common Issues

**Port already in use:**
```bash
lsof -ti:5050 | xargs kill -9
python3 session_stream_server.py
```

**Connection refused:**
- Make sure the server is running
- Check firewall settings
- Verify you're using `127.0.0.1` not `localhost`

**No events received:**
- Check browser console for CORS errors
- Verify the endpoint URL is correct
- Try the Python test client first

## 🎯 Why SSE > stdout?

| Issue | stdout/stderr | SSE |
|-------|---------------|-----|
| Buffering | ✗ Can buffer/truncate | ✓ Reliable delivery |
| Browser viewing | ✗ Not possible | ✓ Native support |
| Structured data | ✗ Plain text only | ✓ JSON events |
| Connection status | ✗ Unknown | ✓ Known via connection |
| Multiple clients | ✗ Single stream | ✓ Multiple connections |
| Filtering | ✗ grep only | ✓ Event types |

## 📚 Additional Resources

- Flask SSE: https://flask.palletsprojects.com/
- SSE Spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
- EventSource API: https://developer.mozilla.org/en-US/docs/Web/API/EventSource

## 🎉 Success!

Your automation now streams cleanly without stdout issues. Open the HTML monitor and watch events flow in real-time!
