import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";
import { SEED_JOBS } from "./seedJobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, "data", "db.json");

const defaultData = {
  users: [], // {id, name, email, role, passwordHash, createdAt}
  jobs: [], // see seedJobs.js shape
  applications: [], // {id, jobId, jobTitle, company, applicantId, name, email, phone, coverNote, resumeFilename, resumeSize, resumeDataUrl, status, appliedAt}
  saved: [], // {userId, jobId}
  trashed: [], // {userId, jobId}
  history: [], // {userId, jobId, jobTitle, company, viewedAt}
  profiles: [], // {userId, phone, resumeFilename, resumeSize, resumeDataUrl, updatedAt}
};

const adapter = new JSONFile(file);
export const db = new Low(adapter, defaultData);

export async function initDb() {
  await db.read();
  db.data ||= defaultData;
  if (db.data.jobs.length === 0) {
    db.data.jobs = SEED_JOBS;
  }
  await db.write();
}

export async function persist() {
  await db.write();
}
