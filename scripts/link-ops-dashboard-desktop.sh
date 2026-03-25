#!/usr/bin/env bash
# Canonical Desktop entry: live GitHub Pages ops desk (webloc on Desktop root).
# Removes legacy local-file symlinks / PIN-named shortcuts that pointed at repo HTML.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$REPO_ROOT/scripts/install-live-dashboard-desktop.sh"

README="$HOME/Desktop/Hit-A-Lick-Ops-Desk-README.txt"
cat > "$README" << EOF
Hit-A-Lick Ops Desk — Desktop
=============================

Open (double-click): Hit-A-Lick-Ops-Desk.webloc
Live URL: https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html

Recreate shortcut from repo:
  bash $REPO_ROOT/scripts/install-live-dashboard-desktop.sh
  (or) bash $REPO_ROOT/scripts/link-ops-dashboard-desktop.sh

Printable steps (save as PDF from browser):
  https://almightybruce01.github.io/Hit-A-Lick/staff-access-print.html

Do not store your ops PIN in this text file.
EOF

# Legacy: local symlink + old names (misleading; file:// breaks API / security expectations)
LEGACY_SYMLINK="$HOME/Desktop/HitALick-OpsControl-PublicDashboard-PIN2012.html"
LEGACY_README="$HOME/Desktop/HitALick-OpsControl-Desktop-README.txt"
rm -f "$LEGACY_SYMLINK" "$LEGACY_README" 2>/dev/null || true

echo "OK: Hit-A-Lick-Ops-Desk.webloc + README on Desktop"
echo "    Live: https://almightybruce01.github.io/Hit-A-Lick/ops-dashboard.html"
