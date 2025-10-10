# 🔌 How to Integrate SSE Server with Your Raycast "Assign Inbox" Command

## 📖 Understanding Your Current Setup

### What You Have Now:
1. **Raycast Extension** (`assign-videoteam-inbox.tsx`)
   - Shows NPID inbox messages in Raycast
   - Lets you assign messages to team members
   - Currently calls Python via MCP or direct server calls

2. **Python Backend** (`npid_automator_complete.py`)
   - Has methods like `get_inbox_threads()` 
   - Uses SessionManager for browser automation
   - **Problem:** stdout/stderr issues, logs get lost

### What We Just Built:
**SSE Streaming Server** (`session_stream_server.py`)
- Wraps your Python automation with HTTP endpoints
- Streams real-time progress over SSE
- **No more stdout issues!**

## 🎯 Integration Options

You have **TWO** ways to integrate:

### Option 1: Direct HTTP API (Simplest)
Replace your current MCP/server calls with simple HTTP requests

### Option 2: SSE Streaming (Real-time updates)
Stream progress events as they happen

---

## ✅ Option 1: Simple HTTP Integration (Recommended to Start)

### Step 1: Update Your Raycast Code

Open `src/lib/npid-mcp-adapter.ts` and add this helper:

```typescript
// Add at the top with other imports
const SSE_SERVER_URL = 'http://127.0.0.1:5050';

// Add this new function
export async function getInboxThreadsViaSSE(limit = 50) {
  try {
    const response = await fetch(
      `${SSE_SERVER_URL}/api/inbox/threads?limit=${limit}`,
      {
        headers: {
          'Accept': 'text/event-stream',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`SSE server returned ${response.status}`);
    }

    const threads: any[] = [];
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) throw new Error('No response body');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const eventData = JSON.parse(line.slice(6));
          
          // Collect thread events
          if (eventData.type === 'thread') {
            threads.push(eventData.data.thread);
          }
          
          // Handle errors
          if (eventData.type === 'error') {
            throw new Error(eventData.data.error);
          }
        }
      }
    }

    return threads;
  } catch (error) {
    console.error('Failed to fetch inbox via SSE:', error);
    throw error;
  }
}
```

### Step 2: Update Your Assign Inbox Command

In `src/assign-videoteam-inbox.tsx`, find where you call the inbox:

```typescript
// OLD CODE (probably something like):
const messages = await callPythonServer('get_inbox_threads', { limit: 50 });

// NEW CODE:
import { getInboxThreadsViaSSE } from './lib/npid-mcp-adapter';

const messages = await getInboxThreadsViaSSE(50);
```

### Step 3: Start the SSE Server

```bash
cd ~/Raycast/prospect-pipeline/mcp-servers/npid-native
./start_sse_server.sh
```

### Step 4: Test It!

1. Make sure the SSE server is running
2. Open Raycast
3. Run your "Assign Video Team Inbox" command
4. It should now use the SSE server! ✅

---

## 🚀 Option 2: Real-Time Streaming Integration

For showing progress as it happens (more advanced):

```typescript
export async function getInboxThreadsWithProgress(
  limit: number,
  onProgress: (message: string) => void
) {
  const eventSource = new EventSource(
    `${SSE_SERVER_URL}/api/inbox/threads?limit=${limit}`
  );

  return new Promise((resolve, reject) => {
    const threads: any[] = [];

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'status':
          onProgress(data.data.message);
          break;
        
        case 'thread':
          threads.push(data.data.thread);
          onProgress(`Found thread ${data.data.index}/${data.data.total}`);
          break;
        
        case 'operation_complete':
          eventSource.close();
          resolve(threads);
          break;
        
        case 'error':
          eventSource.close();
          reject(new Error(data.data.error));
          break;
      }
    };

    eventSource.onerror = (error) => {
      eventSource.close();
      reject(error);
    };
  });
}
```

Then use it in your command:

```typescript
const [statusMessage, setStatusMessage] = useState('Loading...');

const messages = await getInboxThreadsWithProgress(50, (msg) => {
  setStatusMessage(msg); // Show progress in UI
});
```

---

## 🔧 Adding More Automation Methods

Want to add `assign_message()` or other methods? Easy!

### Step 1: Add Endpoint to SSE Server

Open `session_stream_server.py` and add:

```python
@app.route('/api/message/assign', methods=['POST'])
def assign_message():
    """Assign a message - streams progress via SSE"""
    def generate():
        stream_logger = StreamLogger(event_queue)
        
        try:
            # Get parameters from request
            data = request.get_json()
            message_id = data.get('message_id')
            owner_id = data.get('owner_id')
            
            stream_logger.emit_event("status", {
                "message": f"Assigning message {message_id}..."
            })
            yield format_sse_message(event_queue.get())
            
            # Call your automator method
            global automator_instance
            result = automator_instance.assign_message(
                message_id, owner_id
            )
            
            stream_logger.emit_event("operation_complete", {
                "operation": "assign_message",
                "result": result
            })
            yield format_sse_message(event_queue.get())
            
        except Exception as e:
            stream_logger.emit_event("error", {
                "operation": "assign_message",
                "error": str(e)
            })
            yield format_sse_message(event_queue.get())
    
    return Response(generate(), mimetype='text/event-stream')
```

### Step 2: Call from Raycast

```typescript
export async function assignMessageViaSSE(
  messageId: string,
  ownerId: string
) {
  const response = await fetch(`${SSE_SERVER_URL}/api/message/assign`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    },
    body: JSON.stringify({ message_id: messageId, owner_id: ownerId }),
  });

  // Parse SSE response...
}
```

---

## 📁 File Checklist

Make sure these files exist:

```
✅ session_stream_server.py       # SSE server (running on :5050)
✅ npid_automator_complete.py     # Your automation methods  
✅ session_manager.py             # Session persistence
✅ test_sse_client.py             # Test the server works
✅ start_sse_server.sh            # Easy server startup
```

---

## 🐛 Troubleshooting

### "Connection refused"
Server not running. Start it:
```bash
cd ~/Raycast/prospect-pipeline/mcp-servers/npid-native
./start_sse_server.sh
```

### "Session expired"
Your NPID session needs refresh. The server will tell you in the error event.

### "Can't find methods"
Make sure your `npid_automator_complete.py` has all the methods you need.

---

## ✨ Benefits You Get

Before (MCP/Direct calls):
- ❌ Logs disappear into stdout
- ❌ Can't see what's happening
- ❌ Hard to debug
- ❌ Truncated errors

After (SSE Server):
- ✅ All logs visible in browser/terminal
- ✅ Real-time progress
- ✅ Full error messages
- ✅ Easy debugging

---

## 🎉 You're Done!

The SSE server is just a **wrapper** around your existing Python code.

**It doesn't change how your automation works** - it just makes it:
1. More reliable
2. More visible  
3. Easier to debug

Your Raycast commands talk to the SSE server, which talks to your Python automation. That's it!
