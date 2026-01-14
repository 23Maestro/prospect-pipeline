This markdown contains up to 5 daily notes closest to today's date, followed by the API documentation for interacting with them.

# Daily Notes Content (for reference only, use the API below for up-to-date data)

## Daily Note: 2025-09-08

```json
[
  {
    "id": "132D7E39-5830-466E-BE31-B6B75016A6F2",
    "type": "page",
    "textStyle": "page",
    "markdown": "2025.09.08",
    "content": [
      {
        "id": "9CC2C2B8-497D-4EA1-AFF6-BD25309080D9",
        "type": "text",
        "markdown": "AIzaSyA3sMaaHFeMHc815ND47FgslrQkSM3sC8Y"
      },
      {
        "id": "1AED6298-CB37-4FC1-8F55-4B70539C7CB5",
        "type": "text",
        "markdown": ""
      }
    ]
  }
]
```

## Daily Note: 2025-09-25

```json
[
  {
    "id": "2CF09C5E-8754-4932-B637-EE82456AAC2B",
    "type": "page",
    "textStyle": "page",
    "markdown": "2025.09.25",
    "content": []
  }
]
```

## Daily Note: 2025-10-16

```json
[
  {
    "id": "EAA633CE-91C0-4AB3-A727-47A53A9BD013",
    "type": "page",
    "textStyle": "page",
    "markdown": "2025.10.16",
    "content": []
  }
]
```

## Daily Note: 2025-11-07

```json
[
  {
    "id": "90439F25-93D7-43D5-B7D3-2D244468631C",
    "type": "page",
    "textStyle": "page",
    "markdown": "2025.11.07",
    "content": []
  }
]
```

## Daily Note: 2025-12-01

```json
[
  {
    "id": "0B1B658D-E991-43DF-B28E-1A9886A7D623",
    "type": "page",
    "textStyle": "page",
    "markdown": "2025.12.01",
    "content": []
  }
]
```

# Documentation of the Craft Daily Notes API

## Craft – API for API for Daily Notes & Tasks Daily Notes

**Version:** 1.0.0

### Overview
The Craft Daily Notes API provides programmatic access to your daily notes with blocks, tasks, and collections. Daily notes are date-based documents that can contain structured content, tasks, and time-based data.

### Recommended Usage
This API is best utilized when building automation, task management integrations, or daily note workflows.

### Development Tip
- Use relative date formats ('today', 'tomorrow', 'yesterday') for easier date handling
- Tasks are automatically organized into inbox, active, upcoming, and logbook scopes

### Note for AI
When implementing functionality using this API, always make actual calls to these endpoints and verify the responses. Do not simulate or mock the API interactions or use hard-coded values on the client-side - use the real endpoints to ensure proper functionality and data handling.

**IMPORTANT: This is a production server connected to real user data.** Only perform testing operations that can be safely rolled back:

- Safe: Reading data (`GET` requests), creating test content that you delete immediately after
- Safe: Modifying content if you can restore it to its original state
- Safe: Moving blocks if you can move them back to their original position
- Unsafe: Permanent deletions, modifications without backup, or any changes you cannot reverse

Always verify rollback operations work before considering a test complete.

### Servers

- https://connect.craft.do/links/LmdXrrOfTDC/api/v1
  API Server for API for Daily Notes & Tasks Daily Notes

---

## Endpoints

## Fetch Blocks

`GET /blocks`

Fetches content from daily notes. By default returns blocks from today's daily note. Use 'date' parameter to fetch from other dates.

Use `Accept` header `application/json` for structured data, `text/markdown` for rendered content.

**Content Rendering:** Text blocks contain markdown formatting. When displaying content, consider rendering markdown as formatted text or cleaning up the syntax for plain text display.

**Scope Filtering:** Block links in markdown and collections, as well as relations are filtered to daily notes scope (includes all daily notes, task inbox, and task logbook). Block links and date links are returned as `block://` and `date://` URLs.

**Tip:** Start by calling GET /documents to list available documents, then use their documentId values as the 'id' parameter to fetch each document's root content.

### Parameters

- **date** (query): string
  Fetches the root page of a Daily Note for the specified date. Accepts ISO format YYYY-MM-DD or relative dates: 'today', 'tomorrow', 'yesterday'.
Defaults to 'today' if both 'date' and 'id' not provided. Mutually exclusive with 'id' - use this to fetch a Daily Note's root page, or use 'id' to fetch a specific block.
- **id** (required) (query): string
  Fetches a specific page block by its ID. Use this when you want to retrieve a particular block directly, regardless of which Daily Note it belongs to.
Mutually exclusive with 'date' - omit 'date' entirely when using this parameter.
- **maxDepth** (query): number
  The maximum depth of blocks to fetch. Default is -1 (all descendants). With a depth of 0, only the specified block is fetched. With a depth of 1, only direct children are returned.
- **fetchMetadata** (query): boolean
  Whether to fetch metadata (comments, createdBy, lastModifiedBy, lastModifiedAt, createdAt) for the blocks. Default is false.

### Responses

#### 200
Successfully retrieved data

**Content-Type:** `application/json`

```json
{
  "id": "0",
  "type": "page",
  "textStyle": "page",
  "markdown": "<page>Document Title</page>",
  "content": [
    {
      "id": "1",
      "type": "text",
      "textStyle": "h1",
      "markdown": "# Main Section"
    },
    {
      "id": "2",
      "type": "text",
      "markdown": "This is some content in the document."
    },
    {
      "id": "3",
      "type": "page",
      "textStyle": "card",
      "markdown": "Subsection",
      "content": [
        {
          "id": "4",
          "type": "text",
          "markdown": "Nested content inside subsection."
        }
      ]
    }
  ]
}
```

---

## Insert Blocks

`POST /blocks`

Insert content into a daily note. This single endpoint handles both structured blocks and markdown insertion via Content-Type header negotiation.

**Content-Type: application/json** - Insert structured block objects with position in request body
**Content-Type: text/markdown** - Insert raw markdown text with position specified via query parameter (`?position={"position":"end","date":"today"}`)

Using date-based position targets the most recently updated daily note for that date. To insert into another daily note from the same day, use pageId with the daily note's block ID instead. Multiple daily notes for the same date can occur due to sync conflicts or trash restore, but this is not a core use-case - try using one daily note per day whenever possible.

Returns the inserted blocks with their assigned block IDs for later reference.

### Request Body

**Content-Type:** `application/json`


**Example: textBlock**

Insert text block into today's daily note

```json
{
  "blocks": [
    {
      "type": "text",
      "markdown": "## Meeting Notes\n\n- Discussed Q1 goals\n- Action items assigned"
    }
  ],
  "position": {
    "position": "end",
    "date": "today"
  }
}
```


**Example: markdown**

Insert markdown into specific daily note

```json
{
  "markdown": "## Meeting Notes\n\n- Discussed Q1 goals",
  "position": {
    "position": "end",
    "date": "2025-01-15"
  }
}
```

### Responses

#### 200
Successfully created resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "15",
      "type": "text",
      "textStyle": "body",
      "markdown": "## Second Level Header\n\n- **List Item A**: Description text\n- **List Item B**: Description text"
    },
    {
      "id": "16",
      "type": "image",
      "url": "https://res.luki.io/user/full/space-id/doc/doc-id/uuid",
      "altText": "Alt text for accessibility",
      "markdown": "![Image](https://res.luki.io/user/full/space-id/doc/doc-id/uuid)"
    }
  ]
}
```

---

## Delete Blocks

`DELETE /blocks`

Delete content from daily notes. Removes specified blocks by their IDs.

### Request Body

**Content-Type:** `application/json`

```json
{
  "blockIds": [
    "7",
    "9",
    "12"
  ]
}
```

### Responses

#### 200
Successfully deleted resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "7"
    },
    {
      "id": "9"
    },
    {
      "id": "12"
    }
  ]
}
```

---

## Update Blocks

`PUT /blocks`

Update content in daily notes. For text blocks, provide updated markdown content. Only the fields that are provided will be updated.

### Request Body

**Content-Type:** `application/json`

```json
{
  "blocks": [
    {
      "id": "5",
      "markdown": "## Updated Section Title\n\nThis content has been updated with new information.",
      "font": "serif"
    },
    {
      "id": "8",
      "markdown": "# New Heading"
    }
  ]
}
```

### Responses

#### 200
Successfully updated resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "5",
      "type": "text",
      "textStyle": "body",
      "markdown": "## Updated Section Title\n\nThis content has been updated with new information.",
      "font": "serif"
    },
    {
      "id": "8",
      "type": "text",
      "textStyle": "h2",
      "markdown": "# New Heading"
    }
  ]
}
```

---

## Move Blocks

`PUT /blocks/move`

Move blocks to reorder them or move them to a different daily note. Returns the moved block IDs.

### Request Body

**Content-Type:** `application/json`

```json
{
  "blockIds": [
    "2",
    "3"
  ],
  "position": {
    "position": "end",
    "date": "today"
  }
}
```

### Responses

#### 200
Successfully moved resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "2"
    },
    {
      "id": "3"
    }
  ]
}
```

---

## Search in Document

`GET /blocks/search`

Search content within a specific daily note. Supports regex patterns for flexible searching. Use the 'date' query parameter to specify which daily note to search (defaults to 'today').

### Parameters

- **date** (required) (query): string
  The Daily Note date to search within. Accepts ISO format YYYY-MM-DD or relative dates: 'today', 'tomorrow', 'yesterday'.
- **pattern** (required) (query): string
  The search patterns to look for. Patterns must follow RE2-compatible syntax, which supports most common regular-expression features (literal text, character classes, grouping alternation, quantifiers, lookaheads, and fixed-width lookbehinds.
- **caseSensitive** (query): boolean
  Whether the search should be case sensitive. Default is false.
- **beforeBlockCount** (query): number
  The number of blocks to include before the matched block.
- **afterBlockCount** (query): number
  The number of blocks to include after the matched block.

### Responses

#### 200
Successfully retrieved data

**Content-Type:** `application/json`


**Example: withContext**

Search for 'Description' with context blocks

```json
{
  "items": [
    {
      "blockId": "109",
      "markdown": "List Item A: Description text",
      "pageBlockPath": [
        {
          "id": "0",
          "content": "Document Title"
        }
      ],
      "beforeBlocks": [
        {
          "blockId": "108",
          "markdown": "## Second Level Header"
        }
      ],
      "afterBlocks": [
        {
          "blockId": "110",
          "markdown": "List Item B: Description text"
        },
        {
          "blockId": "111",
          "markdown": "List Item C: Description text"
        }
      ]
    }
  ]
}
```

**Example: deeplyNested**

Search in deeply nested structure

```json
{
  "items": [
    {
      "blockId": "15",
      "markdown": "Match found here",
      "pageBlockPath": [
        {
          "id": "0",
          "content": "Document Title"
        },
        {
          "id": "12",
          "content": "Section Card"
        },
        {
          "id": "14",
          "content": "Nested Card"
        }
      ],
      "beforeBlocks": [
        {
          "blockId": "13",
          "markdown": "Previous content"
        }
      ],
      "afterBlocks": [
        {
          "blockId": "16",
          "markdown": "Following content"
        }
      ]
    }
  ]
}
```

---

## Search across Daily Notes

`GET /daily-notes/search`

Search content across multiple daily notes using relevance-based ranking. This endpoint uses FlexiSpaceSearch to find matches across your daily notes within an optional date range.

**Key Features:**
- Search across multiple daily notes (vs /blocks/search which searches a single daily note)
- Include term filtering
- Optional date range filtering (startDate/endDate)
- Relevance-based ranking (top 20 results)
- Context blocks before/after each match
- Supports relative dates: 'today', 'tomorrow', 'yesterday'

**Example Use Cases:**
- Find all mentions of a project across the last month
- Search for meeting notes from a specific time period
- Locate tasks or action items across multiple days

### Parameters

- **include** (query): string
  Search terms to include in the search. Can be a single string or array of strings.
- **regexps** (query): string
  Search terms to include in the search. Patterns must follow RE2-compatible syntax, which supports most common regular-expression features (literal text, character classes, grouping alternation, quantifiers, lookaheads, and fixed-width lookbehinds.
- **startDate** (query): string
  The start date for filtering daily notes. Accepts ISO format YYYY-MM-DD or relative dates: 'today', 'tomorrow', 'yesterday'. Only daily notes on or after this date will be included in the search.
- **endDate** (query): string
  The end date for filtering daily notes. Accepts ISO format YYYY-MM-DD or relative dates: 'today', 'tomorrow', 'yesterday'. Only daily notes on or before this date will be included in the search.
- **fetchMetadata** (query): boolean
  Whether to include document metadata (lastModifiedAt, createdAt) in each search result. Default is false.

### Responses

#### 200
Successfully retrieved data

**Content-Type:** `application/json`


**Example: basicSearch**

Search for 'meeting' across daily notes

```json
{
  "items": [
    {
      "dailyNoteDate": "2025-01-15",
      "markdown": "Team **meeting** at 2pm"
    },
    {
      "dailyNoteDate": "2025-01-12",
      "markdown": "Sprint planning **meeting**"
    }
  ]
}
```

**Example: dateRangeSearch**

Search within date range

```json
{
  "items": [
    {
      "dailyNoteDate": "2025-01-10",
      "markdown": "Working on project Alpha"
    }
  ]
}
```

---

## List Collections

`GET /collections`

List all collections across daily notes. Use optional startDate and endDate query parameters to filter collections by daily note date range.

### Parameters

- **startDate** (query): string
  The start date for filtering daily notes. Accepts ISO format YYYY-MM-DD or relative dates: 'today', 'tomorrow', 'yesterday'. Only collections in daily notes on or after this date will be included.
- **endDate** (query): string
  The end date for filtering daily notes. Accepts ISO format YYYY-MM-DD or relative dates: 'today', 'tomorrow', 'yesterday'. Only collections in daily notes on or before this date will be included.

### Responses

#### 200
Success

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "col1",
      "name": "Tasks",
      "itemCount": 5,
      "dailyNoteDate": "2025-01-15"
    },
    {
      "id": "col2",
      "name": "Notes",
      "itemCount": 3,
      "dailyNoteDate": "2025-01-14"
    }
  ]
}
```

---

## Get Collection Schema

`GET /collections/{collectionId}/schema`

Get collection schema in JSON Schema format

### Parameters

- **format** (query): string
  The format to return the schema in. Default: json-schema-items. - 'schema': Returns the collection schema structure that can be edited - 'json-schema-items': Returns JSON Schema for addCollectionItems/updateCollectionItems validation
- **collectionId** (required) (path): string

### Responses

#### 200
Successfully retrieved data

**Content-Type:** `application/json`


**Example: schemaFormat**

Schema format response

```json
{
  "key": "tasks",
  "name": "Tasks",
  "contentPropDetails": {
    "key": "title",
    "name": "Title"
  },
  "properties": [
    {
      "key": "status",
      "name": "Status",
      "type": "select",
      "options": [
        "Not Started",
        "In Progress",
        "Completed"
      ]
    },
    {
      "key": "priority",
      "name": "Priority",
      "type": "select",
      "options": [
        "Low",
        "Medium",
        "High"
      ]
    },
    {
      "key": "dueDate",
      "name": "Due Date",
      "type": "date"
    }
  ],
  "propertyDetails": [
    {
      "key": "status",
      "name": "Status",
      "type": "select",
      "options": [
        "Not Started",
        "In Progress",
        "Completed"
      ]
    },
    {
      "key": "priority",
      "name": "Priority",
      "type": "select",
      "options": [
        "Low",
        "Medium",
        "High"
      ]
    },
    {
      "key": "dueDate",
      "name": "Due Date",
      "type": "date"
    }
  ]
}
```

**Example: jsonSchemaFormat**

JSON Schema format (for validation)

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "description": "The title of the collection item"
          },
          "properties": {
            "type": "object",
            "properties": {
              "status": {
                "type": "string",
                "enum": [
                  "Not Started",
                  "In Progress",
                  "Completed"
                ],
                "description": "Status"
              },
              "priority": {
                "type": "string",
                "enum": [
                  "Low",
                  "Medium",
                  "High"
                ],
                "description": "Priority"
              },
              "dueDate": {
                "type": "string",
                "description": "Due Date"
              }
            }
          }
        },
        "required": [
          "title"
        ]
      }
    }
  },
  "required": [
    "items"
  ],
  "additionalProperties": false
}
```

---

## Get Collection Items

`GET /collections/{collectionId}/items`

Get all items from a collection

### Parameters

- **maxDepth** (query): number
  The maximum depth of nested content to fetch for each collection item. Default is -1 (all descendants). With a depth of 0, only the item properties are fetched without nested content.
- **collectionId** (required) (path): string

### Responses

#### 200
Successfully retrieved data

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "item1",
      "title": "Task 1",
      "properties": {
        "status": "In Progress",
        "priority": "High",
        "assignee": "John Doe"
      },
      "content": [
        {
          "id": "1",
          "type": "text",
          "markdown": "Detailed description of the task."
        }
      ]
    },
    {
      "id": "item2",
      "title": "Task 2",
      "properties": {
        "status": "Done",
        "priority": "Low",
        "assignee": "Jane Smith"
      }
    }
  ]
}
```

---

## Add Collection Items

`POST /collections/{collectionId}/items`

Add new items to a collection. Two-way relations are synced automatically in the background - only set one side for consistency.

### Parameters

- **collectionId** (required) (path): string

### Request Body

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "title": "Daily Task",
      "properties": {
        "status": "Todo",
        "dueDate": "2025-01-15"
      }
    }
  ]
}
```

### Responses

#### 200
Successfully created resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "item3",
      "title": "New Task",
      "properties": {
        "status": "Todo",
        "priority": "Medium"
      }
    }
  ]
}
```

---

## Delete Collection Items

`DELETE /collections/{collectionId}/items`

Delete collection items (also deletes content inside items)

### Parameters

- **collectionId** (required) (path): string

### Request Body

**Content-Type:** `application/json`

```json
{
  "idsToDelete": [
    "item1",
    "item2",
    "item3"
  ]
}
```

### Responses

#### 200
Successfully deleted resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "item1"
    },
    {
      "id": "item2"
    },
    {
      "id": "item3"
    }
  ]
}
```

---

## Update Collection Items

`PUT /collections/{collectionId}/items`

Update collection items. Two-way relations are synced automatically in the background - only set one side for consistency.

### Parameters

- **collectionId** (required) (path): string

### Request Body

**Content-Type:** `application/json`

```json
{
  "itemsToUpdate": [
    {
      "id": "item1",
      "properties": {
        "status": "Done"
      }
    }
  ]
}
```

### Responses

#### 200
Successfully updated resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "item1",
      "title": "Updated Task",
      "properties": {
        "status": "Done",
        "priority": "High"
      }
    }
  ]
}
```

---

## Get Tasks

`GET /tasks`

Retrieve tasks. Tasks are automatically organized into inbox, active, upcoming, and logbook categories.

### Parameters

- **scope** (required) (query): string
  Filter tasks by scope: - 'active': Active tasks from inbox and other documents (tasks due before now that are not completed/cancelled) - 'upcoming': Upcoming tasks from inbox and other documents (tasks scheduled after now) - 'inbox': Only tasks in the task inbox - 'logbook': Only tasks in the task logbook (completed and cancelled tasks)

### Responses

#### 200
Successfully retrieved data

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "task-1",
      "markdown": "Review project proposal",
      "taskInfo": {
        "state": "todo",
        "scheduleDate": "2025-01-15"
      }
    },
    {
      "id": "task-2",
      "markdown": "Finalize budget review",
      "taskInfo": {
        "state": "todo",
        "scheduleDate": "2025-01-16",
        "deadlineDate": "2025-01-20"
      }
    }
  ]
}
```

---

## Add Tasks

`POST /tasks`

Create new tasks in inbox or daily notes. Tasks can include schedule dates and deadlines.

### Request Body

**Content-Type:** `application/json`


**Example: addToInbox**

Add task to inbox (no location specified)

```json
{
  "tasks": [
    {
      "markdown": "Prepare presentation slides",
      "taskInfo": {
        "scheduleDate": "tomorrow"
      },
      "location": {
        "type": "inbox"
      }
    }
  ]
}
```


**Example: addToDailyNote**

Add task to a daily note with relative date

```json
{
  "tasks": [
    {
      "markdown": "Team meeting notes",
      "location": {
        "type": "dailyNote",
        "date": "today"
      }
    }
  ]
}
```

### Responses

#### 200
Successfully created resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "task-new-1",
      "markdown": "Prepare presentation slides",
      "taskInfo": {
        "state": "todo",
        "scheduleDate": "2025-01-16"
      }
    }
  ]
}
```

---

## Delete Tasks

`DELETE /tasks`

Delete tasks by their IDs. Only tasks in inbox, logbook, or daily notes can be deleted.

### Request Body

**Content-Type:** `application/json`

```json
{
  "idsToDelete": [
    "1",
    "2"
  ]
}
```

### Responses

#### 200
Successfully deleted resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "task-1"
    },
    {
      "id": "task-2"
    }
  ]
}
```

---

## Update Tasks

`PUT /tasks`

Update existing tasks. Can modify task content, state, schedule dates, and deadlines. Marking tasks as done/canceled moves them to logbook.

### Request Body

**Content-Type:** `application/json`


**Example: markDone**

Mark task as done (moves to logbook)

```json
{
  "tasksToUpdate": [
    {
      "id": "1",
      "taskInfo": {
        "state": "done"
      }
    }
  ]
}
```


**Example: updateContentAndSchedule**

Update task content and schedule date

```json
{
  "tasksToUpdate": [
    {
      "id": "2",
      "markdown": "Updated task description",
      "taskInfo": {
        "scheduleDate": "tomorrow"
      }
    }
  ]
}
```

### Responses

#### 200
Successfully updated resource

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "task-1",
      "taskInfo": {
        "state": "done"
      }
    }
  ]
}
```

---
