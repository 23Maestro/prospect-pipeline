# Terminal Guide For The Legacy Python NPID Client

This guide explains how to run the legacy CLI entrypoint in [`src/python/npid_api_client.py`](/Users/singleton23/Raycast/prospect-pipeline/src/python/npid_api_client.py) directly from the terminal.

This is useful for testing and debugging the older Python client flow. It is not the primary runtime path of the Raycast extension, which now uses the local FastAPI bridge in `npid-api-layer/`.

## Prerequisites

- Python 3
- Required Python packages from [`src/python/requirements.txt`](/Users/singleton23/Raycast/prospect-pipeline/src/python/requirements.txt)
- A valid local Prospect ID session workflow

Install the Python dependencies if needed:

```bash
pip install -r src/python/requirements.txt
```

## How To Use

1. Open a terminal.
2. Change to the repo root:

```bash
cd /Users/singleton23/Raycast/prospect-pipeline
```

3. Run the script with a method name and optional JSON arguments:

```bash
python3 src/python/npid_api_client.py <method> [json_args]
```

- `<method>`: the Python client method to invoke
- `[json_args]`: optional JSON object string passed to that method

## Examples

### Get Inbox Threads

```bash
python3 src/python/npid_api_client.py get_inbox_threads '{"limit": 5, "filter_assigned": "unassigned"}'
```

### Search For A Player

```bash
python3 src/python/npid_api_client.py search_player '{"query": "John Doe"}'
```

### Get Athlete Details

```bash
python3 src/python/npid_api_client.py get_athlete_details '{"player_id": "12345"}'
```

## Available Methods

Run the script without arguments to print the current list of supported methods:

```bash
python3 src/python/npid_api_client.py
```

## Important Context

- This guide replaces old references to `mcp-servers/npid-native/`, which is not the current location of the Python client.
- The active extension path is still:
  `Raycast -> local FastAPI bridge -> legacy Laravel`
- The `mcp-servers/npid-search/` server is legacy and separate from this terminal workflow.
