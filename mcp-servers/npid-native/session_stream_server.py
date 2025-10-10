#!/usr/bin/env python3
"""
SSE Streaming Server for NPID Automation
Provides real-time streaming output via Server-Sent Events (SSE)
No more stdout/stderr issues - everything streams cleanly over HTTP
"""
import sys
import json
import time
import logging
from datetime import datetime
from pathlib import Path
from flask import Flask, Response, jsonify, request
from queue import Queue
import threading

# Add current directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

from session_manager import SessionManager, AutomationEngine
from npid_automator_complete import NpidAutomator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Global state
automator_instance = None
event_queue = Queue()


class StreamLogger:
    """Captures logs and sends them to SSE stream"""
    def __init__(self, event_queue: Queue):
        self.queue = event_queue
    
    def emit_event(self, event_type: str, data: dict):
        """Emit an SSE event"""
        event = {
            "type": event_type,
            "timestamp": datetime.now().isoformat(),
            "data": data
        }
        self.queue.put(event)
        logger.info(f"[SSE] {event_type}: {data}")


def format_sse_message(event: dict) -> str:
    """Format event as SSE message"""
    return f"data: {json.dumps(event)}\n\n"


@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "automator_initialized": automator_instance is not None
    })


@app.route('/stream')
def stream():
    """Main SSE streaming endpoint"""
    def generate():
        stream_logger = StreamLogger(event_queue)
        
        # Send initial connection event
        yield format_sse_message({
            "type": "connected",
            "timestamp": datetime.now().isoformat(),
            "data": {"message": "SSE stream established"}
        })
        
        # Keep connection alive and send queued events
        while True:
            try:
                # Check for events in queue (non-blocking with timeout)
                if not event_queue.empty():
                    event = event_queue.get_nowait()
                    yield format_sse_message(event)
                else:
                    # Send heartbeat every 30 seconds to keep connection alive
                    yield format_sse_message({
                        "type": "heartbeat",
                        "timestamp": datetime.now().isoformat(),
                        "data": {}
                    })
                    time.sleep(30)
            except Exception as e:
                logger.error(f"Stream error: {e}")
                yield format_sse_message({
                    "type": "error",
                    "timestamp": datetime.now().isoformat(),
                    "data": {"error": str(e)}
                })
                break
    
    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/inbox/threads', methods=['GET'])
def get_inbox_threads():
    """Get inbox threads - streams results via SSE"""
    limit = request.args.get('limit', 50, type=int)
    
    def generate():
        stream_logger = StreamLogger(event_queue)
        
        try:
            # Emit start event
            stream_logger.emit_event("operation_start", {
                "operation": "get_inbox_threads",
                "limit": limit
            })
            yield format_sse_message(event_queue.get())
            
            # Initialize automator if needed
            global automator_instance
            if automator_instance is None:
                stream_logger.emit_event("status", {
                    "message": "Initializing NPID automator..."
                })
                yield format_sse_message(event_queue.get())
                
                automator_instance = NpidAutomator(headless=True)
            
            # Get inbox threads
            stream_logger.emit_event("status", {
                "message": f"Fetching inbox threads (limit: {limit})..."
            })
            yield format_sse_message(event_queue.get())
            
            threads = automator_instance.get_inbox_threads(limit=limit)
            
            # Stream each thread as it's processed
            for i, thread in enumerate(threads, 1):
                stream_logger.emit_event("thread", {
                    "index": i,
                    "total": len(threads),
                    "thread": thread
                })
                yield format_sse_message(event_queue.get())
            
            # Emit completion event
            stream_logger.emit_event("operation_complete", {
                "operation": "get_inbox_threads",
                "total_threads": len(threads)
            })
            yield format_sse_message(event_queue.get())
            
        except Exception as e:
            logger.error(f"Error in get_inbox_threads: {e}", exc_info=True)
            stream_logger.emit_event("error", {
                "operation": "get_inbox_threads",
                "error": str(e),
                "traceback": str(e.__traceback__)
            })
            yield format_sse_message(event_queue.get())
    
    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/session/init', methods=['POST'])
def init_session():
    """Initialize or reinitialize the automation session"""
    def generate():
        stream_logger = StreamLogger(event_queue)
        
        try:
            stream_logger.emit_event("status", {
                "message": "Initializing session manager..."
            })
            yield format_sse_message(event_queue.get())
            
            global automator_instance
            automator_instance = NpidAutomator(headless=True)
            
            stream_logger.emit_event("operation_complete", {
                "operation": "init_session",
                "message": "Session initialized successfully"
            })
            yield format_sse_message(event_queue.get())
            
        except Exception as e:
            logger.error(f"Error initializing session: {e}", exc_info=True)
            stream_logger.emit_event("error", {
                "operation": "init_session",
                "error": str(e)
            })
            yield format_sse_message(event_queue.get())
    
    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/session/status', methods=['GET'])
def session_status():
    """Get current session status"""
    return jsonify({
        "initialized": automator_instance is not None,
        "timestamp": datetime.now().isoformat()
    })


if __name__ == '__main__':
    print("=" * 60)
    print("🚀 NPID SSE Streaming Server")
    print("=" * 60)
    print(f"Server starting on http://127.0.0.1:5050")
    print(f"")
    print("Available endpoints:")
    print("  • Health check:     GET  http://127.0.0.1:5050/health")
    print("  • Main stream:      GET  http://127.0.0.1:5050/stream")
    print("  • Inbox threads:    GET  http://127.0.0.1:5050/api/inbox/threads?limit=50")
    print("  • Init session:     POST http://127.0.0.1:5050/api/session/init")
    print("  • Session status:   GET  http://127.0.0.1:5050/api/session/status")
    print(f"")
    print("Connect from Raycast or browser to receive real-time SSE events!")
    print("=" * 60)
    
    app.run(host='127.0.0.1', port=5050, debug=False, threaded=True)
