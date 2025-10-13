# NPID API Client Documentation

This document provides an overview of the functions available in the `npid_api_client.py` module. This client is used to interact with the NPID dashboard API.

## Authentication

### `login(force=False)`

Authenticates with the NPID server.

-   **`force`** (optional): If `True`, forces a new login even if a valid session exists.

## Inbox

### `get_inbox_threads(limit=100, filter_assigned='both')`

Fetches inbox threads from the video team inbox.

-   **`limit`**: Maximum number of threads to return.
-   **`filter_assigned`**: Filter by assignment status: `'unassigned'`, `'assigned'`, or `'both'`.

### `get_message_detail(message_id, item_code)`

Fetches the detailed content of a specific message.

-   **`message_id`**: The ID of the message.
-   **`item_code`**: The item code of the message.

## Assignment

### `get_assignment_modal(message_id, item_code)`

Fetches the data needed for the assignment modal (owners, stages, statuses).

-   **`message_id`**: The ID of the message.
-   **`item_code`**: The item code of the message.

### `assign_thread(payload)`

Assigns a thread to a member of the video team.

-   **`payload`**: A dictionary containing the assignment details:
    -   `messageId`
    -   `ownerId`
    -   `contactId`
    -   `contact_id`
    -   `athleteMainId`
    -   `stage`
    -   `status`
    -   `contactFor`
    -   `formToken`
    -   `contact`

### `get_assignment_defaults(contact_id)`

Fetches the recommended stage and status for a contact.

-   **`contact_id`**: The ID of the contact.

## Search

### `search_contacts(query, search_type='athlete')`

Searches for contacts (athletes or parents).

-   **`query`**: The name or email to search for.
-   **`search_type`**: `'athlete'` or `'parent'`.

### `search_player(query)`

Searches for players in the NPID database.

-   **`query`**: The search query.

## Athlete Profile

### `get_athlete_details(player_id)`

Fetches detailed information about an athlete.

-   **`player_id`**: The ID of the player.

### `update_video_profile(player_id, youtube_link, season, video_type)`

Adds a new video to an athlete's profile.

-   **`player_id`**: The ID of the player.
-   **`youtube_link`**: The URL of the YouTube video.
-   **`season`**: The season of the video (e.g., "Junior Season").
-   **`video_type`**: The type of video (e.g., "Highlights").

### `get_video_seasons(athlete_id, sport_alias, video_type, athlete_main_id)`

Fetches the available video seasons for a player.

-   **`athlete_id`**: The ID of the athlete.
-   **`sport_alias`**: The sport of the athlete (e.g., "football").
-   **`video_type`**: The type of video.
-   **`athlete_main_id`**: The main ID of the athlete.
