import { db, admin } from "./firebaseConfig.js";

function envInt(name, fallback, min = 1, max = 1000000000) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
}

function utcDayKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function dayProgressUtc(date = new Date()) {
  const secs =
    (date.getUTCHours() * 3600) +
    (date.getUTCMinutes() * 60) +
    date.getUTCSeconds();
  return Math.max(0, Math.min(1, secs / 86400));
}

function utcMonthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function utcDaysInMonth(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

function utcDayOfMonth(date = new Date()) {
  return date.getUTCDate();
}

function providerConfig(provider) {
  const key = String(provider || "").toLowerCase();
  if (key === "odds_api") {
    const monthlyTarget = envInt("ODDS_API_MONTHLY_TARGET_CALLS", 5000000, 1000, 100000000);
    return {
      provider: "odds_api",
      // Month-aware default tuned for high-volume plans (eg. 5M/month).
      softLimit: envInt("ODDS_API_DAILY_SOFT_LIMIT", Math.floor(monthlyTarget / 30), 100, 10000000),
      monthlyTargetCalls: monthlyTarget,
      minIntervalSeconds: envInt("ODDS_API_MIN_CALL_INTERVAL_SECONDS", 1, 0, 900),
      paceHeadroomPct: envInt("ODDS_API_PACE_HEADROOM_PCT", 40, 0, 40),
    };
  }
  if (key === "rapidapi_odds") {
    const monthlyTarget = envInt("RAPIDAPI_MONTHLY_TARGET_CALLS", 2000000, 1000, 100000000);
    return {
      provider: "rapidapi_odds",
      softLimit: envInt("RAPIDAPI_DAILY_SOFT_LIMIT", Math.floor(monthlyTarget / 30), 100, 10000000),
      monthlyTargetCalls: monthlyTarget,
      minIntervalSeconds: envInt("RAPIDAPI_MIN_CALL_INTERVAL_SECONDS", 1, 0, 900),
      paceHeadroomPct: envInt("RAPIDAPI_PACE_HEADROOM_PCT", 40, 0, 40),
    };
  }
  return {
    provider: key || "unknown",
    softLimit: envInt("GENERIC_PROVIDER_DAILY_SOFT_LIMIT", 10000, 100, 10000000),
    minIntervalSeconds: envInt("GENERIC_PROVIDER_MIN_CALL_INTERVAL_SECONDS", 30, 5, 900),
    paceHeadroomPct: envInt("GENERIC_PROVIDER_PACE_HEADROOM_PCT", 10, 0, 40),
  };
}

function paceCapNow({ softLimit, paceHeadroomPct }, now = new Date()) {
  const progress = dayProgressUtc(now);
  const pct = Math.max(0, Math.min(40, Number(paceHeadroomPct) || 0)) / 100;
  return Math.max(1, Math.floor(softLimit * Math.min(1, progress + pct)));
}

/**
 * Odds API (the-odds-api.com) usage counters reset on the 1st of each calendar month at 00:00 UTC.
 * We key monthly aggregates with `utcMonthKey` so a new month starts a fresh Firestore month doc.
 *
 * Daily allowance uses remaining monthly quota / days left in month, then optionally scales up with
 * ODDS_API_DAILY_BURST_MULTIPLIER (default 1.35) so you can "max out" harder on heavy slates without
 * exceeding the monthly ceiling (still enforced via monthlyRemaining).
 */
function oddsDailyBurstMultiplier() {
  const raw = Number(process.env.ODDS_API_DAILY_BURST_MULTIPLIER);
  if (!Number.isFinite(raw) || raw < 1) return 1.35;
  return Math.min(6, raw);
}

/**
 * If usage is behind the ideal month-to-date pace (linear across the month),
 * add extra daily headroom so you can "catch up" toward the monthly cap without
 * waiting until the last day. Resets every month with `utcMonthKey` (Odds API
 * monthly quota resets 1st 00:00 UTC).
 */
function oddsCatchupBonusCalls({
  monthlyTarget,
  callsMonth,
  dayOfMonth,
  daysInMonth,
  daysRemainingInclToday,
  monthlyRemaining,
}) {
  const target = Math.max(1000, Number(monthlyTarget) || 0);
  const used = Math.max(0, Number(callsMonth) || 0);
  const dim = Math.max(1, Number(daysInMonth) || 30);
  const dom = Math.max(1, Math.min(dim, Number(dayOfMonth) || 1));
  const expectedSoFar = Math.floor((target * dom) / dim);
  const behind = expectedSoFar - used;
  if (behind <= 0) return 0;
  const daysLeft = Math.max(1, Number(daysRemainingInclToday) || 1);
  const rem = Math.max(0, Number(monthlyRemaining) || 0);
  return Math.min(rem, Math.floor(behind / daysLeft));
}

/** From this UTC day-of-month (inclusive), skip intraday ramp (still respect daily soft limit). */
function oddsFlatPaceFromDay() {
  const raw = Number(process.env.ODDS_API_FLAT_PACE_FROM_DAY || process.env.ODDS_API_PACE_GUARD_LAST_DAY);
  if (!Number.isFinite(raw) || raw < 1 || raw > 31) return 0;
  return Math.trunc(raw);
}

function usageDoc(provider, dayKey) {
  return db.collection("_apiUsage").doc(`${provider}_${dayKey}`);
}

function monthUsageDoc(provider, monthKey) {
  return db.collection("_apiUsageMonth").doc(`${provider}_${monthKey}`);
}

export async function allowLiveCall({
  provider,
  sport = "all",
  kind = "props",
  surface = "api",
} = {}) {
  const cfg = providerConfig(provider);
  const enforceGuard = String(process.env.ENFORCE_BUDGET_GUARD || "0") === "1";
  const now = new Date();
  const nowIso = now.toISOString();
  const dayKey = utcDayKey(now);
  const monthKey = utcMonthKey(now);
  const daysInMonth = utcDaysInMonth(now);
  const dayOfMonth = utcDayOfMonth(now);
  const daysRemainingInclToday = Math.max(1, daysInMonth - dayOfMonth + 1);
  const docRef = usageDoc(cfg.provider, dayKey);
  const monthRef = monthUsageDoc(cfg.provider, monthKey);

  return db.runTransaction(async (tx) => {
    const [daySnap, monthSnap] = await Promise.all([tx.get(docRef), tx.get(monthRef)]);
    const dayData = daySnap.exists ? (daySnap.data() || {}) : {};
    const monthData = monthSnap.exists ? (monthSnap.data() || {}) : {};
    const calls = Number(dayData.calls || 0);
    const callsMonth = Number(monthData.calls || 0);
    const lastIso = String(dayData.lastCallAtIso || "");
    const lastMs = Date.parse(lastIso);
    const elapsedSec = Number.isFinite(lastMs)
      ? Math.floor((Date.now() - lastMs) / 1000)
      : 1000000;
    const monthlyTarget = Math.max(1000, Number(cfg.monthlyTargetCalls || cfg.softLimit * daysInMonth));
    const monthlyRemaining = Math.max(0, monthlyTarget - callsMonth);
    const remainingPerDayTarget = Math.max(100, Math.floor(monthlyRemaining / daysRemainingInclToday));
    const burst =
      cfg.provider === "odds_api" ? oddsDailyBurstMultiplier() : 1;
    const burstDaily = Math.max(
      remainingPerDayTarget,
      Math.floor(remainingPerDayTarget * burst)
    );
    const catchup =
      cfg.provider === "odds_api"
        ? oddsCatchupBonusCalls({
            monthlyTarget,
            callsMonth,
            dayOfMonth,
            daysInMonth,
            daysRemainingInclToday,
            monthlyRemaining,
          })
        : 0;
    const daySoftLimit = Math.max(
      100,
      Math.min(cfg.softLimit, Math.min(monthlyRemaining, burstDaily + catchup))
    );
    const paceRelaxDay = cfg.provider === "odds_api" ? oddsFlatPaceFromDay() : 0;
    /** From this UTC day onward, allow full daily soft limit immediately (no intraday ramp). */
    const flatPaceIntraday =
      cfg.provider === "odds_api" && paceRelaxDay > 0 && dayOfMonth >= paceRelaxDay;
    const capNow = flatPaceIntraday
      ? daySoftLimit
      : paceCapNow({ softLimit: daySoftLimit, paceHeadroomPct: cfg.paceHeadroomPct }, now);

    let allowed = true;
    let reason = "ok";
    if (enforceGuard) {
      if (calls >= daySoftLimit) {
        allowed = false;
        reason = "soft_limit";
      } else if (elapsedSec < cfg.minIntervalSeconds) {
        allowed = false;
        reason = "cooldown";
      } else if (calls >= capNow) {
        allowed = false;
        reason = "pace_guard";
      }
    } else {
      // Monitor-only mode by default: never block live data pulls.
      allowed = true;
      reason = "guard_disabled";
    }

    tx.set(
      docRef,
      {
        provider: cfg.provider,
        dayKey,
        calls: admin.firestore.FieldValue.increment(1),
        lastCallAtIso: nowIso,
        lastSport: String(sport || "all"),
        lastKind: String(kind || "props"),
        lastSurface: String(surface || "api"),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      monthRef,
      {
        provider: cfg.provider,
        monthKey,
        calls: admin.firestore.FieldValue.increment(1),
        monthlyTargetCalls: monthlyTarget,
        daysInMonth,
        dayOfMonth,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      provider: cfg.provider,
      allowed,
      reason,
      enforceGuard,
      calls,
      callsMonth,
      softLimit: daySoftLimit,
      configuredDailySoftLimit: cfg.softLimit,
      monthlyTargetCalls: monthlyTarget,
      monthlyRemaining,
      daysInMonth,
      dayOfMonth,
      daysRemainingInclToday,
      oddsApiMonthResetsUtc: cfg.provider === "odds_api",
      oddsDailyBurstMultiplier: cfg.provider === "odds_api" ? burst : 1,
      oddsCatchupBonusCalls: cfg.provider === "odds_api" ? catchup : 0,
      flatPaceIntraday,
      minIntervalSeconds: cfg.minIntervalSeconds,
      paceCapNow: capNow,
      dayKey,
      monthKey,
      nowIso,
    };
  });
}
