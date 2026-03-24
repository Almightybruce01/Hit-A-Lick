#!/usr/bin/env node
/**
 * Creates the four Firebase Auth users for curator lanes.
 *
 * Prerequisites:
 *   1. Copy curator-accounts.example.json → curator-accounts.json and edit (real emails/passwords).
 *   2. Service account JSON with Firebase Admin rights:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *      Or place scripts/serviceAccount.json (gitignored).
 *
 * Run: node scripts/create-curator-firebase-users.cjs
 */

const fs = require("fs");
const path = require("path");

function loadFirebaseAdmin() {
  try {
    return require("firebase-admin");
  } catch {
    const nested = path.join(__dirname, "../functions/node_modules/firebase-admin");
    try {
      return require(nested);
    } catch {
      console.error(
        "Could not load firebase-admin. Run:\n  cd functions && npm ci\nThen retry from the repo root.",
      );
      process.exit(1);
    }
  }
}

const admin = loadFirebaseAdmin();

const root = path.join(__dirname, "..");
const accountsPath = path.join(__dirname, "curator-accounts.json");
const examplePath = path.join(__dirname, "curator-accounts.example.json");

function initAdmin() {
  const envCred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const localCred = path.join(__dirname, "serviceAccount.json");
  const p = envCred && fs.existsSync(envCred) ? envCred : fs.existsSync(localCred) ? localCred : null;
  if (!p) {
    console.error(
      "Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON,\n" +
        "or save it as scripts/serviceAccount.json (never commit).",
    );
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(json) });
  }
}

function main() {
  if (!fs.existsSync(accountsPath)) {
    console.error(`Missing ${accountsPath}\nCopy ${examplePath} and fill real emails/passwords.`);
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("curator-accounts.json must be a non-empty array.");
    process.exit(1);
  }
  initAdmin();

  const allowed = new Set(["bruce", "giap"]);

  (async () => {
    for (const row of rows) {
      const slug = String(row.slug || "").toLowerCase();
      const email = String(row.email || "").trim().toLowerCase();
      const password = String(row.password || "");
      const displayName = String(row.displayName || "").trim() || slug;
      if (!allowed.has(slug)) {
        console.warn(`Skip unknown slug: ${slug}`);
        continue;
      }
      if (!email || !password || password.startsWith("CHANGE_ME")) {
        console.error(`Invalid row for ${slug}: set real email and password.`);
        process.exit(1);
      }
      try {
        const u = await admin.auth().createUser({
          email,
          password,
          displayName,
          emailVerified: false,
        });
        console.log(`Created ${slug}: ${email} uid=${u.uid}`);
      } catch (e) {
        if (e.code === "auth/email-already-exists") {
          const u = await admin.auth().getUserByEmail(email);
          await admin.auth().updateUser(u.uid, { displayName });
          console.log(`Updated display name for existing ${slug}: ${email} uid=${u.uid}`);
        } else {
          console.error(`Failed ${slug}:`, e.message || e);
          process.exit(1);
        }
      }
    }
    console.log("\nNext: set Firebase Functions secrets CURATOR_*_EMAIL to these exact addresses.");
    console.log("See docs/CURATOR_ACCOUNTS.md");
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
