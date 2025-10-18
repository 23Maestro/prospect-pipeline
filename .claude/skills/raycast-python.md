# Raycast Python Integration Skill

Build Raycast extensions that call Python scripts for backend operations.

## Context
- **Client**: Prospect ID (Client 2)
- **Project**: Prospect Pipeline Raycast Extensions
- **Pattern**: TypeScript UI → Python REST API Bridge

## Architecture

```
Raycast Extension (TypeScript)
    ↓
python-server-client.ts (spawn Python)
    ↓
Python Script (npid_api_client.py)
    ↓
NPID Dashboard REST API
```

## Python Server Client Pattern

### File: `src/lib/python-server-client.ts`
```typescript
import { spawn } from "child_process";

export async function callPythonServer<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const process = spawn(PYTHON_PATH, [SCRIPT_PATH, method, JSON.stringify(args)]);

    let stdout = "";
    process.stdout.on("data", (data) => { stdout += data.toString(); });
    process.on("close", (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout) as T);
      } else {
        reject(new Error("Python script failed"));
      }
    });
  });
}
```

### Python Script Pattern
```python
#!/usr/bin/env python3
import sys
import json

def main():
    method = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}

    # Execute method
    result = execute_method(method, args)

    # Return JSON to stdout
    print(json.dumps(result))
    sys.exit(0)

if __name__ == "__main__":
    main()
```

## Common Issues & Solutions

### ⚠️ Shebang Path Problem
**Issue**: Hardcoded Python paths break portability
```python
#!/Users/singleton23/.pyenv/shims/python3  # ❌ Bad - user-specific
#!/usr/bin/env python3                     # ✅ Good - portable
```

**Solution**: Pass Python path explicitly in spawn()
```typescript
const pythonPath = process.env.PYTHON_PATH || 'python3';
spawn(pythonPath, [scriptPath, method, args]);
```

### Missing Dependencies
**Issue**: System Python lacks packages (requests, beautifulsoup4)

**Solution**: Check dependencies before spawn
```typescript
async function validatePythonEnv() {
  const check = spawn('python3', ['-c', 'import requests']);
  // Handle validation...
}
```

## Raycast Extension Structure

```
src/
  ├── email-student-athletes.tsx    # UI Component
  ├── lib/
  │   ├── python-server-client.ts   # Python bridge
  │   └── npid-mcp-adapter.ts       # API adapter
  └── types/
      └── video-team.ts              # TypeScript types

scripts/
  └── email_automation.py            # Python backend

mcp-servers/npid-native/
  └── npid_api_client.py            # REST API client
```

## Best Practices

1. **Error Handling**: Always handle Python script failures gracefully
2. **Type Safety**: Use TypeScript generics for return types
3. **Timeout**: Set reasonable timeouts for Python operations
4. **Logging**: Log Python stdout/stderr for debugging
5. **Validation**: Validate JSON before parsing
6. **Environment**: Detect Python environment dynamically

## Example: Email Automation

### Raycast Component
```typescript
// src/email-student-athletes.tsx
const { handleSubmit } = useForm({
  async onSubmit(values) {
    const result = await execAsync(
      `python3 scripts/email_automation.py --athlete_name "${values.name}" --template_value "${values.template}"`
    );
  }
});
```

### Python Script
```python
# scripts/email_automation.py
import argparse
from npid_api_client import NPIDAPIClient

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--athlete_name', required=True)
    parser.add_argument('--template_value', required=True)
    args = parser.parse_args()

    client = NPIDAPIClient()
    client.login()
    result = send_email(args.athlete_name, args.template_value)

    print("--- Email Process Attempted ---")  # Success marker
    sys.exit(0)
```

## Debugging

```bash
# Test Python script directly
python3 scripts/email_automation.py --athlete_name "Test" --template_value "Template"

# Check Python path
which python3

# Verify dependencies
python3 -c "import requests; import bs4; print('OK')"

# Run extension in dev mode
npm run dev
```
