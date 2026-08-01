import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { db, persist } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/signup", async (req, res) => {
  const { name, email, password, role } = req.body || {};
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!name?.trim() || !cleanEmail || !password) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  const finalRole = role === "employer" ? "employer" : "candidate";

  await db.read();
  if (db.data.users.some((u) => u.email === cleanEmail)) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    name: name.trim(),
    email: cleanEmail,
    role: finalRole,
    passwordHash,
    createdAt: Date.now(),
  };
  db.data.users.push(user);
  await persist();

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  await db.read();
  const user = db.data.users.find((u) => u.email === cleanEmail);
  if (!user) {
    return res.status(401).json({ error: "No account with that email." });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Wrong password." });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export default router;
