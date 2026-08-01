import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
if (!process.env.JWT_SECRET) {
  console.warn(
    "[quickapply] Warning: JWT_SECRET is not set in .env — using an insecure default. Set a real secret before deploying."
  );
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Requires a valid token. Attaches req.user = {id, name, email, role}.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Missing or invalid session. Please log in again." });
  }
  req.user = { id: payload.sub, name: payload.name, email: payload.email, role: payload.role };
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: `Only ${role} accounts can do this.` });
    }
    next();
  };
}
