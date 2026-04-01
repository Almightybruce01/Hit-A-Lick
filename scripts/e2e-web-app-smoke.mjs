#!/usr/bin/env node
/**
 * Browser smoke: toolbar + hero "Elite Desk" must activate the Desk tab (no dead clicks).
 * Requires: npm i -D playwright && npx playwright install chromium
 *
 *   node scripts/e2e-web-app-smoke.mjs --serve
 *   HITALICK_APP_URL=https://host/app.html node scripts/e2e-web-app-smoke.mjs
 */
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.join(__dirname, "..", "site");

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

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error("Missing playwright. Install with:\n  npm i -D playwright && npx playwright install chromium");
    process.exit(2);
  }
}

function assertDeskActive(page) {
  return page.evaluate(() => {
    const desk = document.querySelector('.tab-btn[data-tab="dash"]');
    const panel = document.getElementById("panel-dash");
    return Boolean(desk?.classList.contains("active") && panel?.classList.contains("active"));
  });
}

async function main() {
  const serve = process.argv.includes("--serve");
  let base = process.env.HITALICK_APP_URL || "";
  let server;

  if (serve) {
    const want = Number(process.env.HITALICK_E2E_PORT || 0);
    server = await staticServer(want);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : want;
    base = `http://127.0.0.1:${port}/app.html`;
    console.log("==> Serving site/ at", base);
  }

  if (!base) {
    console.error("Set HITALICK_APP_URL to full app URL (e.g. https://host/app.html) or run with --serve");
    process.exit(2);
  }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errs = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));

  /** `load` can stall on slow third-party assets; shell script runs after DOM + sync scripts. */
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });

  const boot = await page.evaluate(() => ({
    setTab: typeof window.setActiveTab,
    jump: Boolean(document.getElementById("hlDeskJump")),
    title: document.title,
  }));
  if (boot.setTab !== "function" || !boot.jump) {
    await browser.close();
    if (server) server.close();
    throw new Error(`App did not boot: ${JSON.stringify(boot)}`);
  }

  const rootClosed = await page.evaluate(() => {
    const r = document.getElementById("elite-command-root");
    return !r || !r.classList.contains("elite-open");
  });
  if (!rootClosed) {
    console.error("FAIL: elite-command-root should start closed");
    process.exitCode = 1;
  }

  await page.evaluate(() => document.getElementById("hlDeskJump")?.click());
  if (!(await assertDeskActive(page))) {
    console.error("FAIL: toolbar Elite Desk did not activate Desk tab");
    process.exitCode = 1;
  }

  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("button")];
    const b = nodes.find((n) => (n.textContent || "").trim() === "Open Elite Desk");
    b?.click();
  });
  if (!(await assertDeskActive(page))) {
    console.error("FAIL: hero Open Elite Desk did not keep Desk tab active");
    process.exitCode = 1;
  }

  await browser.close();
  if (server) server.close();

  if (process.exitCode === 1) process.exit(1);
  if (errs.length) console.warn("Warnings during load:\n", errs.join("\n"));
  console.log("OK: Elite Desk clicks switch to Desk tab");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
