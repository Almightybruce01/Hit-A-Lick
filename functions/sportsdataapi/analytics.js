function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const nums = values.map(asNumber).filter((n) => n != null);
  if (!nums.length) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

function median(values) {
  const nums = values.map(asNumber).filter((n) => n != null).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return nums[mid];
  return Number(((nums[mid - 1] + nums[mid]) / 2).toFixed(2));
}

function stdDev(values) {
  const nums = values.map(asNumber).filter((n) => n != null);
  if (!nums.length) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / nums.length;
  return Number(Math.sqrt(variance).toFixed(3));
}

function rollingWindow(values, count) {
  return values.slice(0, Math.max(0, count));
}

function hitRate(values, line) {
  const nums = values.map(asNumber).filter((n) => n != null);
  if (!nums.length || !Number.isFinite(line)) return null;
  const hits = nums.filter((n) => n >= line).length;
  return Number(((hits / nums.length) * 100).toFixed(1));
}

function deriveTrend(values) {
  const nums = values.map(asNumber).filter((n) => n != null);
  if (nums.length < 2) return null;
  const first = nums[nums.length - 1];
  const last = nums[0];
  const delta = last - first;
  return {
    delta: Number(delta.toFixed(2)),
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

function normalizeVenue(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("home") || v === "h") return "home";
  if (v.includes("away") || v === "a") return "away";
  return "unknown";
}

function toCompactGame(game = {}) {
  return {
    date: game.date || game.gameDate || "",
    opponent: game.opponent || game.vs || "",
    result: game.result || "",
    points: asNumber(game.points),
    assists: asNumber(game.assists),
    rebounds: asNumber(game.rebounds),
    minutes: asNumber(game.minutes || game.min),
    venue: normalizeVenue(game.venue || game.homeAway),
  };
}

function buildStatSummary(statHistory = [], candidateLine = null) {
  const rows = statHistory.map(toCompactGame);
  const pts = rows.map((r) => r.points);
  const ast = rows.map((r) => r.assists);
  const reb = rows.map((r) => r.rebounds);
  const min = rows.map((r) => r.minutes);
  const homePts = rows.filter((r) => r.venue === "home").map((r) => r.points);
  const awayPts = rows.filter((r) => r.venue === "away").map((r) => r.points);

  const l5 = rollingWindow(pts, 5);
  const l10 = rollingWindow(pts, 10);
  const l20 = rollingWindow(pts, 20);
  const line = asNumber(candidateLine);

  return {
    samples: rows.length,
    averages: {
      points: average(pts),
      assists: average(ast),
      rebounds: average(reb),
      minutes: average(min),
    },
    medians: {
      points: median(pts),
      assists: median(ast),
      rebounds: median(reb),
      minutes: median(min),
    },
    volatility: {
      points: stdDev(pts),
      assists: stdDev(ast),
      rebounds: stdDev(reb),
    },
    splits: {
      homePointsAvg: average(homePts),
      awayPointsAvg: average(awayPts),
      homeSamples: homePts.length,
      awaySamples: awayPts.length,
    },
    windows: {
      l5PointsAvg: average(l5),
      l10PointsAvg: average(l10),
      l20PointsAvg: average(l20),
      lineHitRateL5: hitRate(l5, line),
      lineHitRateL10: hitRate(l10, line),
      lineHitRateL20: hitRate(l20, line),
    },
    trend: deriveTrend(pts),
    series: {
      points: pts.filter((n) => n != null),
      assists: ast.filter((n) => n != null),
      rebounds: reb.filter((n) => n != null),
      minutes: min.filter((n) => n != null),
    },
  };
}

export {
  asNumber,
  average,
  buildStatSummary,
  normalizeVenue,
  toCompactGame,
};
