#!/usr/bin/env python3
"""
SSE Test Client - Validates streaming server functionality
Usage: python3 test_sse_client.py
"""
import requests
import json
import sys

def test_health():
    """Test health endpoint"""
    print("\n" + "="*60)
    print("Testing /health endpoint...")
    print("="*60)
    
    try:
        response = requests.get('http://127.0.0.1:5050/health', timeout=5)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        return response.status_code == 200
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_stream():
    """Test main SSE stream endpoint"""
    print("\n" + "="*60)
    print("Testing /stream endpoint (SSE)...")
    print("Listening for 10 seconds...")
    print("="*60)
    
    try:
        with requests.get('http://127.0.0.1:5050/stream', 
                         stream=True, timeout=15) as response:
            if response.status_code != 200:
                print(f"❌ Error: Status {response.status_code}")
                return False
            
            print("✅ Connected to SSE stream!")
            print("\nReceiving events:\n")
            
            event_count = 0
            for line in response.iter_lines():
                if line:
                    decoded_line = line.decode('utf-8')
                    if decoded_line.startswith('data: '):
                        event_data = decoded_line[6:]  # Remove 'data: ' prefix
                        try:
                            event = json.loads(event_data)
                            event_count += 1
                            print(f"[Event {event_count}] {event['type']}: {event.get('data', {})}")
                        except json.JSONDecodeError:
                            print(f"[Raw] {decoded_line}")
                
                # Stop after 10 seconds or 5 events
                if event_count >= 5:
                    print("\n✅ Received 5 events, stopping test")
                    break
            
            return True
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_inbox_threads():
    """Test inbox threads SSE endpoint"""
    print("\n" + "="*60)
    print("Testing /api/inbox/threads endpoint (SSE)...")
    print("="*60)
    
    try:
        with requests.get('http://127.0.0.1:5050/api/inbox/threads?limit=5',
                         stream=True, timeout=60) as response:
            if response.status_code != 200:
                print(f"❌ Error: Status {response.status_code}")
                return False
            
            print("✅ Connected to inbox threads stream!")
            print("\nReceiving events:\n")
            
            event_count = 0
            for line in response.iter_lines():
                if line:
                    decoded_line = line.decode('utf-8')
                    if decoded_line.startswith('data: '):
                        event_data = decoded_line[6:]
                        try:
                            event = json.loads(event_data)
                            event_count += 1
                            event_type = event.get('type', 'unknown')
                            
                            print(f"\n[Event {event_count}] Type: {event_type}")
                            print(f"  Timestamp: {event.get('timestamp', 'N/A')}")
                            
                            if event_type == 'thread':
                                thread_data = event.get('data', {}).get('thread', {})
                                print(f"  Thread: {thread_data.get('name', 'N/A')}")
                                print(f"  Email: {thread_data.get('email', 'N/A')}")
                                print(f"  Subject: {thread_data.get('subject', 'N/A')}")
                            else:
                                print(f"  Data: {event.get('data', {})}")
                                
                        except json.JSONDecodeError:
                            print(f"[Raw] {decoded_line}")
            
            print(f"\n✅ Test completed! Received {event_count} events")
            return True
            
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests"""
    print("\n" + "="*60)
    print("🧪 NPID SSE Streaming Server Test Suite")
    print("="*60)
    print("Make sure the server is running first:")
    print("  python3 session_stream_server.py")
    print("="*60)
    
    results = {}
    
    # Test 1: Health check
    results['health'] = test_health()
    
    # Test 2: Main stream
    results['stream'] = test_stream()
    
    # Test 3: Inbox threads (optional - requires valid session)
    print("\n" + "="*60)
    test_inbox = input("Test inbox threads? (requires logged in session) [y/N]: ")
    if test_inbox.lower() == 'y':
        results['inbox_threads'] = test_inbox_threads()
    
    # Summary
    print("\n" + "="*60)
    print("📊 Test Results Summary")
    print("="*60)
    for test_name, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{test_name:20s} {status}")
    print("="*60)
    
    # Exit with appropriate code
    all_passed = all(results.values())
    sys.exit(0 if all_passed else 1)


if __name__ == '__main__':
    main()
