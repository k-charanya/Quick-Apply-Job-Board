const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

let token = localStorage.getItem("qa_token") || null;

export function getToken() {
  return token;
}
export function setToken(t) {
  token = t;
  if (t) localStorage.setItem("qa_token", t);
  else localStorage.removeItem("qa_token");
}

async function request(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  base: BASE,
  signup: (payload) => request("/api/auth/signup", { method: "POST", body: payload }),
  login: (payload) => request("/api/auth/login", { method: "POST", body: payload }),
  me: () => request("/api/auth/me", { auth: true }),

  getJobs: () => request("/api/jobs"),
  getMyJobs: () => request("/api/jobs/mine", { auth: true }),
  postJob: (payload) => request("/api/jobs", { method: "POST", body: payload, auth: true }),
  getApplicants: (jobId) => request(`/api/jobs/${jobId}/applicants`, { auth: true }),

  apply: (payload) => request("/api/applications", { method: "POST", body: payload, auth: true }),
  getMyApplications: () => request("/api/applications/mine", { auth: true }),
  getResume: (applicationId) => request(`/api/applications/${applicationId}/resume`, { auth: true }),
  updateStatus: (applicationId, status) =>
    request(`/api/applications/${applicationId}/status`, { method: "PATCH", body: { status }, auth: true }),

  getSaved: () => request("/api/me/saved", { auth: true }),
  addSaved: (jobId) => request(`/api/me/saved/${jobId}`, { method: "POST", auth: true }),
  removeSaved: (jobId) => request(`/api/me/saved/${jobId}`, { method: "DELETE", auth: true }),

  getTrash: () => request("/api/me/trash", { auth: true }),
  addTrash: (jobId) => request(`/api/me/trash/${jobId}`, { method: "POST", auth: true }),
  removeTrash: (jobId) => request(`/api/me/trash/${jobId}`, { method: "DELETE", auth: true }),

  getHistory: () => request("/api/me/history", { auth: true }),
  addHistory: (payload) => request("/api/me/history", { method: "POST", body: payload, auth: true }),

  getProfile: () => request("/api/me/profile", { auth: true }),
  saveProfile: (payload) => request("/api/me/profile", { method: "PUT", body: payload, auth: true }),
};
