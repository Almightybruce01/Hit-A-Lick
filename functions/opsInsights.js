/**
 * Owner dashboard: rule-based ops diagnostics + optional OpenAI narrative (OPENAI_API_KEY).
 * Dashboard AI guide: POST /api/ops/dashboard-guide (same PIN / owner auth).
 */
import admin from "firebase-admin";

/** Injected into OpenAI so answers reference real tabs and flows. Keep in sync with site/ops-dashboard.html. */
export const OPS_DASHBOARD_FEATURE_CATALOG = `
Hit-A-Lick Ops Desk (browser): unlock with X-Ops-Pin (server: OPS_DASHBOARD_PIN, default 2012). On GitHub Pages you MUST paste API base URL (Cloud Run or Firebase Hosting origin) before unlock.

Tabs after unlock:
1) Environment — GET /api/ops/dashboard: env flags, marketsBySport per nba/nfl/mlb/wnba, raw ops JSON. Use to confirm Odds API key presence, bookmakers, prop market tier.
2) AI insights — GET /api/ops/insights: rule-based suggestions (quota, Stripe prices missing, curator emails), optional OpenAI paragraph if OPENAI_API_KEY set.
3) Stripe prices — GET /api/billing/pricing-status: which Stripe price env vars are set (masked).
4) Curator pool — GET /api/ops/universal-pool lists Firestore universal pool rows. User checks rows, picks lane "bruce" or "giap", Save calls POST /api/ops/curator-board/select with { curatorId, pickIds }. Those picks appear on subscriber-facing curator boards (iOS bottom tab "Picks"). Only Bruce (owner) or anyone with valid ops PIN can use this tab; Giap normally uses iOS Curator Studio for his lane only.
5) All features — static list in UI (same as this catalog).
6) Dashboard AI — this assistant; POST /api/ops/dashboard-guide with { message }.

iOS app: "Picks" tab shows paid curator boards. Account → Curator Studio: Bruce can push/select for lanes; Giap only manages Giap lane for edits. Universal pool rows are created with owner-authenticated API (e.g. POST /api/curators/pool/add with Bearer).

Accounts: OWNER / main admin email brucebrian50@gmail.com. Co-curator giap.social1@gmail.com (CURATOR_GIAP_EMAIL). Two lanes only: bruce, giap.

AI Lab (separate from ops): in-app tab; quota for normal users; unlimited for staff/subscribers per billing rules — not configured on this ops page.

When user asks "how do I publish picks": give numbered steps — add to pool (owner tools), then either Ops Curator pool tab (load, select, lane, save) OR iOS Curator Studio. Clarify Bruce vs Giap permissions.
`.trim();

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
    STRIPE_PRICE_ALL_CURATORS: process.env.STRIPE_PRICE_ALL_CURATORS,
  };

  const ownerEmail = (process.env.OWNER_EMAIL || "").toLowerCase();
  const curatorEmails = {
    bruce: String(process.env.CURATOR_BRUCE_EMAIL || "").toLowerCase() || ownerEmail,
    giap: String(process.env.CURATOR_GIAP_EMAIL || "").toLowerCase(),
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

function staticDashboardGuideFallback(userMessage) {
  const q = String(userMessage || "").toLowerCase();
  const lines = [
    "OpenAI is not configured on the server (set OPENAI_API_KEY). Here is a static guide:",
    "",
    "1) Unlock: enter your ops PIN and API base (required on github.io).",
    "2) Curator pool: Load pool → check picks → choose lane Bruce or Giap → Save to board.",
    "3) Bruce: full ops + iOS Curator Studio for both lanes. Giap: iOS Curator Studio for Giap lane only (or ops pool if you share PIN).",
    "4) See tab «All features» for the full list.",
    "",
    "Docs: docs/CURATOR_ACCOUNTS.md — logins brucebrian50@gmail.com / giap.social1@gmail.com (passwords in Firebase only).",
  ];
  if (q.includes("giap")) {
    lines.push("", "Giap: sign into the iOS app with giap.social1@gmail.com → Account → Curator Studio → Giap lane → select from pool / save.");
  }
  if (q.includes("bruce") || q.includes("owner") || q.includes("admin")) {
    lines.push("", "Bruce: sign in with brucebrian50@gmail.com → use Ops Desk Curator pool OR Curator Studio for Bruce/Giap lanes.");
  }
  return lines.join("\n");
}

/**
 * Ops-only assistant: step-by-step help for the Hit-A-Lick ops dashboard and curator flows.
 */
export async function answerOpsDashboardGuide(userMessage) {
  const msg = String(userMessage || "").trim();
  if (!msg) {
    return { ok: false, error: "message required", reply: null, source: "none" };
  }
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    return {
      ok: true,
      reply: staticDashboardGuideFallback(msg),
      source: "static",
      generatedAt: new Date().toISOString(),
    };
  }
  try {
    const system = [
      "You are the Hit-A-Lick Ops Desk assistant. Answer ONLY about: this ops dashboard, curator pool/board publishing, Stripe price checks on the desk, environment/insights tabs, iOS Curator Studio vs web ops, Bruce vs Giap roles, PIN/API base unlock.",
      "Always respond with clear numbered steps when explaining a workflow. Be exact: tab names, button labels (Load pool, Save to board), API paths if relevant.",
      "Do not invent features that are not in the catalog. If unsure, say what you know from the catalog and suggest checking docs/CURATOR_ACCOUNTS.md.",
      "\n--- Feature catalog ---\n",
      OPS_DASHBOARD_FEATURE_CATALOG,
    ].join("");
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_OPS_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: msg },
        ],
        max_tokens: 900,
        temperature: 0.25,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      return {
        ok: false,
        error: j?.error?.message || String(r.status),
        reply: staticDashboardGuideFallback(msg),
        source: "static_fallback",
        generatedAt: new Date().toISOString(),
      };
    }
    const reply = j?.choices?.[0]?.message?.content?.trim() || null;
    return {
      ok: true,
      reply: reply || staticDashboardGuideFallback(msg),
      source: "openai",
      generatedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ok: true,
      reply: staticDashboardGuideFallback(msg),
      source: "static_error",
      error: e.message || String(e),
      generatedAt: new Date().toISOString(),
    };
  }
}
