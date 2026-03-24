# Odds API bookmakers (Hit-A-Lick)

## Keys (The Odds API v4)

| Book | Region | `bookmakers` key |
|------|--------|------------------|
| FanDuel | us | `fanduel` |
| DraftKings | us | `draftkings` |
| PrizePicks | us_dfs | `prizepicks` |
| Underdog Fantasy | us_dfs | `underdog` |

Caesars retail key in the API is typically `williamhill_us` (not `caesars`).

## Firebase secret

Set `ODDS_API_BOOKMAKERS` to a comma-separated list, for example:

`fanduel,draftkings,prizepicks,underdog`

Do **not** put the same variable in `functions/.env` if it is defined as a Firebase secret (deploy will fail with a secret/plain overlap).

## Backend behavior

`functions/sportsdataapi/props.js` sets Odds API `regions` to `us,us_dfs` when any configured book is a DFS key (`prizepicks`, `underdog`, `pick6`, `betr_us_dfs`). Otherwise it uses `us` only. Override with `ODDS_API_REGIONS` if needed.
