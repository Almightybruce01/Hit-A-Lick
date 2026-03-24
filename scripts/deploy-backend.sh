#!/usr/bin/env bash
# Deploy Cloud Functions + Firebase Hosting (API + static site + rewrites).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Hit-A-Lick backend deploy"
echo "    Project: $(node -e "console.log(JSON.parse(require('fs').readFileSync('.firebaserc','utf8')).projects.default||'?')" 2>/dev/null || echo 'see .firebaserc')"
echo ""

if [[ ! -d functions/node_modules ]]; then
  echo "==> Installing functions dependencies..."
  (cd functions && npm ci 2>/dev/null || npm install)
fi

echo "==> Verifying functions load..."
node --input-type=module -e "import('./functions/index.js').then(()=>console.log('    OK')).catch(e=>{console.error(e);process.exit(1)})"

echo ""
echo "==> firebase deploy --only functions,hosting"
firebase deploy --only functions,hosting

echo ""
echo "Done. Run: npm run smoke"
