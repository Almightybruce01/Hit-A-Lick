#!/bin/bash

echo "🧠 Caching stats..."
curl "https://xmsi72yc6d.execute-api.us-east-2.amazonaws.com/cacheStats"

echo ""
echo "🕒 Caching live game data..."
curl "https://xmsi72yc6d.execute-api.us-east-2.amazonaws.com/cacheLiveGame"

echo ""
echo "📅 Caching upcoming games..."
curl "https://xmsi72yc6d.execute-api.us-east-2.amazonaws.com/cacheUpcomingGames"

echo ""
echo "✅ All cache endpoints triggered."