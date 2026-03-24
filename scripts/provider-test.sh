#!/usr/bin/env bash
# Provider reliability test — run after deploy to see what's live.
set -euo pipefail
BASE="${HITALICK_API_BASE:-https://api-lifnvql5aa-uc.a.run.app}"
BASE="${BASE%/}"

echo "==> Provider test: $BASE"
echo ""

echo "--- STATUS ---"
curl -sS "$BASE/api/status" | python3 -c "
import json,sys
d=json.load(sys.stdin)
p=d.get('provider',{})
print('  Odds API:', 'configured' if p.get('oddsApiConfigured') else 'MISSING')
print('  RapidAPI:', 'configured' if p.get('rapidApiConfigured') else 'MISSING')
print('  Bookmakers:', ','.join(p.get('bookmakers',[])) or 'none')
"
echo ""

echo "--- PROPS (NBA, 1 day) ---"
curl -sS "$BASE/api/props?sport=nba&windowDays=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
src=d.get('source','?')
w=d.get('warning','')
count=d.get('count',0)
tpp=d.get('totalPlayerProps',0)
print(f'  Source: {src}')
print(f'  Events: {count}, Player props: {tpp}')
if w: print(f'  Warning: {w[:120]}...')
"
echo ""

echo "--- GAMES (NBA) ---"
curl -sS "$BASE/api/games?sport=nba&windowDays=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
src=d.get('source','?')
count=len(d.get('games',[]))
print(f'  Source: {src}')
print(f'  Games: {count}')
"
echo ""

echo "--- PLAYERS (NBA, limit 3) ---"
curl -sS "$BASE/api/players?sport=nba&limit=3" | python3 -c "
import json,sys
arr=json.load(sys.stdin)
print(f'  Count: {len(arr)}')
for p in arr[:2]:
    h=p.get('headshotIsPlaceholder',True)
    print(f'  - {p.get(\"name\")} | headshot: {\"placeholder\" if h else \"CDN\"}')
" 2>/dev/null || echo "  (parse error)"
echo ""

echo "--- TEAMS (NBA) ---"
curl -sS "$BASE/api/teams?sport=nba" | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('items',[])
print(f'  Count: {len(items)}')
if items:
    t=items[0]
    print(f'  Sample: {t.get(\"name\")} | logo: {\"yes\" if t.get(\"logoUrl\") else \"no\"}')
" 2>/dev/null || echo "  (parse error)"
echo ""

echo "==> Done. See docs/DATA_PROVIDER_PLAN.md for optimization plan."
