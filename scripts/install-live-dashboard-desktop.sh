#!/usr/bin/env bash
# Creates ONE internet shortcut file directly on your Desktop (no subfolder).
# Opens the live GitHub Pages ops desk in the default browser.
set -euo pipefail
URL="https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html"
# File lives at ~/Desktop/<name>.webloc — not inside any folder on Desktop.
OUT="${HOME}/Desktop/Hit-A-Lick-Ops-Desk.webloc"

cat > "$OUT" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>${URL}</string>
</dict>
</plist>
PLIST

echo "OK: wrote ${OUT} (on Desktop root, not in a folder)"
echo "    opens → ${URL}"
# Remove legacy name if present so you only have one obvious shortcut
LEGACY="${HOME}/Desktop/HitALick-Live-Ops-Dashboard.webloc"
if [[ -f "$LEGACY" && "$LEGACY" != "$OUT" ]]; then
  rm -f "$LEGACY" && echo "    removed old: HitALick-Live-Ops-Dashboard.webloc"
fi
