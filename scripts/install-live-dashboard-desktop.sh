#!/usr/bin/env bash
# Writes a single macOS .webloc on your Desktop that opens the LIVE GitHub Pages ops desk (not a local file).
set -euo pipefail
URL="https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html"
OUT="${HOME}/Desktop/HitALick-Live-Ops-Dashboard.webloc"

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

echo "OK: $OUT → $URL"
