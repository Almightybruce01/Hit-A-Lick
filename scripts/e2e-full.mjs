#!/usr/bin/env node
/**
 * Full stack E2E: API health + every app tab/panel + clickability + command palette.
 *
 *   npm run e2e              # API + browser (default hosted app URL)
 *   npm run e2e:local        # API + browser against static site/
 *   npm run e2e:api          # API only (CI / no Chromium)
 *
 *   PW_BROWSER=webkit npm run e2e   # if Chromium hangs on your OS/sandbox
 *
 * Env:
 *   HITALICK_APP_URL   — e.g. https://PROJECT.web.app/app.html
 *   HITALICK_API_BASE  — Cloud Run / API origin (no trailing slash)
 *   HITALICK_E2E_NO_API_STUB=1 — browser uses real /api from the app (slow; raise HITALICK_E2E_BROWSER_MS)
 *
 * Requires: npm i && npx playwright install chromium
 */
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const siteRoot = path.join(repoRoot, "site");

const TAB_KEYS = ["home", "props", "dash", "players", "games", "ai", "posts", "premium", "alerts", "account", "integrity"];

const DEFAULT_APP_URL = "https://hit-a-lick-database.web.app/app.html";
const DEFAULT_API_BASE = "https://api-lifnvql5aa-uc.a.run.app";

function contentType(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function staticServer(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const u = new URL(req.url || "/", "http://127.0.0.1/");
        let rel = decodeURIComponent(u.pathname);
        if (rel === "/" || rel === "") rel = "/app.html";
        const file = path.resolve(siteRoot, "." + rel);
        const rootResolved = path.resolve(siteRoot);
        if (!file.startsWith(rootResolved + path.sep) && file !== rootResolved) {
          res.writeHead(403);
          res.end();
          return;
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": contentType(file) });
        fs.createReadStream(file).pipe(res);
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    server.listen(preferredPort, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function apiPhase(apiBase) {
  const base = String(apiBase || "").replace(/\/$/, "");
  const checks = [
    [`GET /health`, `${base}/health`],
    [`GET /api/health`, `${base}/api/health`],
    [`GET /api/status`, `${base}/api/status`],
    [`GET /api/props?sport=nba`, `${base}/api/props?sport=nba`],
  ];
  let fail = 0;
  console.log("\n==> API checks:", base);
  for (const [name, url] of checks) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 60000);
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      const ok = res.ok;
      console.log(ok ? `  OK (${res.status}) ${name}` : `  FAIL (${res.status}) ${name}`);
      if (!ok) fail++;
      else if (name.includes("/api/props")) {
        const ct = res.headers.get("content-type") || "";
        const text = await res.text();
        if (!ct.includes("json")) {
          console.log(`  WARN props response not JSON (${ct.slice(0, 40)})`);
        } else {
          try {
            const j = JSON.parse(text);
            const n = Array.isArray(j) ? j.length : Array.isArray(j?.props) ? j.props.length : "?";
            console.log(`  … props payload rows (rough): ${n}`);
          } catch {
            console.log(`  WARN props JSON parse failed`);
          }
        }
      }
    } catch (e) {
      console.log(`  FAIL ${name}: ${e?.message || e}`);
      fail++;
    }
  }
  const opsUrl = `${base}/ops/dashboard`;
  try {
    const res = await fetch(opsUrl);
    const ok = res.ok || res.status === 401 || res.status === 403;
    console.log(ok ? `  OK (${res.status}) GET /ops/dashboard (reachable)` : `  FAIL (${res.status}) GET /ops/dashboard`);
    if (!ok) fail++;
  } catch (e) {
    console.log(`  FAIL ops/dashboard: ${e?.message || e}`);
    fail++;
  }
  if (fail) {
    throw new Error(`API phase: ${fail} failure(s)`);
  }
  console.log("==> API phase passed.\n");
}

async function httpShellPhase(appUrl) {
  console.log("==> HTTP shell (no JS):", appUrl);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45_000);
  const res = await fetch(appUrl, { signal: ac.signal, redirect: "follow" });
  clearTimeout(t);
  if (!res.ok) {
    throw new Error(`GET ${appUrl} -> HTTP ${res.status}`);
  }
  const html = await res.text();
  /** elite-command-root is created at runtime by app-elite.js — not in static HTML. */
  const markers = ["id=\"hlDeskJump\"", "function setActiveTab", "id=\"panel-home\"", "HitElite", "/js/app-elite.js"];
  const missing = markers.filter((m) => !html.includes(m));
  if (missing.length) {
    throw new Error(`app HTML missing: ${missing.join(", ")}`);
  }
  console.log("  OK: markers present in served HTML\n");
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error("\nInstall Playwright:\n  npm install\n  npx playwright install chromium\n");
    process.exit(2);
  }
}

function appUrlExpectsProxy(appUrl) {
  try {
    const h = new URL(appUrl).hostname;
    return h.endsWith(".web.app") || h.endsWith(".firebaseapp.com") || process.env.HITALICK_E2E_ASSUME_API === "1";
  } catch {
    return false;
  }
}

function browserEngine(playwright) {
  const pick = (process.env.PW_BROWSER || "chromium").toLowerCase();
  if (pick === "webkit" && playwright.webkit) return playwright.webkit;
  if (pick === "firefox" && playwright.firefox) return playwright.firefox;
  return playwright.chromium;
}

async function installBrowserFetchStub(page) {
  if (process.env.HITALICK_E2E_NO_API_STUB === "1") {
    console.log("  (stub off) HITALICK_E2E_NO_API_STUB=1 — live /api from app origin");
    return;
  }
  /**
   * `page.route` before `goto` can deadlock Chromium; after `goto` the app may already be stuck
   * on 404/slow /api. Patch fetch before any script runs (init script runs on every navigation).
   */
  await page.addInitScript(() => {
    const orig = window.fetch;
    if (typeof orig !== "function") return;
    window.fetch = function hitalickE2eFetch(input, init) {
      try {
        const u =
          typeof input === "string"
            ? input
            : input && typeof input === "object" && "url" in input
              ? String(input.url)
              : "";
        if (u.includes("/api/")) {
          const body = u.includes("/api/health")
            ? '{"ok":true}'
            : u.includes("/api/status") || u.includes("/api/setup")
              ? "{}"
              : "[]";
          return Promise.resolve(
            new Response(body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }),
          );
        }
      } catch {
        /* fall through */
      }
      return orig.apply(this, arguments);
    };
  });
  console.log("  OK: addInitScript fetch stub for /api (UI phase only)");
}

async function browserPhase(appUrl, { expectsApiProxy }) {
  const playwright = await loadPlaywright();
  const engine = browserEngine(playwright);
  const engineLabel = (process.env.PW_BROWSER || "chromium").toLowerCase();
  console.log("==> Browser engine:", engineLabel);

  const browser = await engine.launch({
    headless: true,
    args: engineLabel === "chromium" ? ["--disable-dev-shm-usage"] : undefined,
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(90_000);
  page.setDefaultTimeout(90_000);

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await installBrowserFetchStub(page);

  console.log("==> Open:", appUrl);
  const nav = await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  if (!nav) {
    await browser.close();
    throw new Error("Navigation failed (no response)");
  }
  await page.evaluate(() => {
    try {
      window.refreshAll = async () => {};
    } catch {
      /* ignore */
    }
  });

  const boot = await page.evaluate(() => ({
    setTab: typeof window.setActiveTab,
    refresh: typeof window.refreshAll,
    openPalette: typeof window.openCommandPalette,
    closePalette: typeof window.closeCommandPalette,
    title: document.title,
  }));

  if (boot.setTab !== "function") {
    await browser.close();
    throw new Error(`Shell did not boot: ${JSON.stringify(boot)}`);
  }

  if (expectsApiProxy) {
    const apiOk = await page.evaluate(async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        return r.ok;
      } catch {
        return false;
      }
    });
    if (!apiOk) {
      console.warn("  WARN: fetch /api/health from app origin failed (auth/CORS/hosting?) — UI tests continue.");
    } else {
      console.log("  OK: /api/health from app origin");
    }
  } else {
    console.log("  (skip) same-origin /api probe — use hosted URL for full API-from-page check");
  }

  const overlayOk = await page.evaluate(() => {
    const back = document.getElementById("actionDrawerBackdrop");
    const root = document.getElementById("elite-command-root");
    /** `a?.b.c` still throws if b is missing — chain through contains(). */
    const drawerOpen = Boolean(back?.classList?.contains("open"));
    const paletteOpen = Boolean(root?.classList?.contains("elite-open"));
    return { drawerOpen, paletteOpen };
  });
  if (overlayOk.drawerOpen || overlayOk.paletteOpen) {
    await browser.close();
    throw new Error(`Overlays should start closed: ${JSON.stringify(overlayOk)}`);
  }
  console.log("  OK: overlays idle");

  const panelBodySelectors = {
    home: "#homeGrid",
    dash: "#dashboardGrid",
    players: "#playersGrid",
    games: "#gamesGrid",
    props: "#propHubGrid",
    ai: "#aiGrid",
    posts: "#curatorFeedScroll",
    premium: "#premiumGrid",
    alerts: "#alertsGrid",
    account: "#accountGrid",
    integrity: "#integrityGrid",
  };

  for (const key of TAB_KEYS) {
    await page.evaluate((k) => {
      window.setActiveTab(k);
    }, key);
    const ok = await page.evaluate((k) => {
      const btn = document.querySelector(`.tab-btn[data-tab="${k}"]`);
      const panel = document.getElementById(`panel-${k}`);
      return Boolean(btn?.classList.contains("active") && panel?.classList.contains("active"));
    }, key);
    if (!ok) {
      await browser.close();
      throw new Error(`Tab "${key}" did not activate panel + tab button`);
    }
    const bodySel = panelBodySelectors[key];
    if (bodySel) {
      const hasBody = await page.evaluate(
        ({ k, sel }) => {
          const panel = document.getElementById(`panel-${k}`);
          if (!panel) return false;
          const parts = sel.split(",").map((s) => s.trim());
          for (const p of parts) {
            try {
              if (panel.querySelector(p)) return true;
            } catch {
              /* invalid sel */
            }
          }
          return panel.children.length > 0;
        },
        { k: key, sel: bodySel },
      );
      if (!hasBody) {
        await browser.close();
        throw new Error(`Tab "${key}" panel has no expected content region (selector: ${bodySel})`);
      }
    }
    process.stdout.write(`  tab OK: ${key}\n`);
  }

  await page.evaluate(() => window.setActiveTab("home"));

  const commandDeckOk = await page.evaluate(() => {
    const deck = document.getElementById("commandDeck");
    if (!deck) return false;
    const buttons = [...deck.querySelectorAll("button.quick-btn")];
    const toPlayers = buttons.find((b) => (b.getAttribute("onclick") || "").includes("'players'"));
    if (!toPlayers) return false;
    toPlayers.click();
    const tab = document.querySelector('.tab-btn[data-tab="players"]');
    const panel = document.getElementById("panel-players");
    return Boolean(tab?.classList.contains("active") && panel?.classList.contains("active"));
  });
  if (!commandDeckOk) {
    await browser.close();
    throw new Error("Command Center quick action (Open Player Lab) did not switch tabs");
  }
  console.log("  OK: Command Center quick-btn click → Players");

  await page.evaluate(() => window.setActiveTab("home"));

  await page.evaluate(() => {
    document.getElementById("hlDeskJump")?.click();
  });
  const desk = await page.evaluate(() => {
    const b = document.querySelector('.tab-btn[data-tab="dash"]');
    const p = document.getElementById("panel-dash");
    return b?.classList.contains("active") && p?.classList.contains("active");
  });
  if (!desk) {
    await browser.close();
    throw new Error("Elite Desk (toolbar) click failed");
  }
  console.log("  OK: toolbar Elite Desk");

  if (boot.openPalette === "function") {
    await page.evaluate(() => window.openCommandPalette());
    const open = await page.evaluate(() => document.getElementById("elite-command-root")?.classList.contains("elite-open"));
    if (!open) {
      await browser.close();
      throw new Error("Command palette did not open");
    }
    await page.evaluate(() => window.closeCommandPalette());
    const closed = await page.evaluate(() => {
      const r = document.getElementById("elite-command-root");
      return !r?.classList.contains("elite-open");
    });
    if (!closed) {
      await browser.close();
      throw new Error("Command palette did not close");
    }
    console.log("  OK: command palette open/close");
  }

  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#refreshBtn, .hero .btn")];
    for (const b of btns.slice(0, 3)) {
      try {
        b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      } catch {
        /* ignore */
      }
    }
  });
  console.log("  OK: dispatched sample hero/toolbar clicks (no hang)");

  await browser.close();

  if (pageErrors.length) {
    console.warn("\n  Page JS errors during run:\n", pageErrors.map((m) => `    - ${m}`).join("\n"));
  }

  console.log("==> Browser phase passed.\n");
}

async function main() {
  const serve = process.argv.includes("--serve");
  const apiOnly = process.argv.includes("--api-only") || process.env.HITALICK_E2E_API_ONLY === "1";
  const skipPw =
    process.argv.includes("--no-playwright") || process.env.HITALICK_E2E_SKIP_PLAYWRIGHT === "1";
  const apiBase = process.env.HITALICK_API_BASE || DEFAULT_API_BASE;

  let appUrl = process.env.HITALICK_APP_URL || "";
  let server;

  if (serve) {
    server = await staticServer(0);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    appUrl = `http://127.0.0.1:${port}/app.html`;
    console.log("==> Local static site:", appUrl);
  }

  if (!appUrl) {
    appUrl = DEFAULT_APP_URL;
    console.log("==> Using default app URL (set HITALICK_APP_URL to override):", appUrl);
  }

  await apiPhase(apiBase);

  if (apiOnly) {
    console.log("==> Skipping browser (--api-only / HITALICK_E2E_API_ONLY=1)\n");
    if (server) server.close();
    console.log("API-only E2E passed.");
    return;
  }

  await httpShellPhase(appUrl);

  if (skipPw) {
    console.log("==> Skipping Playwright (--no-playwright / HITALICK_E2E_SKIP_PLAYWRIGHT=1)\n");
    if (server) server.close();
    console.log("E2E passed (API + HTTP shell). Run full UI locally: npm run e2e");
    return;
  }

  const expectsApiProxy = appUrlExpectsProxy(appUrl);
  const phaseMs = Number(process.env.HITALICK_E2E_BROWSER_MS || 240_000);
  let browserTimer;
  try {
    await Promise.race([
      browserPhase(appUrl, { expectsApiProxy }),
      new Promise((_, rej) => {
        browserTimer = setTimeout(() => rej(new Error(`Browser phase exceeded ${phaseMs}ms`)), phaseMs);
      }),
    ]);
  } finally {
    clearTimeout(browserTimer);
    if (server) server.close();
  }

  console.log("All E2E phases passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
