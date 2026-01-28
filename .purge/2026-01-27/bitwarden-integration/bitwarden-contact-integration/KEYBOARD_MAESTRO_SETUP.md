# Keyboard Maestro Setup for Hudl Login

This guide shows how to set up a Keyboard Maestro macro that automatically fills Hudl login credentials from Vaultwarden.

## Macro Overview

The macro will:
1. Prompt for PlayerID
2. Fetch credentials from Vaultwarden
3. Fill username into Hudl login form
4. Fill password into Hudl login form

## Setup Steps

### 1. Create New Macro

1. Open Keyboard Maestro
2. Create new macro: "Hudl Login from Vaultwarden"
3. Set trigger (e.g., hotkey or variable prompt)

### 2. Add Actions

#### Action 1: Prompt for PlayerID

- **Action**: Prompt for User Input
- **Variable**: `playerId`
- **Prompt**: "Enter PlayerID"

#### Action 2: Fetch Credentials

- **Action**: Execute Shell Script
- **Script**:
```bash
SESSION=$(cat ~/.bw_session)
bw get item "$KMVAR_playerId" --session "$SESSION" | \
  jq -r '.login.username + "\n" + .login.password' > /tmp/pid_creds.txt
```

**Note**: This assumes you have a Bitwarden item with a custom field `playerId` matching the search. You may need to adjust the search logic.

**Alternative script** (search by playerId custom field):
```bash
SESSION=$(cat ~/.bw_session)
# Search for item with matching playerId
ITEM=$(bw list items --search "$KMVAR_playerId" --session "$SESSION" | \
  jq -r ".[] | select(.fields[]?.name == \"playerId\" and .fields[]?.value == \"$KMVAR_playerId\") | .id" | head -1)

if [ -n "$ITEM" ]; then
  bw get item "$ITEM" --session "$SESSION" | \
    jq -r '.login.username + "\n" + .login.password' > /tmp/pid_creds.txt
else
  echo "No matching item found" > /tmp/pid_creds.txt
fi
```

#### Action 3: Focus Username Field

- **Action**: Type Keystroke
- **Keystroke**: Click in username field (or use Tab to navigate)

#### Action 4: Insert Username

- **Action**: Insert Text by Pasting
- **Text**: First line of `/tmp/pid_creds.txt`
- **Script**:
```bash
head -n 1 /tmp/pid_creds.txt | pbcopy
```

Or use Keyboard Maestro's "Insert Text" action with:
```
%SystemPath%/tmp/pid_creds.txt[1]
```

#### Action 5: Tab to Password Field

- **Action**: Type Keystroke
- **Keystroke**: Tab

#### Action 6: Insert Password

- **Action**: Insert Text by Pasting
- **Text**: Second line of `/tmp/pid_creds.txt`
- **Script**:
```bash
tail -n 1 /tmp/pid_creds.txt | pbcopy
```

#### Action 7: Cleanup

- **Action**: Execute Shell Script
- **Script**:
```bash
rm /tmp/pid_creds.txt
```

## Testing

1. Open Hudl login page
2. Trigger macro (hotkey or prompt)
3. Enter PlayerID when prompted
4. Verify credentials are filled correctly

## Troubleshooting

### Credentials Not Found

- Verify PlayerID exists in Vaultwarden
- Check that custom field `playerId` is set correctly
- Test CLI manually: `bw list items --search "<playerId>"`

### Session Expired

Add error handling to check session:

```bash
if [ ! -f ~/.bw_session ]; then
  osascript -e 'display dialog "Bitwarden session not found. Please run: bw unlock --raw > ~/.bw_session"'
  exit 1
fi
```

### Wrong Field Focused

Adjust the "Type Keystroke" actions to match your Hudl login form layout. You may need to:
- Click directly on fields instead of using Tab
- Add delays between actions
- Use different navigation methods

## Alternative: Direct Clipboard Method

Simpler approach - copy password to clipboard directly:

1. Prompt for PlayerID
2. Execute: `bw get item "$KMVAR_playerId" --session "$SESSION" | jq -r '.login.password' | pbcopy`
3. Focus password field
4. Paste (Cmd+V)

This requires manually typing the username, but is simpler to set up.

