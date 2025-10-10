# 🎯 HOW TO INTEGRATE SSE SERVER WITH YOUR RAYCAST COMMAND

## Current Setup (What You Have Now)

Your Raycast command `assign-videoteam-inbox.tsx` currently:
1. Calls `callPythonServer('get_inbox_threads', { limit: 50 })`
2. This spawns `npid_simple_server.py` as a subprocess
3. It sends JSON over stdin/stdout
4. **Problem:** stdout gets truncated/broken

## New Setup (SSE Streaming - Much Better!)

Instead of spawning subprocesses, you'll:
1. Keep the SSE server **running continuously**
2. Make simple HTTP requests from Raycast
3. Get reliable streaming data back
4. **No more stdout issues!**

---

## 🚀 STEP-BY-STEP INTEGRATION

### Step 1: Keep SSE Server Running

Open a terminal and keep this running:
```bash
cd ~/Raycast/prospect-pipeline/mcp-servers/npid-native
./start_sse_server.sh
```

**Leave this terminal open!** The server runs on `http://127.0.0.1:5050`

---

### Step 2: Update Your python-server-client.ts

Replace your existing `callPythonServer` function with this HTTP-based version:

```typescript
// src/lib/python-server-client.ts

export interface PythonServerResponse<T = any> {
  id: number;
  status: 'ok' | 'error';
  message?: string;
  data?: T;
  [key: string]: any;
}

/**
 * New SSE-based client - makes HTTP calls instead of spawning processes
 * This eliminates ALL stdout/stderr issues!
 */
export async function callPythonServer<T = any>(
  method: string,
  args: any = {},
  timeoutMs: number = 60000
): Promise<PythonServerResponse<T>> {
  const serverUrl = 'http://127.0.0.1:5050';
  
  try {
    // Map methods to SSE endpoints
    const endpointMap: Record<string, string> = {
      'get_inbox_threads': `/api/inbox/threads?limit=${args.limit || 50}`,
      // Add more methods as needed
    };
    
    const endpoint = endpointMap[method];
    if (!endpoint) {
      throw new Error(`Unknown method: ${method}`);
    }
    
    const url = `${serverUrl}${endpoint}`;
    
    // For SSE endpoints, we need to collect all events
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    // Read SSE stream
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    
    const decoder = new TextDecoder();
    let threads: any[] = [];
    let error: string | null = null;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value);
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const eventData = JSON.parse(line.slice(6));
          
          // Handle different event types
          if (eventData.type === 'thread') {
            threads.push(eventData.data.thread);
          } else if (eventData.type === 'error') {
            error = eventData.data.error;
          } else if (eventData.type === 'operation_complete') {
            // Done!
            reader.cancel();
            break;
          }
        }
      }
    }
    
    if (error) {
      return {
        id: 1,
        status: 'error',
        message: error,
      };
    }
    
    return {
      id: 1,
      status: 'ok',
      data: threads,
    };
    
  } catch (error) {
    return {
      id: 1,
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

---

### Step 3: That's It! No Changes Needed to Your Raycast Command

Your `assign-videoteam-inbox.tsx` stays **exactly the same**:

```typescript
const result = await callPythonServer('get_inbox_threads', { limit: 50 });

if (result.status !== 'ok') {
  throw new Error(result.message || 'Failed to fetch inbox from NPID');
}

const threads = result.data || [];
```

It just works! 🎉

---

## 📊 What Happens Now?

### Before (subprocess approach):
```
Raycast → spawn python → stdin/stdout → ❌ BREAKS
```

### After (SSE approach):
```
Raycast → HTTP GET → SSE stream → ✅ RELIABLE
```

---

## 🎯 Simple Alternative: Use fetch() Directly

If you want even simpler code, you can call the SSE endpoint directly:

```typescript
// In assign-videoteam-inbox.tsx, replace loadInboxMessages() with:

const loadInboxMessages = async () => {
  try {
    setIsLoading(true);

    const response = await fetch('http://127.0.0.1:5050/api/inbox/threads?limit=50');
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    const threads: any[] = [];
    
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      
      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'thread') {
            threads.push(event.data.thread);
          }
        }
      }
    }
    
    // Rest of your code...
    const messages: NPIDInboxMessage[] = threads
      .filter((thread: any) => thread.can_assign === true)
      .map((thread: any) => ({ /* ... */ }));
      
    setMessages(messages);
  } catch (error) {
    // error handling...
  }
};
```

---

## 🧪 Testing It

1. **Start SSE server:**
   ```bash
   cd ~/Raycast/prospect-pipeline/mcp-servers/npid-native
   ./start_sse_server.sh
   ```

2. **Test with curl:**
   ```bash
   curl -N http://127.0.0.1:5050/api/inbox/threads?limit=5
   ```

3. **Test with browser:**
   ```bash
   open test_sse_monitor.html
   ```

4. **Run your Raycast command:**
   - Open Raycast
   - Search "Assign Videoteam Inbox"
   - It should now work reliably!

---

## ❓ FAQ

**Q: Do I need to restart the SSE server often?**
A: No! Leave it running. It maintains your session persistently.

**Q: What if the server crashes?**
A: Just restart it with `./start_sse_server.sh`

**Q: Can I run this in production?**
A: For production, use gunicorn:
```bash
gunicorn -w 4 -b 127.0.0.1:5050 session_stream_server:app
```

**Q: What about other methods besides get_inbox_threads?**
A: Add them to the SSE server! Pattern:
```python
@app.route('/api/your-method')
def your_method():
    def generate():
        # emit events...
    return Response(generate(), mimetype='text/event-stream')
```

---

## 🎉 Benefits You Get

✅ **No more truncated output** - HTTP is reliable
✅ **Real-time progress** - See each thread as it loads
✅ **Easy debugging** - View in browser with HTML monitor
✅ **Persistent session** - Server stays logged in
✅ **Multiple clients** - Raycast, browser, curl all work

---

## 📝 Summary

1. Keep SSE server running: `./start_sse_server.sh`
2. Update `python-server-client.ts` to use HTTP/SSE
3. Your Raycast command works without changes
4. Enjoy reliable, streaming data! 🎊
