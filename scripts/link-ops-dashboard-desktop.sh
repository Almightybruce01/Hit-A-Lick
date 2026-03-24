#!/usr/bin/env bash
# Creates the Desktop shortcut with the canonical HitALick ops dashboard name.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$REPO_ROOT/site/ops-dashboard.html"
LINK="$HOME/Desktop/HitALick-OpsControl-PublicDashboard-PIN5505.html"
README="$HOME/Desktop/HitALick-OpsControl-Desktop-README.txt"

ln -sf "$TARGET" "$LINK"
cat > "$README" << EOF
HitALick Ops Control — Desktop pointer
=====================================

Shortcut file (open in browser):
  HitALick-OpsControl-PublicDashboard-PIN5505.html

Points to:
  $TARGET

Live (GitHub Pages — same files as repo folder site/):
  https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html
  https://almightybruce01.github.io/Hit-A-Lick/ops/

Safari bookmark file (online only, on Desktop — no subfolder):
  Hit-A-Lick-Ops-Desk.webloc
  Create/update: bash scripts/install-live-dashboard-desktop.sh

GitHub repo:
  https://github.com/Almightybruce01/Hit-A-Lick

PIN: 5505 (or OPS_DASHBOARD_PIN in production)

Recreate this link after moving the repo:
  bash $REPO_ROOT/scripts/link-ops-dashboard-desktop.sh
EOF

echo "OK: $LINK -> $TARGET"
echo "OK: wrote $README"
