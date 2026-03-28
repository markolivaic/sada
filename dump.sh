#!/bin/bash

EXCLUDE_DIRS="node_modules|.next|.git|.turbo|.vercel|dist|.cache|coverage|public|data"
EXCLUDE_FILES="zg3d_center.geojson|package-lock.json|pnpm-lock.yaml|yarn.lock|*.ico|*.png|*.jpg|*.jpeg|*.gif|*.svg|*.webp|*.woff|*.woff2|*.ttf|*.eot"

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUTPUT=""

separator() {
  echo "════════════════════════════════════════════════════════════════"
}

OUTPUT+="$(separator)"$'\n'
OUTPUT+="  PROJECT DUMP: $(basename "$ROOT")"$'\n'
OUTPUT+="  Generated: $(date '+%Y-%m-%d %H:%M:%S')"$'\n'
OUTPUT+="$(separator)"$'\n\n'

OUTPUT+="📁 DIRECTORY TREE"$'\n'
OUTPUT+="$(separator)"$'\n'
OUTPUT+="$(find "$ROOT" -type d \
  | grep -Ev "($EXCLUDE_DIRS)" \
  | sed "s|$ROOT|.|" \
  | sort)"$'\n\n'

OUTPUT+="📄 FILE CONTENTS"$'\n'
OUTPUT+="$(separator)"$'\n\n'

find "$ROOT" -type f \
  | grep -Ev "($EXCLUDE_DIRS)" \
  | grep -Ev "\.(ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot|mp4|mp3|pdf|zip|tar|gz)$" \
  | grep -Ev "(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)" \
  | sort \
  | while read -r file; do
    REL="$(echo "$file" | sed "s|$ROOT/||")"
    OUTPUT_LINE="──── $REL ────"$'\n'
    CONTENT="$(cat "$file" 2>/dev/null)"
    echo "${OUTPUT_LINE}${CONTENT}"$'\n'
  done > /tmp/_dump_files.txt

OUTPUT+="$(cat /tmp/_dump_files.txt)"
rm -f /tmp/_dump_files.txt

echo "$OUTPUT"

if command -v pbcopy &>/dev/null; then
  echo "$OUTPUT" | pbcopy
  echo ""
  echo "✅ Copied to clipboard (pbcopy)"
elif command -v xclip &>/dev/null; then
  echo "$OUTPUT" | xclip -selection clipboard
  echo ""
  echo "✅ Copied to clipboard (xclip)"
elif command -v xsel &>/dev/null; then
  echo "$OUTPUT" | xsel --clipboard --input
  echo ""
  echo "✅ Copied to clipboard (xsel)"
else
  echo ""
  echo "⚠️  No clipboard tool found. Output printed above."
fi
