# Project Structure

## Root Directory Organization

```
prospect-pipeline/
├── .claude/                    # Claude Code configuration
│   ├── commands/              # Kiro slash commands
│   └── skills/                # Development skills and guides
├── .kiro/                     # Kiro spec-driven development
│   ├── steering/              # Project steering documents (this file!)
│   └── specs/                 # Feature specifications
├── src/                       # Main Raycast extension code
│   ├── *.tsx                  # Raycast command components
│   ├── lib/                   # Shared utilities and clients
│   ├── python/                # Python NPID API client
│   ├── tools/                 # Helper functions
│   └── types/                 # TypeScript type definitions
├── prospect-mcp-servers/      # MCP bridge servers (legacy)
├── prospect-id-tasks/         # Next.js task board (separate project)
├── supabase/                  # Supabase configuration
├── node_modules/              # npm dependencies
├── package.json               # Project dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── raycast-env.d.ts          # Raycast type declarations
└── README.md                  # Project overview
```

## Source Code Structure (`src/`)

### Raycast Command Files (Top Level)
Each `.tsx` file in `src/` is a Raycast command (entry point):

```
src/
├── active-tasks.tsx                 # Browse Notion video tasks
├── assign-videoteam-inbox.tsx       # Assign NPID inbox threads
├── read-videoteam-inbox.tsx         # Read assigned messages
├── email-student-athletes.tsx       # Send templated emails
└── video-updates.tsx                # Update video profiles
```

**Naming Convention**: `kebab-case.tsx` matches command name in `package.json`

**Structure Pattern**:
```typescript
// 1. Imports
import { Form, Action, showToast } from '@raycast/api';

// 2. Type definitions
interface FormValues { ... }

// 3. Helper functions
async function helperFunction() { ... }

// 4. Default export component
export default function CommandName() {
  // Component logic
  return <Form>...</Form>;
}
```

### Subdirectories

#### `src/lib/` - Shared Utilities
Core libraries used across multiple commands:

```
src/lib/
├── npid-mcp-adapter.ts          # NPID API wrapper functions
├── npid-mcp.ts                  # NPID MCP client (legacy)
├── python-server-client.ts      # Python process executor
└── supabase-client.ts           # Supabase connection
```

**Purpose**: Centralize API calls and data fetching logic

**Usage Example**:
```typescript
import { callPythonServer } from './lib/python-server-client';

const result = await callPythonServer('search_player', { query: 'John Doe' });
```

#### `src/python/` - Python Backend
Python scripts for NPID REST API interaction:

```
src/python/
├── npid_api_client.py               # Main NPID client (CLI interface)
├── npid_video_progress_sync.py      # Video progress helpers
├── requirements.txt                 # Python dependencies
└── venv/                            # Virtual environment (gitignored)
```

**Execution Model**: Spawned as child process from TypeScript
```typescript
// TypeScript calls Python via spawn
spawn(`python3 ${PYTHON_PATH} method_name '${JSON.stringify(args)}'`)
```

**CLI Interface**: Each Python method can be tested standalone:
```bash
python3 npid_api_client.py search_player '{"query": "John Doe"}'
```

#### `src/types/` - TypeScript Types
Shared type definitions for data models:

```
src/types/
├── video-team.ts                # Video team inbox types
└── workflow.ts                  # Task stage/status enums
```

**Type Organization**:
- **Interfaces**: Data structures (e.g., `NPIDInboxMessage`)
- **Enums**: Constrained values (e.g., `TaskStage`, `TaskStatus`)
- **Type aliases**: Union types for flexibility

**Example**:
```typescript
export type TaskStage =
  | 'HUDL'
  | 'Dropbox'
  | 'Not Approved'
  | 'Revise'
  | 'Done';
```

#### `src/tools/` - Helper Functions
Utility functions for specific tasks:

```
src/tools/
├── generate-content.ts          # Content generation helpers
├── npid-inbox.ts                # Inbox-specific utilities
└── reconnect.ts                 # Session management
```

**Purpose**: Keep command files clean by extracting reusable logic

## Configuration Files

### Core Configuration
```
package.json              # Dependencies, scripts, Raycast metadata
tsconfig.json            # TypeScript compiler settings
raycast-env.d.ts         # Global type declarations for Raycast
```

### Development Configuration
```
eslint.config.js         # ESLint rules (modern flat config)
.gitignore              # Ignored files and directories
.prettierrc             # Code formatting rules (if exists)
```

### Python Configuration
```
src/python/requirements.txt      # Python package versions
src/python/.gitignore           # Python-specific ignores
```

## Key Architectural Principles

### 1. **Separation of Concerns**
- **UI Layer** (`*.tsx`): Raycast components and user interaction
- **API Layer** (`lib/`): Data fetching and external service calls
- **Business Logic** (`tools/`): Data transformation and validation
- **Data Layer** (`python/`): NPID REST API client

### 2. **Type Safety**
- All shared data structures defined in `types/`
- TypeScript strict mode disabled (Raycast compatibility)
- Generic types for Python API responses: `callPythonServer<T>()`

### 3. **Functional Composition**
```typescript
// Good: Compose small, testable functions
const searchPlayers = (query: string) => callPythonServer('search_player', { query });
const filterActive = (players: Player[]) => players.filter(p => p.stage !== 'Done');
const getActivePlayersForQuery = (query: string) =>
  searchPlayers(query).then(filterActive);
```

### 4. **Error Handling Pattern**
```typescript
try {
  const result = await riskyOperation();
  await showToast({ style: Toast.Style.Success, title: 'Success!' });
} catch (error) {
  console.error('Operation failed:', error);
  await showToast({
    style: Toast.Style.Failure,
    title: 'Failed',
    message: error instanceof Error ? error.message : 'Unknown error'
  });
}
```

### 5. **State Management**
- **Local state**: `useState` for component-level state
- **Form state**: `useForm` hook from @raycast/utils
- **Persistent state**: `useCachedState` for draft values
- **No global state**: Each command is independent

## File Naming Conventions

### TypeScript Files
- **Commands**: `kebab-case.tsx` (e.g., `video-updates.tsx`)
- **Libraries**: `kebab-case.ts` (e.g., `python-server-client.ts`)
- **Types**: `kebab-case.ts` (e.g., `video-team.ts`)
- **Components** (if extracted): `PascalCase.tsx` (e.g., `AssignmentModal.tsx`)

### Python Files
- **Scripts**: `snake_case.py` (e.g., `npid_api_client.py`)
- **CLI executables**: Add shebang `#!/usr/bin/env python3`

### Configuration Files
- **JSON**: `kebab-case.json` (e.g., `package.json`, `tsconfig.json`)
- **JavaScript**: `kebab-case.js` (e.g., `eslint.config.js`)
- **Environment**: `.env` (not committed to git)

## Import Organization

### Import Order
```typescript
// 1. External dependencies (alphabetical)
import { Form, Action } from '@raycast/api';
import { useForm } from '@raycast/utils';

// 2. Internal libraries (relative paths)
import { callPythonServer } from './lib/python-server-client';
import { supabase } from './lib/supabase-client';

// 3. Type imports (separate section)
import type { NPIDPlayer } from './types/video-team';
import type { TaskStage } from './types/workflow';
```

### Path Aliases
No path aliases configured. Use relative imports:
```typescript
// Good
import { helper } from './lib/helper';
import { type Player } from './types/player';

// Bad (no @/ alias configured)
import { helper } from '@/lib/helper'; // Won't work
```

## Code Organization Patterns

### Component Structure
```typescript
export default function CommandName() {
  // 1. State declarations
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<T[]>([]);

  // 2. Form handling
  const { handleSubmit, itemProps } = useForm<FormValues>({ ... });

  // 3. Effects
  useEffect(() => { ... }, [dependencies]);

  // 4. Event handlers
  const handleAction = async () => { ... };

  // 5. Render
  return <Form>...</Form>;
}
```

### API Client Pattern
```typescript
// lib/api-client.ts
export async function fetchResource<T>(endpoint: string): Promise<T> {
  const response = await callPythonServer<T>(endpoint, {});
  if (response.status !== 'ok') {
    throw new Error(response.message);
  }
  return response.data;
}
```

### Type Definition Pattern
```typescript
// types/domain.ts
export interface Entity {
  id: string;
  name: string;
  // ... fields
}

export type EntityStatus = 'active' | 'inactive' | 'archived';

export interface EntityWithStatus extends Entity {
  status: EntityStatus;
}
```

## Directory Ownership & Responsibilities

| Directory | Owner | Purpose | Can Modify? |
|-----------|-------|---------|-------------|
| `src/*.tsx` | Frontend Team | Raycast command UI | Yes |
| `src/lib/` | Shared | API clients and utilities | Yes (coordinate) |
| `src/python/` | Backend Team | NPID API client | Yes |
| `src/types/` | Shared | Type definitions | Yes (coordinate) |
| `.kiro/` | AI/Spec Team | Spec-driven development | Via `/kiro:*` commands |
| `prospect-id-tasks/` | Separate Project | Next.js task board | Independent |

## Testing Organization (Future)

When tests are added, follow this structure:
```
src/
├── lib/
│   ├── api-client.ts
│   └── api-client.test.ts        # Co-located tests
├── types/
│   └── validators.test.ts        # Type validation tests
└── __tests__/
    └── integration/              # Cross-module tests
```

## Build Output Structure

```
dist/                            # Build output (gitignored)
├── index.js                     # Bundled extension
├── assets/                      # Images and icons
└── metadata/                    # Extension manifest
```

**Generated by**: `npm run build` (via Raycast CLI)

## Documentation Structure

```
README.md                        # Project overview
API_DOCUMENTATION.md            # NPID API reference
IMPLEMENTATION_SPEC.md          # Feature specifications
REST_API_MIGRATION_COMPLETE.md  # Migration notes
FULL_MESSAGE_FETCH_SPEC.md      # Message fetching spec
.claude/skills/                 # Development guides
```

**Philosophy**: Keep docs close to code, markdown for everything

## MCP Server Structure (Legacy)

```
prospect-mcp-servers/
├── notion-bridge/               # Notion MCP server (not actively used)
│   ├── notion_server.py
│   └── notion_bridge.py
└── video-team-bridge/          # Video team MCP server (not actively used)
    ├── npid_server.py
    └── npid_bridge.py
```

**Status**: These were for MCP integration but are not actively used. Direct API calls via `src/lib/` are preferred.

## Git Ignore Strategy

### Always Ignored
```
node_modules/              # npm dependencies
dist/                      # Build output
.DS_Store                 # macOS metadata
*.pkl                     # Python session cookies
venv/                     # Python virtual environment
.env                      # Environment variables
```

### Never Ignored (Important!)
```
.kiro/steering/           # Project knowledge base
src/                      # All source code
package.json              # Dependencies
tsconfig.json             # TypeScript config
```

## Future Structure Improvements

Potential reorganizations (not implemented yet):
- Move Python client to separate npm package
- Add `src/components/` for reusable UI components
- Create `src/hooks/` for custom React hooks
- Add `src/constants/` for shared configuration values
- Implement `src/__tests__/` for test files
