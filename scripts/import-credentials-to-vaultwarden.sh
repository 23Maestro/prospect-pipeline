#!/bin/bash

# Import credentials to Vaultwarden/Bitwarden
# Usage: ./import-credentials-to-vaultwarden.sh input.csv

set -e

if [ $# -eq 0 ]; then
    echo "Usage: $0 <input.csv>"
    echo ""
    echo "CSV format (columns):"
    echo "  name, username, password, uri, playerId, class_year, sport, parent_email, dropbox_link, tags"
    echo ""
    echo "Example:"
    echo "  John Smith, john.smith@example.com, password123, https://hudl.com/profile/123, PID-12345, 2027, football, parent@example.com, https://dropbox.com/..., ProspectID,2027,football"
    exit 1
fi

INPUT_CSV="$1"
TEMP_CSV=$(mktemp)
SESSION_FILE="$HOME/.bw_session"

if [ ! -f "$INPUT_CSV" ]; then
    echo "Error: Input file '$INPUT_CSV' not found"
    exit 1
fi

if [ ! -f "$SESSION_FILE" ]; then
    echo "Error: Bitwarden session not found at $SESSION_FILE"
    echo "Please run: bw unlock --raw > ~/.bw_session"
    exit 1
fi

SESSION=$(cat "$SESSION_FILE" | tr -d '\n')

if [ -z "$SESSION" ]; then
    echo "Error: Bitwarden session is empty"
    echo "Please run: bw unlock --raw > ~/.bw_session"
    exit 1
fi

echo "Converting CSV to Bitwarden format..."

# Convert CSV to Bitwarden CSV format
# Bitwarden CSV format: folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp
# We'll map: name -> name, username -> login_username, password -> login_password, uri -> login_uri
# Custom fields: playerId, class_year, sport, parent_email, dropbox_link

# Create header
echo "folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp" > "$TEMP_CSV"

# Process each line (skip header if present)
tail -n +2 "$INPUT_CSV" | while IFS=',' read -r name username password uri playerId class_year sport parent_email dropbox_link tags; do
    # Trim whitespace
    name=$(echo "$name" | xargs)
    username=$(echo "$username" | xargs)
    password=$(echo "$password" | xargs)
    uri=$(echo "$uri" | xargs)
    playerId=$(echo "$playerId" | xargs)
    class_year=$(echo "$class_year" | xargs)
    sport=$(echo "$sport" | xargs)
    parent_email=$(echo "$parent_email" | xargs)
    dropbox_link=$(echo "$dropbox_link" | xargs)
    tags=$(echo "$tags" | xargs)
    
    # Format name as "Lastname, Firstname — <playerId>"
    # If playerId is empty, just use the name
    if [ -n "$playerId" ]; then
        formatted_name="$name — $playerId"
    else
        formatted_name="$name"
    fi
    
    # Build custom fields JSON
    fields=""
    if [ -n "$playerId" ]; then
        fields="${fields}{\"name\":\"playerId\",\"value\":\"$playerId\",\"type\":0},"
    fi
    if [ -n "$class_year" ]; then
        fields="${fields}{\"name\":\"class_year\",\"value\":\"$class_year\",\"type\":0},"
    fi
    if [ -n "$sport" ]; then
        fields="${fields}{\"name\":\"sport\",\"value\":\"$sport\",\"type\":0},"
    fi
    if [ -n "$parent_email" ]; then
        fields="${fields}{\"name\":\"parent_email\",\"value\":\"$parent_email\",\"type\":0},"
    fi
    if [ -n "$dropbox_link" ]; then
        fields="${fields}{\"name\":\"dropbox_link\",\"value\":\"$dropbox_link\",\"type\":0},"
    fi
    
    # Remove trailing comma
    fields=$(echo "$fields" | sed 's/,$//')
    
    # Escape quotes in fields
    fields=$(echo "$fields" | sed 's/"/\\"/g')
    
    # Build notes (can include tags info)
    notes=""
    if [ -n "$tags" ]; then
        notes="Tags: $tags"
    fi
    
    # Escape commas and quotes for CSV
    formatted_name=$(echo "$formatted_name" | sed 's/"/""/g')
    notes=$(echo "$notes" | sed 's/"/""/g')
    fields=$(echo "$fields" | sed 's/"/""/g')
    uri=$(echo "$uri" | sed 's/"/""/g')
    username=$(echo "$username" | sed 's/"/""/g')
    password=$(echo "$password" | sed 's/"/""/g')
    
    # Write CSV line
    echo ",,login,\"$formatted_name\",\"$notes\",\"[$fields]\",\"$uri\",\"$username\",\"$password\"," >> "$TEMP_CSV"
done

echo "Importing to Bitwarden..."
bw import bitwardencsv "$TEMP_CSV" --session "$SESSION"

if [ $? -eq 0 ]; then
    echo "✅ Successfully imported credentials"
    rm "$TEMP_CSV"
else
    echo "❌ Import failed"
    echo "Temporary file saved at: $TEMP_CSV"
    exit 1
fi

