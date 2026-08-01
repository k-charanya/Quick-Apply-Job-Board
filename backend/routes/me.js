import { Router } from "express";
import { db, persist } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const MAX_RESUME_BYTES = 1024 * 1024;

function base64Size(dataUrl) {
  const b64 = (dataUrl || "").split(",")[1] || "";
  return Math.floor((b64.length * 3) / 4);
}

router.use(requireAuth, requireRole("candidate"));

// ---------- saved ----------
router.get("/saved", async (req, res) => {
  await db.read();
  const ids = db.data.saved.filter((s) => s.userId === req.user.id).map((s) => s.jobId);
  res.json({ saved: ids });
});

router.post("/saved/:jobId", async (req, res) => {
  await db.read();
  const exists = db.data.saved.some((s) => s.userId === req.user.id && s.jobId === req.params.jobId);
  if (!exists) db.data.saved.push({ userId: req.user.id, jobId: req.params.jobId });
  await persist();
  res.json({ ok: true });
});

router.delete("/saved/:jobId", async (req, res) => {
  await db.read();
  db.data.saved = db.data.saved.filter((s) => !(s.userId === req.user.id && s.jobId === req.params.jobId));
  await persist();
  res.json({ ok: true });
});

// ---------- trash ----------
router.get("/trash", async (req, res) => {
  await db.read();
  const ids = db.data.trashed.filter((t) => t.userId === req.user.id).map((t) => t.jobId);
  res.json({ trashed: ids });
});

router.post("/trash/:jobId", async (req, res) => {
  await db.read();
  const exists = db.data.trashed.some((t) => t.userId === req.user.id && t.jobId === req.params.jobId);
  if (!exists) db.data.trashed.push({ userId: req.user.id, jobId: req.params.jobId });
  await persist();
  res.json({ ok: true });
});

router.delete("/trash/:jobId", async (req, res) => {
  await db.read();
  db.data.trashed = db.data.trashed.filter((t) => !(t.userId === req.user.id && t.jobId === req.params.jobId));
  await persist();
  res.json({ ok: true });
});

// ---------- view history ----------
router.get("/history", async (req, res) => {
  await db.read();
  const mine = db.data.history
    .filter((h) => h.userId === req.user.id)
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .slice(0, 100);
  res.json({ history: mine });
});

router.post("/history", async (req, res) => {
  const { jobId, jobTitle, company } = req.body || {};
  if (!jobId) return res.status(400).json({ error: "jobId required." });
  await db.read();
  db.data.history = db.data.history.filter((h) => !(h.userId === req.user.id && h.jobId === jobId));
  db.data.history.push({ userId: req.user.id, jobId, jobTitle, company, viewedAt: Date.now() });
  await persist();
  res.json({ ok: true });
});

// ---------- profile / resume ----------
router.get("/profile", async (req, res) => {
  await db.read();
  const profile = db.data.profiles.find((p) => p.userId === req.user.id) || null;
  res.json({ profile });
});

router.put("/profile", async (req, res) => {
  const { phone, resumeFilename, resumeSize, resumeDataUrl } = req.body || {};
  if (resumeDataUrl) {
    if (!/^data:application\/pdf/.test(resumeDataUrl)) {
      return res.status(400).json({ error: "Resume must be a PDF file." });
    }
    if (base64Size(resumeDataUrl) > MAX_RESUME_BYTES) {
      return res.status(400).json({ error: "Resume must be 1MB or smaller." });
    }
  }
  await db.read();
  let profile = db.data.profiles.find((p) => p.userId === req.user.id);
  if (!profile) {
    profile = { userId: req.user.id };
    db.data.profiles.push(profile);
  }
  profile.phone = phone ?? profile.phone ?? "";
  if (resumeDataUrl) {
    profile.resumeFilename = resumeFilename;
    profile.resumeSize = resumeSize ?? base64Size(resumeDataUrl);
    profile.resumeDataUrl = resumeDataUrl;
  }
  profile.updatedAt = Date.now();
  await persist();
  res.json({ profile });
});

export default router;
