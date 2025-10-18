# Prospect Pipeline Skills (Client 2 - Prospect ID)

Skills for building and maintaining the Prospect ID video team workflow automation.

## Available Skills

### 1. **npid-api.md** - NPID API Client
Interact with National PID Dashboard REST API for athlete operations.

**Use when:**
- Making API calls to NPID Dashboard
- Authenticating with the platform
- Searching for athletes
- Sending emails via templates
- Managing sessions

**Key operations:**
- Session management (400-day persistence)
- Video progress workflow search
- Email template retrieval
- Athlete email notifications

---

### 2. **raycast-python.md** - Raycast Python Integration
Build Raycast extensions that bridge TypeScript UI to Python backend.

**Use when:**
- Creating new Raycast commands
- Debugging Python script execution
- Fixing environment/dependency issues
- Implementing TypeScript → Python communication

**Key patterns:**
- Python spawn() from Node.js
- Error handling and validation
- Environment detection
- Shebang best practices

---

### 3. **video-team-workflow.md** - Video Team Workflow
Manage the complete athlete video editing workflow.

**Use when:**
- Understanding the business process
- Building workflow features
- Managing inbox operations
- Tracking video progress stages

**Key workflows:**
- Inbox → Assignment → Editing → Complete
- Email communications at milestones
- Contact detection (athlete vs parent)
- Status tracking and updates

---

## How to Use These Skills

In Claude Code conversations, reference skills when needed:
```
@npid-api.md - Show me how to search for an athlete
@raycast-python.md - Help me debug Python spawn issues
@video-team-workflow.md - What are the available email templates?
```

## Project Structure

```
prospect-pipeline/
├── .claude/
│   └── skills/              # This directory
├── src/                     # Raycast extensions (TypeScript)
├── scripts/                 # Python automation scripts
├── mcp-servers/npid-native/ # REST API client
└── .kiro/                   # Shared context with Gemini CLI
```

## Related Documentation

- **Shared Context**: `~/.kiro/memory/shared-context.md` - Current project state
- **API Docs**: Check `API_DOCUMENTATION.md` for endpoint details
- **MCP Bridge**: See `src/lib/npid-mcp-adapter.ts` for API methods

## Skill Maintenance

When updating skills:
1. Keep examples practical and tested
2. Update both the skill and shared-context.md
3. Include common pitfalls and solutions
4. Add debugging tips from real issues encountered

## Quick Reference

| Task | Skill |
|------|-------|
| Call NPID API | npid-api.md |
| Build Raycast extension | raycast-python.md |
| Understand workflow | video-team-workflow.md |
| Fix Python issues | raycast-python.md |
| Send athlete emails | npid-api.md + video-team-workflow.md |
