# Technology Stack

## Architecture Overview

**Hybrid Architecture**: Raycast TypeScript frontend + Python REST API client backend

```
┌─────────────────────────────────────────────────────────┐
│                    Raycast Extension                     │
│  (TypeScript/React - User Interface & Orchestration)   │
└─────────────────────┬───────────────────────────────────┘
                      │
           ┌──────────┴──────────┐
           │                     │
┌──────────▼─────────┐  ┌───────▼────────┐
│  Python API Client │  │   Notion API   │
│  (NPID Dashboard)  │  │  (Task Board)  │
└──────────┬─────────┘  └───────┬────────┘
           │                     │
           │                     │
┌──────────▼─────────────────────▼────────┐
│         Supabase (Configuration)        │
└─────────────────────────────────────────┘
```

## Frontend

### Framework
- **Raycast API** (`@raycast/api` ^1.102.7): Native Raycast extension framework
  - Form components (TextField, Dropdown, ActionPanel)
  - List views with search and filtering
  - Toast notifications and loading states
  - Navigation and routing

### UI Libraries
- **@raycast/utils** (^2.2.1): Utility hooks and helpers
  - `useForm`: Form validation and state management
  - `useCachedState`: Persistent local storage
  - React hooks for common patterns

### State Management
- React hooks (useState, useEffect)
- Form state via @raycast/utils
- No global state library (not needed for Raycast extensions)

### Data Fetching
- Direct API calls via `callPythonServer()` utility
- Notion API via `@notionhq/client` (^2.2.0)
- Supabase queries via `@supabase/supabase-js` (^2.58.0)

## Backend

### Primary Language
- **Python 3.13**: NPID API client and automation
- **Node.js**: Runtime for Raycast extension

### Python Stack
- **requests**: HTTP client for NPID REST API
- **BeautifulSoup4**: HTML parsing for NPID responses
- **pickle**: Session cookie persistence
- **logging**: Structured logging for debugging

### Key Python Modules
```
src/python/
├── npid_api_client.py       # Main NPID REST client
└── npid_video_progress_sync.py  # Video progress utilities
```

### Python-TypeScript Bridge
- **python-shell** (^5.0.0): Execute Python scripts from Node.js
- **spawn**: Child process execution for Python calls
- JSON-based communication between layers

```typescript
// TypeScript → Python communication
const result = await callPythonServer<T>(
  'method_name',
  { arg1: 'value', arg2: 123 }
);
```

## Database & Storage

### Supabase
- **PostgreSQL**: Configuration and metadata storage
- **Row Level Security**: User-based access control (configured)
- **Connection**: Direct client via environment variables

### Local Storage
- **Pickle files**: Python session cookies (~/.npid_session.pkl)
- **Raycast cache**: Draft values and preferences
- **Git-ignored**: Sensitive session data

## External Services

### NPID (National Prospect ID)
- **Base URL**: https://dashboard.nationalpid.com
- **Authentication**: Cookie-based with 400-day remember token
- **Session Management**: Automatic validation and re-login
- **Endpoints Used**:
  - `/auth/login` - Authentication
  - `/rulestemplates/template/videoteammessagelist` - Inbox threads
  - `/videoteammsg/assignvideoteam` - Assignment
  - `/athlete/{id}/videos/add` - Video uploads
  - `/admin/addnotification` - Email sending
  - `/videoteammsg/videoprogress` - Video progress search

### Notion
- **Integration Type**: Internal integration (not OAuth)
- **API Version**: 2022-06-28
- **Database ID**: `19f4c8bd6c26805b9929dfa8eb290a86` (Video Tasks)
- **Query Patterns**: Filter by status, sort by due date
- **Authentication**: Integration token (not user-based)

## Development Environment

### Required Tools
- **Node.js**: v20+ (for Raycast development)
- **Python**: 3.13+ (for NPID client)
- **Raycast**: Latest stable version
- **Git**: Version control
- **npm**: Package management

### Installation
```bash
# Install Node dependencies
npm install

# Create Python virtual environment
cd src/python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Python Dependencies (requirements.txt)
```
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=5.0.0
```

## Common Commands

### Development
```bash
npm run dev           # Start Raycast development mode
npm run build         # Build extension for production
npm run lint          # Run ESLint
```

### Python Testing
```bash
cd src/python
source venv/bin/activate
python npid_api_client.py login              # Test authentication
python npid_api_client.py get_inbox_threads '{"limit": 10}'
python npid_api_client.py search_video_progress '{"first_name": "John", "last_name": "Doe"}'
```

### Debugging
```bash
# Check Python server directly
python3 /Users/singleton23/Raycast/prospect-pipeline/src/python/npid_api_client.py \
  search_video_progress '{"first_name": "John", "last_name": "Doe"}'
```

## Environment Variables

### Required (set in Raycast preferences)
```bash
NOTION_TOKEN              # Notion integration token
SUPABASE_URL             # Supabase project URL
SUPABASE_ANON_KEY        # Supabase anonymous key
```

### Optional (Python environment)
```bash
NPID_EMAIL               # NPID login email (default: jsingleton@prospectid.com)
NPID_PASSWORD            # NPID login password
```

## Port Configuration

**No ports required** - Raycast extensions run in-process
- Python scripts executed via spawn (not a server)
- NPID API: HTTPS (443) to dashboard.nationalpid.com
- Supabase: HTTPS (443) to Supabase endpoint
- Notion API: HTTPS (443) to api.notion.com

## Build & Deployment

### Build Process
```bash
npm run build
# Output: dist/ directory with bundled extension
```

### Deployment
1. **Development**: `npm run dev` → hot reload in Raycast
2. **Local Install**: Build and import into Raycast
3. **Store Submission**: Package and submit to Raycast Store (future)

### CI/CD
- No CI configured yet
- Manual testing via Raycast development mode
- TypeScript type checking via `npm run lint`

## Code Quality Tools

### Linting
- **ESLint** (^9.37.0): JavaScript/TypeScript linting
- **@typescript-eslint/eslint-plugin** (^8.45.0): TypeScript rules
- **@typescript-eslint/parser** (^8.45.0): TypeScript parser
- **eslint-config-prettier**: Prettier compatibility

### Type Checking
- **TypeScript** (^4.9.5): Static type analysis
- **tsconfig.json**: Strict mode disabled (for Raycast compatibility)
- **@types/node** (^20.11.0): Node.js type definitions
- **@types/react** (18.0.9): React type definitions

### Configuration Files
```
tsconfig.json          # TypeScript compiler config
eslint.config.js       # ESLint rules (not .eslintrc)
package.json           # Dependencies and scripts
raycast-env.d.ts       # Raycast type declarations
```

## Security Considerations

### Credential Storage
- **NPID credentials**: Environment variables only (never committed)
- **Session cookies**: Local pickle file in home directory
- **API tokens**: Raycast secure preferences storage
- **Git ignore**: All sensitive files (.pkl, .env, credentials)

### Session Management
- **400-day remember token**: Minimize re-authentication
- **Automatic session validation**: Check before each API call
- **Graceful re-login**: Transparent to user if session expires

### Data Privacy
- **Local execution**: All data processing happens locally
- **No telemetry**: No usage tracking or analytics
- **User-owned data**: All data stays in user's NPID/Notion accounts

## Performance Optimizations

### Caching
- **NPID session cookies**: Persisted to disk
- **Raycast draft values**: Form state preserved between launches
- **Search results**: Debounced with 500ms delay

### Lazy Loading
- **Python process spawn**: Only when needed
- **Notion queries**: Filtered server-side before fetch
- **NPID pagination**: Fetch only visible items (15-100 max)

### Error Handling
- **Graceful degradation**: Fallback to manual flows on errors
- **Detailed logging**: Python logging module for debugging
- **User-friendly errors**: Toast messages with actionable guidance

## Technology Decisions & Rationale

### Why Python for NPID?
- NPID dashboard requires complex HTML parsing
- BeautifulSoup4 excellent for scraping
- Session management easier with requests library
- Pickle for simple cookie persistence

### Why Raycast?
- Target users already use Raycast for productivity
- Keyboard-first interface matches workflow
- Native macOS integration
- Fast, local execution (no cloud dependencies)

### Why Not Use Selenium?
- **Migration complete**: Previously used Selenium, now REST API
- **Performance**: REST is 10x faster than browser automation
- **Reliability**: No browser startup delays or crashes
- **Maintenance**: Easier to debug HTTP calls than browser interactions

### Why Notion API?
- Official API more reliable than scraping
- Real-time updates via subscriptions (future)
- Type-safe with official SDK
- Better error handling than web scraping

## Version Compatibility

- **Node.js**: 20.x LTS recommended
- **Python**: 3.13+ (uses new features)
- **Raycast**: 1.60+ (API version 1.102.7)
- **macOS**: 12.0+ (Raycast requirement)
