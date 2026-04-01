import express from "express";
import admin from "firebase-admin";
import { mergeStaffEntitlement, hydrateEntitlementForApi } from "./billing.js";

const router = express.Router();
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "brucebrian50@gmail.com").toLowerCase();

const CURATOR_SLUGS = ["bruce", "giap"];

const CURATOR_LABELS = {
  bruce: "Bruce Pick's",
  giap: "Giap Pick's",
};

const ALL_CURATORS = [...CURATOR_SLUGS];

function curatorEmailEnv(slug) {
  const key = `CURATOR_${String(slug).toUpperCase()}_EMAIL`;
  let v = String(process.env[key] || "").trim().toLowerCase();
  if (!v && slug === "bruce") {
    v = OWNER_EMAIL;
  }
  return v;
}

function normalizePoolItem(body = {}) {
  return {
    title: String(body.title || "").trim(),
    league: String(body.league || "").trim(),
    pick: String(body.pick || "").trim(),
    notes: String(body.notes || "").trim(),
    confidence: Math.max(0, Math.min(100, Number(body.confidence || 0))),
    gameDate: String(body.gameDate || "").trim(),
  };
}

function normalizeHistoryItem(body = {}) {
  return {
    poolItemId: String(body.poolItemId || "").trim(),
    title: String(body.title || "").trim(),
    league: String(body.league || "").trim(),
    pick: String(body.pick || "").trim(),
    result: String(body.result || "").toLowerCase(),
    notes: String(body.notes || "").trim(),
    gameDate: String(body.gameDate || "").trim(),
    settledAt: String(body.settledAt || new Date().toISOString()),
  };
}

async function requireAuthUid(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const uid = String(req.query.uid || req.body?.uid || "").trim();
    if (!token || !uid) {
      return res.status(401).json({ error: "Auth token and uid are required." });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) {
      return res.status(403).json({ error: "Token uid mismatch." });
    }
    req.viewer = { uid, email: (decoded.email || "").toLowerCase() };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

async function requireOwner(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return res.status(401).json({ error: "Missing bearer token." });
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.email || decoded.email.toLowerCase() !== OWNER_EMAIL) {
      return res.status(403).json({ error: "Owner access required." });
    }
    req.ownerEmail = decoded.email.toLowerCase();
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

function curatorSlugForEmail(email) {
  const e = String(email || "").toLowerCase();
  for (const slug of CURATOR_SLUGS) {
    const expected = curatorEmailEnv(slug);
    if (expected && expected === e) return slug;
  }
  return null;
}

function userCuratorAccess(entitlement = {}) {
  if (entitlement.curatorAllAccess === true) return ALL_CURATORS;
  const raw = entitlement.curatorIds;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((s) => String(s).toLowerCase()).filter((s) => CURATOR_SLUGS.includes(s));
  }
  const tier = String(entitlement.tier || "").toLowerCase();
  if (tier === "bruce" || tier === "curator_bruce") return ["bruce"];
  if (tier === "curator_giap" || tier === "giap") return ["giap"];
  if (tier.startsWith("curator_")) {
    const slug = tier.slice("curator_".length);
    return CURATOR_SLUGS.includes(slug) ? [slug] : [];
  }
  return [];
}

async function requireCuratorSubscriber(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const uid = String(req.query.uid || "").trim();
    if (!token || !uid) {
      return res.status(401).json({ error: "Auth token and uid are required." });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) {
      return res.status(403).json({ error: "Token uid mismatch." });
    }
    req.viewer = { uid, email: (decoded.email || "").toLowerCase() };

    const curatorId = String(req.params.curatorId || "").toLowerCase();
    if (!CURATOR_SLUGS.includes(curatorId)) {
      return res.status(400).json({ error: "Unknown curator." });
    }
    const snap = await admin.firestore().collection("users").doc(uid).get();
    const rawEnt = snap.exists ? snap.data()?.entitlement || {} : {};
    const ent = hydrateEntitlementForApi(mergeStaffEntitlement({ ...rawEnt }, req.viewer.email));
    const active = ent.active === true;
    const access = userCuratorAccess(ent);
    const expectedCuratorEmail = curatorEmailEnv(curatorId);
    const isSelfCurator =
      Boolean(expectedCuratorEmail) && req.viewer.email === expectedCuratorEmail;
    const allowed =
      req.viewer.email === OWNER_EMAIL ||
      isSelfCurator ||
      (active && (access.includes(curatorId) || ent.curatorAllAccess === true));

    if (!allowed) {
      return res.status(402).json({ error: "Subscription required for this curator." });
    }
    req.entitlement = ent;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

async function requireCuratorLogin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const uid = String(req.query.uid || req.body?.uid || "").trim();
    if (!token || !uid) {
      return res.status(401).json({ error: "Auth token and uid are required." });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) {
      return res.status(403).json({ error: "Token uid mismatch." });
    }
    req.viewer = { uid, email: (decoded.email || "").toLowerCase() };

    const curatorId = String(req.params.curatorId || "").toLowerCase();
    if (!CURATOR_SLUGS.includes(curatorId)) {
      return res.status(400).json({ error: "Unknown curator." });
    }
    const expected = curatorEmailEnv(curatorId);
    const emailOk = expected && req.viewer.email === expected;
    if (!emailOk && req.viewer.email !== OWNER_EMAIL) {
      return res.status(403).json({ error: "Curator login required." });
    }
    req.curatorId = curatorId;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

const profileRef = (id) => admin.firestore().collection("curatorProfiles").doc(id);
const boardRef = (id) => admin.firestore().collection("curatorBoards").doc(id);

async function loadPoolItemsSorted() {
  const snap = await admin.firestore().collection("universalPickPool").limit(500).get();
  const rows = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  rows.sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });
  return rows.slice(0, 400);
}

/** Public teaser + profile (no picks body). */
router.get("/catalog", (_req, res) => {
  return res.json({
    curators: CURATOR_SLUGS.map((id) => ({
      id,
      label: CURATOR_LABELS[id] || id,
    })),
  });
});

const curatorFeedCol = () => admin.firestore().collection("curatorFeedPosts");

function canPostCuratorFeed(email) {
  const e = String(email || "").toLowerCase();
  if (e === OWNER_EMAIL) return true;
  const giap = curatorEmailEnv("giap");
  return Boolean(giap && e === giap);
}

async function requireCuratorFeedPoster(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const uid = String(req.body?.uid || req.query?.uid || "").trim();
    if (!token || !uid) return res.status(401).json({ error: "Auth token and uid are required." });
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) return res.status(403).json({ error: "Token uid mismatch." });
    const email = (decoded.email || "").toLowerCase();
    if (!canPostCuratorFeed(email)) {
      return res.status(403).json({ error: "Only Bruce or Giap can publish or delete feed posts." });
    }
    req.curatorFeedPoster = { uid, email };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

async function requireFeedCommentAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const uid = String(req.body?.uid || req.query?.uid || "").trim();
    if (!token || !uid) return res.status(401).json({ error: "Log in to comment." });
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) return res.status(403).json({ error: "Token uid mismatch." });
    req.feedCommenter = {
      uid,
      email: (decoded.email || "").toLowerCase(),
      name: String(decoded.name || "").trim(),
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid auth token." });
  }
}

function allowedPosterSlugForEmail(email) {
  const slug = curatorSlugForEmail(email);
  if (slug) return slug;
  if (String(email || "").toLowerCase() === OWNER_EMAIL) return "bruce";
  return null;
}

/** Public: Bruce & Giap posts (newest first). */
router.get("/feed/posts", async (req, res) => {
  try {
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 18));
    const cursorId = String(req.query.cursor || "").trim();
    let q = curatorFeedCol().orderBy("createdAt", "desc").limit(limit);
    if (cursorId) {
      const curSnap = await curatorFeedCol().doc(cursorId).get();
      if (curSnap.exists) q = q.startAfter(curSnap);
    }
    const snap = await q.get();
    const posts = snap.docs.map((doc) => {
      const d = doc.data() || {};
      let createdAtIso = null;
      if (d.createdAt?.toDate) createdAtIso = d.createdAt.toDate().toISOString();
      return {
        id: doc.id,
        authorSlug: d.authorSlug || "",
        authorLabel: d.authorLabel || "",
        body: d.body || "",
        imageUrl: d.imageUrl || null,
        commentCount: Number(d.commentCount || 0),
        createdAt: createdAtIso,
      };
    });
    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return res.json({ posts, nextCursor });
  } catch (e) {
    console.error("feed/posts list error", e.message || e);
    return res.status(500).json({ error: "Failed to load posts." });
  }
});

router.get("/feed/posts/:postId/comments", async (req, res) => {
  try {
    const postId = String(req.params.postId || "").trim();
    if (!postId) return res.status(400).json({ error: "Missing post." });
    const parent = await curatorFeedCol().doc(postId).get();
    if (!parent.exists) return res.status(404).json({ error: "Post not found." });
    const lim = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const snap = await curatorFeedCol()
      .doc(postId)
      .collection("comments")
      .orderBy("createdAt", "asc")
      .limit(lim)
      .get();
    const comments = snap.docs.map((doc) => {
      const d = doc.data() || {};
      let createdAtIso = null;
      if (d.createdAt?.toDate) createdAtIso = d.createdAt.toDate().toISOString();
      return {
        id: doc.id,
        text: d.text || "",
        authorLabel: d.authorLabel || "Member",
        createdAt: createdAtIso,
      };
    });
    return res.json({ postId, comments });
  } catch (e) {
    console.error("feed comments list error", e.message || e);
    return res.status(500).json({ error: "Failed to load comments." });
  }
});

router.post("/feed/posts", requireCuratorFeedPoster, async (req, res) => {
  try {
    const body = req.body || {};
    const authorSlug = String(body.authorSlug || "").toLowerCase();
    if (!CURATOR_SLUGS.includes(authorSlug)) {
      return res.status(400).json({ error: "authorSlug must be bruce or giap." });
    }
    const posterEmail = String(req.curatorFeedPoster.email || "").toLowerCase();
    const allowed = allowedPosterSlugForEmail(posterEmail);
    const ownerPostingAsGiap = posterEmail === OWNER_EMAIL && authorSlug === "giap";
    if (!ownerPostingAsGiap && (!allowed || allowed !== authorSlug)) {
      return res.status(403).json({ error: "You can only post to your own curator lane." });
    }
    const text = String(body.body || "").trim().slice(0, 8000);
    const rawImg = String(body.imageUrl || "").trim().slice(0, 800);
    const rawDataImg = String(body.imageDataUrl || "").trim();
    let imageUrl = null;
    if (rawDataImg) {
      if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(rawDataImg) || rawDataImg.length > 900_000) {
        return res.status(400).json({
          error: "imageDataUrl must be a JPEG/PNG/WebP data URL under ~900KB.",
        });
      }
      imageUrl = rawDataImg;
    } else if (rawImg) {
      if (!/^https:\/\//i.test(rawImg)) {
        return res.status(400).json({ error: "imageUrl must be an https link." });
      }
      imageUrl = rawImg;
    }
    if (!text && !imageUrl) {
      return res.status(400).json({ error: "Add message text and/or an image (https URL or photo upload)." });
    }
    const ref = curatorFeedCol().doc();
    await ref.set({
      authorSlug,
      authorLabel: CURATOR_LABELS[authorSlug] || authorSlug,
      body: text,
      imageUrl,
      commentCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.curatorFeedPoster.email,
      postedByOwnerForLane: ownerPostingAsGiap ? "giap" : null,
    });
    return res.json({ ok: true, id: ref.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to publish post." });
  }
});

router.delete("/feed/posts/:postId", requireCuratorFeedPoster, async (req, res) => {
  try {
    const postId = String(req.params.postId || "").trim();
    if (!postId) return res.status(400).json({ error: "Missing post." });
    const postRef = curatorFeedCol().doc(postId);
    const snap = await postRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Post not found." });
    const d = snap.data() || {};
    const authorSlug = String(d.authorSlug || "").toLowerCase();
    const posterEmail = String(req.curatorFeedPoster.email || "").toLowerCase();
    const allowed = allowedPosterSlugForEmail(posterEmail);
    const isOwner = posterEmail === OWNER_EMAIL;
    if (!isOwner && (!allowed || allowed !== authorSlug)) {
      return res.status(403).json({ error: "You can only delete your own posts." });
    }
    const csnap = await postRef.collection("comments").limit(500).get();
    const batch = admin.firestore().batch();
    for (const doc of csnap.docs) batch.delete(doc.ref);
    batch.delete(postRef);
    await batch.commit();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to delete post." });
  }
});

router.post("/feed/posts/:postId/comments", requireFeedCommentAuth, async (req, res) => {
  try {
    const postId = String(req.params.postId || "").trim();
    const text = String(req.body?.text || "").trim().slice(0, 2000);
    if (!postId) return res.status(400).json({ error: "Missing post." });
    if (!text) return res.status(400).json({ error: "Comment cannot be empty." });
    const parent = await curatorFeedCol().doc(postId).get();
    if (!parent.exists) return res.status(404).json({ error: "Post not found." });
    const labelRaw = req.feedCommenter.name || req.feedCommenter.email || "Member";
    const authorLabel = String(labelRaw).split("@")[0].slice(0, 48);
    const cref = curatorFeedCol().doc(postId).collection("comments").doc();
    const batch = admin.firestore().batch();
    batch.set(cref, {
      text,
      uid: req.feedCommenter.uid,
      authorLabel,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(curatorFeedCol().doc(postId), {
      commentCount: admin.firestore.FieldValue.increment(1),
    });
    await batch.commit();
    return res.json({ ok: true, id: cref.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to post comment." });
  }
});

router.get("/me", requireAuthUid, async (req, res) => {
  const slug = curatorSlugForEmail(req.viewer.email);
  const isOwner = req.viewer.email === OWNER_EMAIL;
  const giapEmail = String(process.env.CURATOR_GIAP_EMAIL || "").trim().toLowerCase();
  const isGiap = Boolean(giapEmail && req.viewer.email === giapEmail);

  return res.json({
    curatorId: slug,
    curatorDisplayName: slug ? CURATOR_LABELS[slug] || slug : null,
    isOwner,
    isCoCurator: isGiap,
    canEditPool: isOwner,
    canSelectUniversalPool: isOwner,
  });
});

router.get("/pool/list", requireOwner, async (_req, res) => {
  const items = await loadPoolItemsSorted();
  return res.json({ items });
});

router.post("/pool/add", requireOwner, async (req, res) => {
  const item = normalizePoolItem(req.body || {});
  if (!item.title || !item.pick) {
    return res.status(400).json({ error: "title and pick are required." });
  }
  const ref = admin.firestore().collection("universalPickPool").doc();
  await ref.set({
    ...item,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: req.ownerEmail,
  });
  return res.json({ ok: true, id: ref.id });
});

router.delete("/pool/:itemId", requireOwner, async (req, res) => {
  const id = String(req.params.itemId || "").trim();
  if (!id) return res.status(400).json({ error: "Missing item id." });
  await admin.firestore().collection("universalPickPool").doc(id).delete();
  return res.json({ ok: true });
});

router.get("/:curatorId/pool", requireCuratorLogin, async (_req, res) => {
  const items = await loadPoolItemsSorted();
  return res.json({ items });
});

router.post("/:curatorId/parlays", requireCuratorLogin, async (req, res) => {
  const curatorId = req.curatorId;
  const body = req.body || {};
  const title = String(body.title || "Featured parlay").slice(0, 140);
  const legs = Array.isArray(body.legs) ? body.legs : [];
  if (!legs.length) {
    return res.status(400).json({ error: "legs array required (label + american odds)." });
  }
  const note = String(body.note || "").slice(0, 1200);
  const doc = admin
    .firestore()
    .collection("curatorShowcase")
    .doc(curatorId)
    .collection("parlays")
    .doc();
  await doc.set({
    title,
    legs: legs.slice(0, 20).map((l) => ({
      label: String(l.label || "").slice(0, 240),
      odds: Number.isFinite(Number(l.odds)) ? Math.trunc(Number(l.odds)) : null,
    })),
    note,
    published: body.published !== false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: req.viewer.email,
  });
  return res.json({ ok: true, id: doc.id });
});

router.get("/:curatorId/parlays", requireCuratorSubscriber, async (req, res) => {
  const curatorId = String(req.params.curatorId || "").toLowerCase();
  if (!CURATOR_SLUGS.includes(curatorId)) {
    return res.status(400).json({ error: "Unknown curator." });
  }
  try {
    const snap = await admin
      .firestore()
      .collection("curatorShowcase")
      .doc(curatorId)
      .collection("parlays")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const published = items.filter((x) => x.published !== false);
    return res.json({ curatorId, parlays: published });
  } catch (e) {
    const snap = await admin
      .firestore()
      .collection("curatorShowcase")
      .doc(curatorId)
      .collection("parlays")
      .limit(50)
      .get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const published = items.filter((x) => x.published !== false);
    return res.json({ curatorId, parlays: published, note: "ordered in-memory (add Firestore index for createdAt)." });
  }
});

router.get("/:curatorId/profile", async (req, res) => {
  const curatorId = String(req.params.curatorId || "").toLowerCase();
  if (!CURATOR_SLUGS.includes(curatorId)) {
    return res.status(400).json({ error: "Unknown curator." });
  }
  const snap = await profileRef(curatorId).get();
  const d = snap.exists ? snap.data() || {} : {};
  return res.json({
    id: curatorId,
    label: CURATOR_LABELS[curatorId] || curatorId,
    displayName: d.displayName || CURATOR_LABELS[curatorId] || curatorId,
    photoDataUrl: d.photoDataUrl || null,
    backgroundImageDataUrl: d.backgroundImageDataUrl || null,
    accentHex: d.accentHex || "#ff9f0a",
    backgroundHex: d.backgroundHex || "#0a1227",
    wins: Number(d.wins || 0),
    losses: Number(d.losses || 0),
    pushes: Number(d.pushes || 0),
    updatedAt: d.updatedAt || null,
  });
});

router.post("/:curatorId/profile", requireCuratorLogin, async (req, res) => {
  const curatorId = req.curatorId;
  const body = req.body || {};
  const photoDataUrl = String(body.photoDataUrl || "");
  if (photoDataUrl.length > 480_000) {
    return res.status(400).json({ error: "Photo payload too large (max ~480KB base64)." });
  }
  const backgroundImageDataUrl = String(body.backgroundImageDataUrl || "");
  if (backgroundImageDataUrl.length > 900_000) {
    return res.status(400).json({ error: "Background image too large (max ~900KB base64)." });
  }
  const payload = {
    displayName: String(body.displayName || "").trim() || CURATOR_LABELS[curatorId],
    photoDataUrl: photoDataUrl || null,
    backgroundImageDataUrl: backgroundImageDataUrl || null,
    accentHex: String(body.accentHex || "#ff9f0a").slice(0, 16),
    backgroundHex: String(body.backgroundHex || "#0a1227").slice(0, 16),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: req.viewer.email,
  };
  await profileRef(curatorId).set(payload, { merge: true });
  return res.json({ ok: true });
});

router.patch("/:curatorId/record", requireCuratorLogin, async (req, res) => {
  const curatorId = req.curatorId;
  const body = req.body || {};
  const w = Math.max(0, Math.min(5000, Number(body.winsDelta || 0)));
  const l = Math.max(0, Math.min(5000, Number(body.lossesDelta || 0)));
  const p = Math.max(0, Math.min(5000, Number(body.pushesDelta || 0)));
  const ref = profileRef(curatorId);
  await ref.set(
    {
      wins: admin.firestore.FieldValue.increment(w),
      losses: admin.firestore.FieldValue.increment(l),
      pushes: admin.firestore.FieldValue.increment(p),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return res.json({ ok: true });
});

router.post("/:curatorId/select", requireCuratorLogin, async (req, res) => {
  const curatorId = req.curatorId;
  const ids = Array.isArray(req.body?.pickIds) ? req.body.pickIds.map((x) => String(x)) : [];
  if (!ids.length) return res.status(400).json({ error: "pickIds required." });

  const db = admin.firestore();
  const refs = ids.map((id) => db.collection("universalPickPool").doc(id));
  const snaps = await db.getAll(...refs);
  const upcoming = [];
  for (const s of snaps) {
    if (!s.exists) continue;
    upcoming.push({ id: s.id, ...(s.data() || {}) });
  }
  if (!upcoming.length) return res.status(400).json({ error: "No valid pool ids." });

  await boardRef(curatorId).set(
    {
      upcoming,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastPickPostAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.viewer.email,
    },
    { merge: true }
  );
  return res.json({ ok: true, count: upcoming.length });
});

function normalizeBoardAppendItem(body = {}) {
  const base = normalizePoolItem(body);
  const oddsAmerican = Number(body.oddsAmerican);
  return {
    ...base,
    oddsAmerican: Number.isFinite(oddsAmerican) ? Math.trunc(oddsAmerican) : null,
    book: String(body.book || "").trim().slice(0, 80),
    source: String(body.source || "web_props").trim().slice(0, 40),
    legKey: String(body.legKey || "").trim().slice(0, 320),
  };
}

/** Curator (Bruce/Giap): prepend custom legs from the web prop desk without universal pool rows. */
router.post("/:curatorId/board/append-upcoming", requireCuratorLogin, async (req, res) => {
  const curatorId = req.curatorId;
  const raw = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!raw.length) return res.status(400).json({ error: "items array required." });
  const items = raw.slice(0, 25).map((x) => normalizeBoardAppendItem(x));
  for (const it of items) {
    if (!it.title || !it.pick) {
      return res.status(400).json({ error: "Each item needs title and pick (leg description)." });
    }
  }

  const snap = await boardRef(curatorId).get();
  const prev = snap.exists && Array.isArray(snap.data()?.upcoming) ? snap.data().upcoming : [];
  const ts = Date.now();
  const manual = items.map((row, i) => ({
    id: `web_${ts}_${i}_${Math.random().toString(36).slice(2, 8)}`,
    ...row,
  }));
  const merged = [...manual, ...prev].slice(0, 80);

  await boardRef(curatorId).set(
    {
      upcoming: merged,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastPickPostAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.viewer.email,
    },
    { merge: true },
  );
  return res.json({ ok: true, count: manual.length, totalUpcoming: merged.length });
});

router.post("/:curatorId/history/add", requireCuratorLogin, async (req, res) => {
  const curatorId = req.curatorId;
  const row = normalizeHistoryItem(req.body || {});
  if (!row.title || !["win", "loss", "push"].includes(row.result)) {
    return res.status(400).json({ error: "title and result (win|loss|push) required." });
  }
  const ref = admin
    .firestore()
    .collection("curatorHistory")
    .doc(curatorId)
    .collection("entries")
    .doc();
  await ref.set({
    ...row,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: req.viewer.email,
  });
  return res.json({ ok: true, id: ref.id });
});

router.get("/:curatorId/board", requireCuratorSubscriber, async (req, res) => {
  const curatorId = String(req.params.curatorId || "").toLowerCase();
  const [prof, brd] = await Promise.all([profileRef(curatorId).get(), boardRef(curatorId).get()]);
  const p = prof.exists ? prof.data() || {} : {};
  const b = brd.exists ? brd.data() || {} : {};
  const wins = Number(p.wins || 0);
  const losses = Number(p.losses || 0);
  const pushes = Number(p.pushes || 0);
  const denom = wins + losses;
  const winPct = denom > 0 ? Number(((100 * wins) / denom).toFixed(1)) : null;

  const histSnap = await admin
    .firestore()
    .collection("curatorHistory")
    .doc(curatorId)
    .collection("entries")
    .limit(200)
    .get();
  const history = histSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .sort((a, b) => String(b.settledAt || "").localeCompare(String(a.settledAt || "")))
    .slice(0, 120);

  let parlays = [];
  try {
    const pSnap = await admin
      .firestore()
      .collection("curatorShowcase")
      .doc(curatorId)
      .collection("parlays")
      .orderBy("createdAt", "desc")
      .limit(24)
      .get();
    parlays = pSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).filter((x) => x.published !== false);
  } catch {
    const pSnap = await admin
      .firestore()
      .collection("curatorShowcase")
      .doc(curatorId)
      .collection("parlays")
      .limit(40)
      .get();
    parlays = pSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((x) => x.published !== false)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 24);
  }

  return res.json({
    curatorId,
    label: CURATOR_LABELS[curatorId] || curatorId,
    lastPickPostAt: tsIso(b.lastPickPostAt) || tsIso(b.updatedAt),
    profile: {
      displayName: p.displayName || CURATOR_LABELS[curatorId],
      photoDataUrl: p.photoDataUrl || null,
      backgroundImageDataUrl: p.backgroundImageDataUrl || null,
      accentHex: p.accentHex || "#ff9f0a",
      backgroundHex: p.backgroundHex || "#0a1227",
      wins,
      losses,
      pushes,
      winPct,
    },
    upcoming: Array.isArray(b.upcoming) ? b.upcoming : [],
    parlays,
    history,
  });
});

/** Ops desk (owner PIN or owner Bearer): load universal pool for pick assignment UI. */
async function loadUniversalPickPoolForOps() {
  return loadPoolItemsSorted();
}

/** Ops desk: write upcoming board for Bruce or Giap from pool document ids. */
async function applyCuratorBoardSelectionForOps(curatorId, pickIds, updatedByLabel) {
  const id = String(curatorId || "").toLowerCase();
  if (!CURATOR_SLUGS.includes(id)) {
    throw new Error("Unknown curator (use bruce or giap).");
  }
  const ids = Array.isArray(pickIds) ? pickIds.map((x) => String(x)) : [];
  if (!ids.length) throw new Error("pickIds required.");

  const db = admin.firestore();
  const refs = ids.map((poolId) => db.collection("universalPickPool").doc(poolId));
  const snaps = await db.getAll(...refs);
  const upcoming = [];
  for (const s of snaps) {
    if (!s.exists) continue;
    upcoming.push({ id: s.id, ...(s.data() || {}) });
  }
  if (!upcoming.length) throw new Error("No valid pool ids.");

  await boardRef(id).set(
    {
      upcoming,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastPickPostAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: String(updatedByLabel || "ops-dashboard"),
    },
    { merge: true }
  );
  return upcoming.length;
}

function tsIso(v) {
  if (v == null) return null;
  if (typeof v === "string" && v.trim()) return v.trim();
  try {
    if (typeof v.toDate === "function") return v.toDate().toISOString();
  } catch (_) {}
  return null;
}

/**
 * Append normalized pick rows built from live props (ops PIN / owner). Dedupes by sourceKey.
 */
async function appendCuratorBoardLegsForOps(curatorId, rawRows, updatedByLabel) {
  const id = String(curatorId || "").toLowerCase();
  if (!CURATOR_SLUGS.includes(id)) {
    throw new Error("Unknown curator (use bruce or giap).");
  }
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (!rows.length) throw new Error("rows required.");

  const db = admin.firestore();
  const bref = boardRef(id);
  const snap = await bref.get();
  const prev = snap.exists ? snap.data() || {} : {};
  let upcoming = Array.isArray(prev.upcoming) ? [...prev.upcoming] : [];
  const seen = new Set(
    upcoming.map((r) => String(r.sourceKey || "").trim()).filter(Boolean)
  );

  let added = 0;
  for (const r of rows.slice(0, 48)) {
    const title = String(r.title || "").trim().slice(0, 220);
    const pick = String(r.pick || "").trim().slice(0, 500);
    if (!title || !pick) continue;
    const sourceKey = String(r.sourceKey || "").trim().slice(0, 280) || `${title}|${pick}`.slice(0, 280);
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    upcoming.push({
      id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      league: String(r.league || "").trim().slice(0, 32),
      pick,
      notes: String(r.notes || "").trim().slice(0, 1000),
      confidence: Math.max(0, Math.min(100, Number(r.confidence ?? 60))),
      gameDate: String(r.gameDate || "").trim().slice(0, 80),
      sourceKey,
      postedFrom: "ops-props",
    });
    added += 1;
  }

  if (!added) {
    throw new Error("No new rows to add (empty or all duplicates).");
  }

  upcoming = upcoming.slice(-100);
  await bref.set(
    {
      upcoming,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastPickPostAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: String(updatedByLabel || "ops-dashboard"),
    },
    { merge: true }
  );
  return { added, total: upcoming.length };
}

export {
  router,
  userCuratorAccess,
  CURATOR_SLUGS,
  ALL_CURATORS,
  loadUniversalPickPoolForOps,
  applyCuratorBoardSelectionForOps,
  appendCuratorBoardLegsForOps,
};
