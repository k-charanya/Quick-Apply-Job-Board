import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db, persist } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const MAX_RESUME_BYTES = 1024 * 1024; // 1MB

function base64Size(dataUrl) {
  const b64 = (dataUrl || "").split(",")[1] || "";
  return Math.floor((b64.length * 3) / 4);
}

router.post("/", requireAuth, requireRole("candidate"), async (req, res) => {
  const d = req.body || {};
  if (!d.jobId || !d.name?.trim() || !d.email?.trim()) {
    return res.status(400).json({ error: "Job, name, and email are required." });
  }
  if (!d.resumeDataUrl || !d.resumeFilename) {
    return res.status(400).json({ error: "Attach a resume (PDF, max 1MB), or save one to your account." });
  }
  if (!/^data:application\/pdf/.test(d.resumeDataUrl)) {
    return res.status(400).json({ error: "Resume must be a PDF file." });
  }
  const size = base64Size(d.resumeDataUrl);
  if (size > MAX_RESUME_BYTES) {
    return res.status(400).json({ error: "Resume must be 1MB or smaller." });
  }

  await db.read();
  const job = db.data.jobs.find((j) => j.id === d.jobId);
  if (!job) return res.status(404).json({ error: "That job no longer exists." });

  const application = {
    id: uuid(),
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    applicantId: req.user.id,
    name: d.name.trim(),
    email: d.email.trim(),
    phone: (d.phone || "").trim(),
    coverNote: (d.coverNote || "").trim(),
    resumeFilename: d.resumeFilename,
    resumeSize: size,
    resumeDataUrl: d.resumeDataUrl,
    status: "Review",
    appliedAt: Date.now(),
  };
  db.data.applications.push(application);
  await persist();

  // Notify only the employer who owns this job, in real time
  req.app.locals.io.to(`user:${job.postedById}`).emit("application:created", {
    jobId: job.id,
    application: { ...application, resumeDataUrl: undefined }, // don't push the resume blob over the wire unprompted
  });

  res.status(201).json({ application: { ...application, resumeDataUrl: undefined } });
});

router.get("/mine", requireAuth, requireRole("candidate"), async (req, res) => {
  await db.read();
  const mine = db.data.applications
    .filter((a) => a.applicantId === req.user.id)
    .map((a) => ({ ...a, resumeDataUrl: undefined }))
    .sort((a, b) => b.appliedAt - a.appliedAt);
  res.json({ applications: mine });
});

router.get("/:id/resume", requireAuth, requireRole("employer"), async (req, res) => {
  await db.read();
  const app = db.data.applications.find((a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found." });
  const job = db.data.jobs.find((j) => j.id === app.jobId);
  if (!job || job.postedById !== req.user.id) {
    return res.status(403).json({ error: "You can only view applicants for roles you posted." });
  }
  res.json({ resumeDataUrl: app.resumeDataUrl, resumeFilename: app.resumeFilename });
});

router.patch("/:id/status", requireAuth, requireRole("employer"), async (req, res) => {
  const { status } = req.body || {};
  if (!["Review", "Accepted", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  await db.read();
  const app = db.data.applications.find((a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found." });
  const job = db.data.jobs.find((j) => j.id === app.jobId);
  if (!job || job.postedById !== req.user.id) {
    return res.status(403).json({ error: "You can only update applicants for roles you posted." });
  }
  app.status = status;
  await persist();

  // Notify only the candidate who applied, in real time
  req.app.locals.io.to(`user:${app.applicantId}`).emit("application:status", {
    applicationId: app.id,
    status,
  });

  res.json({ application: { ...app, resumeDataUrl: undefined } });
});

export default router;
