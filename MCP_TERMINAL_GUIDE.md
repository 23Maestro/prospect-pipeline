# MCP Terminal Guide

This guide explains how to use the command-line interface (CLI) provided in `npid_api_client.py` to interact with the NPID API from your terminal. This is a useful tool for testing and debugging.

## Prerequisites

-   You must have Python 3 installed.
-   You must have the required python packages installed (`requests`, `beautifulsoup4`). You can install them with pip:
    ```bash
    pip install requests beautifulsoup4
    ```

## How to Use

1.  **Open your terminal.**

2.  **Navigate to the directory** where the script is located:
    ```bash
    cd /Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/
    ```

3.  **Run the script** with the following format:
    ```bash
    python3 npid_api_client.py <method> [json_args]
    ```
    -   **`<method>`**: The name of the API function you want to call (e.g., `get_inbox_threads`).
    -   **`[json_args]`** (optional): A JSON string with the arguments for the function.

## Examples

Here are a few examples of how to use the CLI:

### Get Inbox Threads

This command fetches the 5 most recent unassigned threads from the inbox.

```bash
python3 npid_api_client.py get_inbox_threads '{"limit": 5, "filter_assigned": "unassigned"}'
```

### Search for a Player

This command searches for a player with the name "John Doe".

```bash
python3 npid_api_client.py search_player '{"query": "John Doe"}'
```

### Get Athlete Details

This command gets the details for a player with the ID `12345`.

```bash
python3 npid_api_client.py get_athlete_details '{"player_id": "12345"}'
```

## Available Methods

You can get a list of all available methods by running the script without any arguments:

```bash
python3 npid_api_client.py
```
