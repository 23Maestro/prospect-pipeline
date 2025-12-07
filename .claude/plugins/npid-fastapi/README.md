# NPID FastAPI Plugin

FastAPI router pattern enforcement for NPID legacy integration. Ensures all FastAPI routers follow the translator pattern and avoid common pitfalls when integrating with Laravel legacy systems.

## Overview

This plugin provides:
- **Slash commands** for router validation and creation
- **Validator agent** for automated compliance checking
- **Session initialization** to load NPID constraints
- **Git pre-commit hook** to block non-compliant commits

## Installation

### Option 1: Local Development (Recommended for Testing)

1. **Add as local marketplace:**
   ```bash
   /plugin marketplace add /Users/singleton23/Raycast/prospect-pipeline/.claude/plugins/npid-fastapi
   ```

2. **Install the plugin:**
   ```bash
   /plugin install npid-fastapi@npid-fastapi
   ```

3. **Restart Claude Code** to load the plugin

### Option 2: Git Installation

```bash
/plugin marketplace add <your-repo-url>
/plugin install npid-fastapi
```

## Components

### Slash Commands

All commands are auto-discovered from the `commands/` directory:

#### `/npid:init-session`
Initialize Claude Code session with all NPID skills and constraints.

**When to use:**
- Starting work on FastAPI routers
- Need to load NPID patterns and validation rules
- Want quick access to validation commands

**What it does:**
- Loads all NPID skills into session context
- Displays critical constraints and patterns
- Provides quick reference commands
- Shows session checklist

#### `/npid:validate-routers`
Validate all FastAPI routers against npid-fastapi-skill.md patterns.

**When to use:**
- Before committing router changes
- After modifying any router file
- Debugging router compliance issues
- Regular compliance audits

**What it checks:**
1. Import pattern (NPIDSession class, not get_session function)
2. Local get_session() helper presence
3. LegacyTranslator usage
4. No inline form construction
5. No inline HTML parsing
6. Session wrapper compliance (session.post, not client.post)
7. No JSON body usage (must use form-encoding)

**Output:**
- Detailed violation report with file:line references
- Fix suggestions for each violation
- Compliance summary

#### `/npid:new-router <name>`
Create new FastAPI router using vetted template.

**When to use:**
- Creating a new router file
- Need correct patterns from the start
- Avoid common setup mistakes

**What it creates:**
- Router file with correct imports
- Local get_session() helper
- LegacyTranslator integration
- Example endpoint using translator pattern
- Proper error handling

#### `/npid:fix-email-router`
Fix email router import violation.

**When to use:**
- Email router has import violations
- Quick fix for known issue
- Need automated correction

**What it fixes:**
- Changes import to NPIDSession class
- Adds local get_session() helper
- Updates any incorrect usage patterns

### Validator Agent

The validator agent (`agents/validator.md`) performs comprehensive router validation.

**How to invoke:**

1. **Via slash command (Recommended):**
   ```bash
   /npid:validate-routers
   ```

2. **Via git pre-commit hook:**
   Automatically runs when committing router files

3. **Manually via Task tool:**
   ```
   Use the Task tool with the validator agent to check router compliance
   ```

**What it validates:**
- All 7 compliance rules (see `/npid:validate-routers` above)
- Generates detailed violation report
- Provides file:line references
- Suggests specific fixes for each violation

**Validation Report Format:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FASTAPI ROUTER VALIDATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Routers Checked: 4
Violations Found: [COUNT]

[If violations found:]
❌ VIOLATION 1: Import Pattern
File: npid-api-layer/app/routers/email.py:14
Found: from app.session import get_session
Expected: from app.session import NPIDSession

💡 Fix:
  1. Change line 14 to: from app.session import NPIDSession
  2. Add local helper after logger
  3. Run /npid:fix-email-router for automated fix

[If no violations:]
✅ ALL ROUTERS COMPLIANT
Ready to commit!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Hooks

#### Session Start Hook
**File:** `hooks/session-start.sh`
**Trigger:** When Claude Code session starts
**Action:** Displays NPID plugin banner with quick commands

**Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NPID FastAPI Plugin Active
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 Quick Commands:
  /npid:init-session        - Load all NPID skills & constraints
  /npid:validate-routers    - Check router compliance
  /npid:new-router <name>   - Create new router from template
  /npid:fix-email-router    - Fix known import violations

⚠️  Working with FastAPI routers? Run /npid:init-session first!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Pre-Commit Hook (Git)
**File:** `hooks/pre-commit.sh`
**Trigger:** Git pre-commit (must be installed manually)
**Action:** Validates router files before allowing commit

**Setup:**
```bash
# Copy to git hooks directory
cp .claude/plugins/npid-fastapi/hooks/pre-commit.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

**Behavior:**
- Only runs if router files changed in commit
- Performs all 7 validation checks
- Blocks commit if violations found
- Displays fix suggestions
- Allows commit if all checks pass

## Plugin Structure

```
npid-fastapi/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (REQUIRED)
├── commands/                    # Auto-discovered slash commands
│   ├── npid-init-session.md
│   ├── npid-validate-routers.md
│   ├── npid-new-router.md
│   └── npid-fix-email-router.md
├── agents/                      # Validator agent
│   └── validator.md
├── hooks/                       # Event hooks
│   ├── hooks.json              # Claude Code hooks config
│   ├── session-start.sh        # SessionStart hook
│   └── pre-commit.sh           # Git pre-commit hook
└── README.md                    # This file
```

## Usage Workflow

### Starting a Session

1. **Start Claude Code** (session-start hook displays banner)
2. **Run initialization:**
   ```bash
   /npid:init-session
   ```
3. **Begin work on routers**

### Creating a New Router

1. **Use the template command:**
   ```bash
   /npid:new-router analytics
   ```
2. **Implement your endpoints** following the pattern
3. **Validate before committing:**
   ```bash
   /npid:validate-routers
   ```

### Modifying Existing Routers

1. **Make your changes**
2. **Validate compliance:**
   ```bash
   /npid:validate-routers
   ```
3. **Fix any violations** (use `/npid:fix-email-router` for known issues)
4. **Re-validate:**
   ```bash
   /npid:validate-routers
   ```
5. **Commit** (pre-commit hook will run automatically if installed)

### Fixing Violations

**Automated fix (email router only):**
```bash
/npid:fix-email-router
```

**Manual fix:**
1. Review violation report from `/npid:validate-routers`
2. Check referenced documentation (npid-fastapi-skill.md)
3. Apply suggested fixes
4. Re-validate

## Compliance Rules

### 1. Import Pattern
✅ **Correct:**
```python
from app.session import NPIDSession
```

❌ **Wrong:**
```python
from app.session import get_session
```

### 2. Local Helper
✅ **Required in every router:**
```python
def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager
```

### 3. Translator Pattern
✅ **All Laravel calls through translator:**
```python
from app.translators.legacy import LegacyTranslator

translator = LegacyTranslator()
endpoint, form_data = translator.method_to_legacy(payload)
response = session.post(endpoint, data=form_data)
```

❌ **No inline form construction:**
```python
# DON'T DO THIS
form_data = {
    "_token": session.csrf_token,
    "athlete_id": payload.athlete_id
}
```

### 4. No Inline Parsing
❌ **Don't parse HTML in routers:**
```python
# DON'T DO THIS
from bs4 import BeautifulSoup
soup = BeautifulSoup(response.text, 'html.parser')
```

✅ **Use translator parse methods:**
```python
seasons = translator.parse_seasons_html(response.text)
```

### 5. Session Wrapper
✅ **Use session.post():**
```python
response = session.post(endpoint, data=form_data)
```

❌ **Don't use client.post():**
```python
response = client.post(endpoint, data=form_data)  # Missing CSRF
```

### 6. Form Encoding
✅ **Use data= parameter:**
```python
session.post(endpoint, data=form_data)
```

❌ **Don't use json= parameter:**
```python
session.post(endpoint, json=form_data)  # Laravel expects form-encoding
```

## Troubleshooting

### Plugin Not Loading
1. Check plugin location: `.claude/plugins/npid-fastapi/`
2. Verify `.claude-plugin/plugin.json` exists
3. Restart Claude Code

### Commands Not Appearing
1. Commands are in `commands/` directory
2. Each has `.md` extension
3. Restart Claude Code after adding commands

### Hooks Not Firing
1. Check `hooks/hooks.json` exists
2. Verify script permissions: `chmod +x hooks/*.sh`
3. Check paths use `${CLAUDE_PLUGIN_ROOT}`
4. Restart Claude Code

### Git Pre-Commit Hook Not Running
1. Copy to `.git/hooks/pre-commit`:
   ```bash
   cp .claude/plugins/npid-fastapi/hooks/pre-commit.sh .git/hooks/pre-commit
   chmod +x .git/hooks/pre-commit
   ```
2. Test manually: `.git/hooks/pre-commit`

### Validator False Positives
1. Check you're in the correct directory
2. Verify `npid-api-layer/app/routers/` path exists
3. Review regex patterns in validator.md
4. File issue with examples

## Development

### Testing Changes Locally

1. **Uninstall current version:**
   ```bash
   /plugin uninstall npid-fastapi
   ```

2. **Make changes** to commands, agents, or hooks

3. **Reinstall:**
   ```bash
   /plugin install npid-fastapi@npid-fastapi
   ```

4. **Restart Claude Code**

### Adding New Commands

1. **Create command file** in `commands/command-name.md`
2. **Use frontmatter:**
   ```markdown
   ---
   description: What the command does
   ---

   # Command Instructions
   Tell Claude what to do...
   ```
3. **Test** by reinstalling plugin
4. **Invoke:** `/npid:command-name`

### Modifying Validator

1. **Edit** `agents/validator.md`
2. **Update validation rules** as needed
3. **Update** `/npid:validate-routers` command to match
4. **Update** `hooks/pre-commit.sh` checks
5. **Test** all three invocation methods

## Version History

### 1.0.0 (Current)
- Initial plugin structure
- 4 slash commands
- Validator agent
- SessionStart hook
- Git pre-commit hook
- Comprehensive documentation

## Contributing

When contributing to this plugin:

1. **Follow plugin structure** (commands in `commands/`, etc.)
2. **Use `${CLAUDE_PLUGIN_ROOT}`** for all paths
3. **Make scripts executable** with `chmod +x`
4. **Test locally** before committing
5. **Update README** for new features
6. **Validate** with `/npid:validate-routers`

## License

MIT

## Author

Jerami Singleton

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review validator.md for validation details
3. Check npid-fastapi-skill.md for pattern reference
4. File issue with reproduction steps
