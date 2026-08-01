import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db, persist } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Public — anyone can browse the full board
router.get("/", async (req, res) => {
  await db.read();
  const sorted = [...db.data.jobs].sort((a, b) => b.postedAt - a.postedAt);
  res.json({ jobs: sorted });
});

// Employer — only their own postings, each annotated with its applicant count
router.get("/mine", requireAuth, requireRole("employer"), async (req, res) => {
  await db.read();
  const mine = db.data.jobs
    .filter((j) => j.postedById === req.user.id)
    .sort((a, b) => b.postedAt - a.postedAt)
    .map((j) => ({
      ...j,
      applicantCount: db.data.applications.filter((a) => a.jobId === j.id).length,
    }));
  res.json({ jobs: mine });
});

router.post("/", requireAuth, requireRole("employer"), async (req, res) => {
  const d = req.body || {};
  if (!d.title?.trim() || !d.company?.trim()) {
    return res.status(400).json({ error: "Add at least a role title and company." });
  }
  const job = {
    id: uuid(),
    title: d.title.trim(),
    company: d.company.trim(),
    location: d.location?.trim() || "Not specified",
    type: d.type || "Full-time",
    salary: d.salary?.trim() || "Not disclosed",
    salaryMin: d.salaryMin != null && d.salaryMin !== "" ? Number(d.salaryMin) : null,
    salaryMax: d.salaryMax != null && d.salaryMax !== "" ? Number(d.salaryMax) : null,
    shift: d.shift || "Flexible",
    vacancies: d.vacancies ? Math.max(1, Number(d.vacancies)) : 1,
    tags: Array.isArray(d.tags)
      ? d.tags.slice(0, 6)
      : (d.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 6),
    apply: d.apply?.trim() || "",
    description: d.description?.trim() || "",
    postedAt: Date.now(),
    postedById: req.user.id,
    postedByName: req.user.name,
  };

  await db.read();
  db.data.jobs.unshift(job);
  await persist();

  req.app.locals.io.emit("job:created", job); // public: everyone sees new postings live
  res.status(201).json({ job });
});

// Employer, owner-only — applicants for a specific job
router.get("/:id/applicants", requireAuth, requireRole("employer"), async (req, res) => {
  await db.read();
  const job = db.data.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  if (job.postedById !== req.user.id) {
    return res.status(403).json({ error: "You can only view applicants for roles you posted." });
  }
  const applicants = db.data.applications
    .filter((a) => a.jobId === job.id)
    .sort((a, b) => b.appliedAt - a.appliedAt);
  res.json({ applicants });
});

export default router;
