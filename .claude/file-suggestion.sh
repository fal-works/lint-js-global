#!/bin/bash
cd "$CLAUDE_PROJECT_DIR" || exit 1
query=$(cat | jq -r '.query')
{
  fdfind --type f -iF -p --strip-cwd-prefix "$query"
  fdfind --type f -iF -p --no-ignore --exclude .git --exclude archive "$query" dev 2>/dev/null
} | head -15
