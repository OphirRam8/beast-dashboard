#!/bin/bash
# Cloudflare Quick Tunnel for Beast Dashboard (localhost:4880).
# Sends new URL to Telegram + updates the public pointer gist on each (re)start.
# launchd manages this script via com.beast-dashboard.tunnel.plist.

set -u
DIR=/Users/beanhq/beast-dashboard
LOG="$DIR/logs/tunnel-stderr.log"
URL_FILE="$DIR/logs/.last-url"
WATCHER_LOG="$DIR/logs/notifier.log"
TG_ENV=/Users/beanhq/.claude/channels/telegram/.env
CHAT_ID=717944812
GIST_ID=366888d4044a54b2ce6f05fd0e08f97e

mkdir -p "$DIR/logs"

(
  for _ in $(seq 1 60); do
    sleep 2
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1)
    [ -z "$URL" ] && continue

    LAST=$(cat "$URL_FILE" 2>/dev/null || true)
    if [ "$URL" = "$LAST" ]; then
      exit 0
    fi
    printf "%s\n" "$URL" > "$URL_FILE"

    # Push to gist so the widget + bookmarks can auto-resolve
    POINTER_FILE=/tmp/beast-url-pointer.txt
    echo "$URL" > "$POINTER_FILE"
    /opt/homebrew/bin/gh gist edit "$GIST_ID" -f beast-url-pointer.txt "$POINTER_FILE" >> "$WATCHER_LOG" 2>&1 || true

    TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$TG_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'")
    MSG=$'\xF0\x9F\x9B\xA1 Beast Dashboard tunnel (re)started\n\n\xF0\x9F\x8C\x90 '"$URL"$'\n\n(widget + gist pointer updated)'

    curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
      -d "chat_id=${CHAT_ID}" \
      --data-urlencode "text=${MSG}" >> "$WATCHER_LOG" 2>&1
    exit 0
  done
) > "$WATCHER_LOG" 2>&1 &

: > "$LOG"
exec /opt/homebrew/bin/cloudflared tunnel --url http://localhost:4880
