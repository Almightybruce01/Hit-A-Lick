/**
 * Owner dashboard: rule-based ops diagnostics + optional OpenAI narrative (OPENAI_API_KEY).
 */
import admin from "firebase-admin";

function utcMonthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function utcDayKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function readOddsUsageMonth() {
  const db = admin.firestore();
  const mk = utcMonthKey();
  const ref = db.collection("_apiUsageMonth").doc(`odds_api_${mk}`);
  const snap = await ref.get();
  return snap.exists ? snap.data() || {} : {};
}

async function readOddsUsageToday() {
  const db = admin.firestore();
  const dk = utcDayKey();
  const ref = db.collection("_apiUsage").doc(`odds_api_${dk}`);
  const snap = await ref.get();
  return snap.exists ? snap.data() || {} : {};
}

function ruleSuggestions(ctx) {
  const out = [];
  const {
    oddsKey,
    bookmakers,
    monthlyTarget,
    callsMonth,
    callsDay,
    stripeCuratorPrices,
    curatorEmails,
    rapidConfigured,
    openAi,
    flatPaceDay,
    enforceGuard,
  } = ctx;

  if (!oddsKey) {
    out.push({
      severity: "critical",
      code: "ODDS_API_KEY_MISSING",
      title: "Odds API key not configured",
      action: "Set Firebase secret ODDS_API_KEY and redeploy api.",
    });
  }

  if (oddsKey && (!bookmakers || !String(bookmakers).trim())) {
    out.push({
      severity: "warning",
      code: "BOOKMAKERS_EMPTY",
      title: "No bookmakers filter",
      action: "Set ODDS_API_BOOKMAKERS secret (e.g. fanduel,draftkings,prizepicks,underdog) to control spend and regions.",
    });
  }

  if (monthlyTarget && callsMonth != null) {
    const rem = Math.max(0, monthlyTarget - Number(callsMonth || 0));
    const ratio = rem / monthlyTarget;
    if (ratio < 0.05) {
      out.push({
        severity: "warning",
        code: "MONTHLY_QUOTA_LOW",
        title: "Odds API monthly quota almost exhausted",
        action: "Review ODDS_API_MONTHLY_TARGET_CALLS, reduce ODDS_API_EVENT_PROP_LIMIT, or upgrade Odds API plan.",
        detail: { monthlyRemaining: rem, monthlyTarget },
      });
    }
  }

  if (enforceGuard === "1" && callsDay != null && Number(callsDay) > 0) {
    out.push({
      severity: "info",
      code: "BUDGET_GUARD_ON",
      title: "Budget guard is enforcing daily pacing",
      action: "If late-month catch-up is needed, set ODDS_API_FLAT_PACE_FROM_DAY (e.g. 20) and verify ODDS_API_DAILY_BURST_MULTIPLIER.",
    });
  }

  if (!flatPaceDay) {
    out.push({
      severity: "info",
      code: "FLAT_PACE_OPTIONAL",
      title: "Optional: flatten intraday Odds API ramp",
      action: "Set ODDS_API_FLAT_PACE_FROM_DAY in functions env to allow full daily allowance earlier in the UTC month.",
    });
  }

  for (const [k, v] of Object.entries(stripeCuratorPrices || {})) {
    if (!v) {
      out.push({
        severity: "warning",
        code: "STRIPE_PRICE_MISSING",
        title: `Stripe price not set: ${k}`,
        action: `Create price in Stripe Dashboard and set secret STRIPE_PRICE_${k.toUpperCase()} (see .env.example).`,
      });
    }
  }

  for (const [slug, email] of Object.entries(curatorEmails || {})) {
    if (!email && slug !== "bruce") {
      out.push({
        severity: "warning",
        code: "CURATOR_EMAIL_MISSING",
        title: `Curator email missing for ${slug}`,
        action: `Set CURATOR_${slug.toUpperCase()}_EMAIL and create matching Firebase Auth user.`,
      });
    }
  }

  if (!rapidConfigured) {
    out.push({
      severity: "info",
      code: "RAPIDAPI_FALLBACK_OFF",
      title: "RapidAPI odds fallback not configured",
      action: "Optional: set RAPIDAPI_KEY + RAPIDAPI_ODDS_HOST for redundancy when Odds API fails.",
    });
  }

  if (!openAi) {
    out.push({
      severity: "info",
      code: "OPENAI_OPS_OFF",
      title: "OpenAI narrative for this endpoint is off",
      action: "Set OPENAI_API_KEY to enable AI-written insight paragraphs (optional).",
    });
  }

  return out;
}

async function openAiNarrative(ctx, suggestions) {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  try {
    const prompt = `You are an SRE assistant for a sports betting analytics API. Summarize risks and next steps in under 120 words. Context JSON:\n${JSON.stringify({ suggestions, usage: ctx.usageSummary })}`;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_OPS_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: "Be concise, actionable, no markdown headings." },
          { role: "user", content: prompt },
        ],
        max_tokens: 400,
        temperature: 0.35,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      return `OpenAI error: ${j?.error?.message || r.status}`;
    }
    return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    return `OpenAI unavailable: ${e.message || e}`;
  }
}

export async function buildOpsInsightsPayload() {
  const month = await readOddsUsageMonth();
  const day = await readOddsUsageToday();

  const stripeCuratorPrices = {
    STRIPE_PRICE_CURATOR_GIAP: process.env.STRIPE_PRICE_CURATOR_GIAP,
    STRIPE_PRICE_CURATOR_BRUCE: process.env.STRIPE_PRICE_CURATOR_BRUCE,
    STRIPE_PRICE_CURATOR_MIKE: process.env.STRIPE_PRICE_CURATOR_MIKE,
    STRIPE_PRICE_CURATOR_TORIANO: process.env.STRIPE_PRICE_CURATOR_TORIANO,
    STRIPE_PRICE_ALL_CURATORS: process.env.STRIPE_PRICE_ALL_CURATORS,
  };

  const ownerEmail = (process.env.OWNER_EMAIL || "").toLowerCase();
  const curatorEmails = {
    giap: String(process.env.CURATOR_GIAP_EMAIL || "").toLowerCase(),
    bruce: String(process.env.CURATOR_BRUCE_EMAIL || "").toLowerCase() || ownerEmail,
    mike: String(process.env.CURATOR_MIKE_EMAIL || "").toLowerCase(),
    toriano: String(process.env.CURATOR_TORIANO_EMAIL || "").toLowerCase(),
  };

  const ctx = {
    oddsKey: Boolean(process.env.ODDS_API_KEY),
    bookmakers: process.env.ODDS_API_BOOKMAKERS,
    monthlyTarget: Number(month.monthlyTargetCalls || process.env.ODDS_API_MONTHLY_TARGET_CALLS || 0),
    callsMonth: Number(month.calls || 0),
    callsDay: Number(day.calls || 0),
    stripeCuratorPrices,
    curatorEmails,
    rapidConfigured: Boolean(process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_ODDS_HOST),
    openAi: Boolean(process.env.OPENAI_API_KEY),
    flatPaceDay: process.env.ODDS_API_FLAT_PACE_FROM_DAY,
    enforceGuard: String(process.env.ENFORCE_BUDGET_GUARD || "0"),
    usageSummary: {
      oddsApiMonthCalls: Number(month.calls || 0),
      oddsApiDayCalls: Number(day.calls || 0),
      monthKey: month.monthKey || utcMonthKey(),
      dayKey: day.dayKey || utcDayKey(),
    },
  };

  const suggestions = ruleSuggestions(ctx);
  const aiNarrative = await openAiNarrative(ctx, suggestions);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    suggestions,
    usage: ctx.usageSummary,
    configuration: {
      oddsApiKeyPresent: ctx.oddsKey,
      bookmakersConfigured: Boolean(String(ctx.bookmakers || "").trim()),
      rapidApiFallback: ctx.rapidConfigured,
      openAiOps: Boolean(process.env.OPENAI_API_KEY),
      stripePricingStatusPath: "/api/billing/pricing-status",
      stripeCuratorPricesConfigured: Object.fromEntries(
        Object.entries(stripeCuratorPrices).map(([k, v]) => [k, Boolean(String(v || "").trim())])
      ),
      curatorEmailsPresent: Object.fromEntries(
        Object.entries(curatorEmails).map(([k, v]) => [k, Boolean(String(v || "").trim())])
      ),
      oddsFlatPaceFromDay: ctx.flatPaceDay || null,
    },
    aiNarrative,
  };
}
