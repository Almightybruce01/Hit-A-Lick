#!/bin/bash

echo "⛳ Setting up /sport collection..."
curl -s "https://xmsi72yc6d.execute-api.us-east-2.amazonaws.com/setupSports"

echo ""
echo "🏀 Scraping teams for all sports..."
for sport in nba wnba nfl mlb; do
  echo "→ Scraping teams for $sport..."
  curl -s "https://xmsi72yc6d.execute-api.us-east-2.amazonaws.com/scrapeTeams?sport=$sport"
done

echo ""
echo "🧍 Scraping players for all sports..."
for sport in nba wnba nfl mlb; do
  echo "→ Scraping players for $sport..."
  curl -s "https://xmsi72yc6d.execute-api.us-east-2.amazonaws.com/scrapePlayers?sport=$sport"
done

echo ""
echo "✅ DONE: Sports, Teams, and Players setup complete."
