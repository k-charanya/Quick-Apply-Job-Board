import { useState, useEffect, useMemo, useRef } from "react";
import { api, getToken, setToken } from "./api.js";
import { socket, connectSocket, disconnectSocket } from "./socket.js";

const TYPES = ["Full-time", "Part-time", "Contract", "Internship"];
const SHIFTS = ["Day", "Night", "Flexible", "Rotating"];
const SALARY_BUCKETS = [
  { label: "Any salary", min: null, max: null },
  { label: "Under $50k", min: 0, max: 50 },
  { label: "$50k–$100k", min: 50, max: 100 },
  { label: "$100k–$150k", min: 100, max: 150 },
  { label: "$150k+", min: 150, max: Infinity },
];
const MAX_RESUME_BYTES = 1024 * 1024;

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
// Purely informational — decodes the JWT payload for display. The real check
// (signature + expiry) happens server-side on every request; this never has to
// be trusted on its own.
function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
function BoardClock() {
  const now = useClock();
  const [colonOn, setColonOn] = useState(true);
  useEffect(() => setColonOn((c) => !c), [now.getSeconds()]);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return (
    <span className="jb-clock">
      {hh}
      <span style={{ opacity: colonOn ? 1 : 0.15 }}>:</span>
      {mm}
    </span>
  );
}
function FlapTitle({ text }) {
  return (
    <h1 className="jb-title" aria-label={text}>
      {text.split("").map((ch, i) => (
        <span key={i} className="jb-flap-char" style={{ animationDelay: `${i * 35}ms` }}>
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </h1>
  );
}

// Drag-to-swipe wrapper (candidate board only). Pointer Events cover mouse + touch.
function SwipeRow({ job, enabled, onSwipeRight, onSwipeLeft, onTap, children }) {
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);

  function onPointerDown(e) {
    if (!enabled) return;
    draggingRef.current = true;
    startXRef.current = e.clientX;
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return;
    setDragX(e.clientX - startXRef.current);
  }
  function endDrag() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (Math.abs(dragX) < 8) onTap?.();
    else if (dragX > 90) onSwipeRight?.(job);
    else if (dragX < -90) onSwipeLeft?.(job);
    setDragX(0);
  }

  return (
    <div className="jb-swipe-wrap">
      <div className="jb-swipe-hint jb-swipe-hint-save">★ Save</div>
      <div className="jb-swipe-hint jb-swipe-hint-trash">Remove ✕</div>
      <div
        className="jb-swipe-surface"
        style={{ transform: `translateX(${dragX}px)`, transition: draggingRef.current ? "none" : "transform 200ms ease" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
      >
        {children}
      </div>
    </div>
  );
}

const emptyDraft = {
  title: "", company: "", location: "", type: "Full-time", salary: "",
  salaryMin: "", salaryMax: "", shift: "Flexible", vacancies: "1", tags: "", apply: "", description: "",
};
const emptyApplicant = { name: "", email: "", phone: "", coverNote: "" };
const emptyAuthForm = { name: "", email: "", password: "", role: "candidate" };

export default function App() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [locationFilter, setLocationFilter] = useState("All");
  const [salaryFilter, setSalaryFilter] = useState("Any salary");
  const [shiftFilter, setShiftFilter] = useState("All");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [posting, setPosting] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [undoAction, setUndoAction] = useState(null);
  const undoTimer = useRef(null);

  const [applyingJob, setApplyingJob] = useState(null);
  const [applicant, setApplicant] = useState(emptyApplicant);
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeError, setResumeError] = useState(null);
  const [useSavedResume, setUseSavedResume] = useState(false);
  const [submittingApp, setSubmittingApp] = useState(false);

  const [applicantsPanelJob, setApplicantsPanelJob] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [loadingApplicants, setLoadingApplicants] = useState(false);
  const applicantsPanelJobRef = useRef(null);
  useEffect(() => { applicantsPanelJobRef.current = applicantsPanelJob; }, [applicantsPanelJob]);

  const [currentUser, setCurrentUser] = useState(null);
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(emptyAuthForm);
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const [saved, setSaved] = useState([]);
  const [trashed, setTrashed] = useState([]);
  const [history, setHistory] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({ phone: "", resumeFile: null, resumeError: null });
  const [profileSaving, setProfileSaving] = useState(false);
  const [myApplications, setMyApplications] = useState([]);
  const [ownJobs, setOwnJobs] = useState([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState(null);

  const isEmployerView = currentUser?.role === "employer";

  // ---------- initial load ----------
  useEffect(() => {
    (async () => {
      try {
        const { jobs } = await api.getJobs();
        setJobs(jobs);
      } catch {
        setError("Couldn't reach the backend. Is it running on the expected port?");
        setJobs([]);
      }

      const token = getToken();
      if (token) {
        try {
          const { user } = await api.me();
          setCurrentUser(user);
          if (user.role === "candidate") await loadCandidateData();
          else await loadOwnJobs();
        } catch {
          setToken(null);
        }
      }
    })();

    connectSocket(getToken());
    socket.on("connect", () => setLive(true));
    socket.on("disconnect", () => setLive(false));
    socket.on("job:created", (job) => {
      setJobs((prev) => (prev ? [job, ...prev.filter((j) => j.id !== job.id)] : [job]));
    });
    socket.on("application:created", ({ jobId, application }) => {
      setOwnJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, applicantCount: (j.applicantCount || 0) + 1 } : j))
      );
      if (applicantsPanelJobRef.current?.id === jobId) {
        setApplicants((prev) => [application, ...prev]);
      }
      showToast(`New applicant for "${application.jobTitle}."`);
    });
    socket.on("application:status", ({ applicationId, status }) => {
      setMyApplications((prev) => prev.map((a) => (a.id === applicationId ? { ...a, status } : a)));
      showToast(`Your application status changed to ${status}.`);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("job:created");
      socket.off("application:created");
      socket.off("application:status");
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCandidateData() {
    try { setSaved(await api.getSaved().then((r) => r.saved)); } catch { setSaved([]); }
    try { setTrashed(await api.getTrash().then((r) => r.trashed)); } catch { setTrashed([]); }
    try { setHistory(await api.getHistory().then((r) => r.history)); } catch { setHistory([]); }
    try { setProfile(await api.getProfile().then((r) => r.profile)); } catch { setProfile(null); }
    try { setMyApplications(await api.getMyApplications().then((r) => r.applications)); } catch { setMyApplications([]); }
  }
  async function loadOwnJobs() {
    try { setOwnJobs(await api.getMyJobs().then((r) => r.jobs)); } catch { setOwnJobs([]); }
  }

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }
  function showUndo(message, run) {
    setUndoAction({ message, run });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoAction(null), 6000);
  }

  // ---------- auth ----------
  function requireAuth(retryFn, opts = {}) {
    setPendingAction({ run: retryFn });
    setAuthMode(opts.mode || "login");
    setAuthForm({ ...emptyAuthForm, role: opts.roleHint || "candidate" });
    setAuthError(null);
    setAuthOpen(true);
  }
  function openAuth(mode) {
    setAuthMode(mode);
    setAuthForm(emptyAuthForm);
    setAuthError(null);
    setPendingAction(null);
    setAuthOpen(true);
  }
  function closeAuthModal() {
    setAuthOpen(false);
    setAuthForm(emptyAuthForm);
    setAuthError(null);
    setPendingAction(null);
  }
  function logout() {
    setToken(null);
    setCurrentUser(null);
    setSaved([]); setTrashed([]); setHistory([]); setProfile(null);
    setMyApplications([]); setOwnJobs([]);
    setMenuOpen(false); setActivePanel(false); setActivePanel(null);
    setSessionInfoOpen(false); setExpandedId(null); setApplicantsPanelJob(null);
    connectSocket(null);
    showToast("Logged out.");
  }

  async function submitAuth(e) {
    e.preventDefault();
    setAuthError(null);
    if (authForm.password.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    setAuthLoading(true);
    try {
      const fn = authMode === "signup" ? api.signup : api.login;
      const { token, user } = await fn(authForm);
      setToken(token);
      setCurrentUser(user);
      connectSocket(token);
      if (user.role === "candidate") await loadCandidateData();
      else await loadOwnJobs();
      setAuthOpen(false);
      setAuthForm(emptyAuthForm);
      showToast(authMode === "signup" ? `Welcome, ${user.name}.` : `Welcome back, ${user.name}.`);
      if (pendingAction?.run) {
        const run = pendingAction.run;
        setPendingAction(null);
        run();
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  // ---------- posting (employer) ----------
  function handlePostClick() {
    if (!currentUser) return requireAuth(() => setShowForm(true), { mode: "signup", roleHint: "employer" });
    if (currentUser.role !== "employer") return showToast("Only employer accounts can post roles.");
    setShowForm(true);
  }
  async function submitJob(e) {
    e.preventDefault();
    if (!draft.title.trim() || !draft.company.trim()) return showToast("Add at least a role title and company.");
    setPosting(true);
    try {
      const { job } = await api.postJob(draft);
      setOwnJobs((prev) => [job, ...prev]); // jobs (public board) updates via the socket broadcast
      setDraft(emptyDraft);
      setShowForm(false);
      showToast("Role posted to the board.");
    } catch (err) {
      showToast(err.message);
    } finally {
      setPosting(false);
    }
  }

  // ---------- save / trash (candidate) ----------
  function handleSwipeRight(job) {
    if (!currentUser || currentUser.role !== "candidate")
      return requireAuth(() => handleSwipeRight(job), { roleHint: "candidate" });
    if (saved.includes(job.id)) return;
    const prev = saved;
    setSaved([...saved, job.id]);
    api.addSaved(job.id).catch(() => showToast("Couldn't save that — try again."));
    showUndo(`Saved "${job.title}."`, () => {
      setSaved(prev);
      api.removeSaved(job.id).catch(() => {});
    });
  }
  function handleSwipeLeft(job) {
    if (!currentUser || currentUser.role !== "candidate")
      return requireAuth(() => handleSwipeLeft(job), { roleHint: "candidate" });
    if (trashed.includes(job.id)) return;
    const prev = trashed;
    setTrashed([...trashed, job.id]);
    api.addTrash(job.id).catch(() => showToast("Couldn't remove that — try again."));
    if (expandedId === job.id) setExpandedId(null);
    showUndo(`Removed "${job.title}."`, () => {
      setTrashed(prev);
      api.removeTrash(job.id).catch(() => {});
    });
  }
  function toggleSaveExplicit(job) {
    if (!currentUser || currentUser.role !== "candidate")
      return requireAuth(() => toggleSaveExplicit(job), { roleHint: "candidate" });
    const already = saved.includes(job.id);
    setSaved(already ? saved.filter((x) => x !== job.id) : [...saved, job.id]);
    (already ? api.removeSaved(job.id) : api.addSaved(job.id)).catch(() => {});
  }
  function restoreFromTrash(jobId) {
    setTrashed(trashed.filter((x) => x !== jobId));
    api.removeTrash(jobId).catch(() => {});
  }
  function toggleExpand(job) {
    const opening = expandedId !== job.id;
    setExpandedId(opening ? job.id : null);
    if (opening && currentUser?.role === "candidate") {
      const nextHist = [{ jobId: job.id, jobTitle: job.title, company: job.company, viewedAt: Date.now() }, ...history.filter((h) => h.jobId !== job.id)].slice(0, 100);
      setHistory(nextHist);
      api.addHistory({ jobId: job.id, jobTitle: job.title, company: job.company }).catch(() => {});
    }
  }

  // ---------- account / resume profile ----------
  function openAccountPanel() {
    setProfileForm({ phone: profile?.phone || "", resumeFile: null, resumeError: null });
    setActivePanel("account");
    setMenuOpen(false);
  }
  function handleProfileResumeChange(e) {
    const file = e.target.files?.[0];
    if (!file) return setProfileForm((f) => ({ ...f, resumeFile: null, resumeError: null }));
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) { setProfileForm((f) => ({ ...f, resumeFile: null, resumeError: "Resume must be a PDF file." })); e.target.value = ""; return; }
    if (file.size > MAX_RESUME_BYTES) { setProfileForm((f) => ({ ...f, resumeFile: null, resumeError: `That file is ${formatBytes(file.size)} — resumes must be 1MB or smaller.` })); e.target.value = ""; return; }
    setProfileForm((f) => ({ ...f, resumeFile: file, resumeError: null }));
  }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsDataURL(file);
    });
  }
  async function saveProfile(e) {
    e.preventDefault();
    if (profileForm.resumeError) return showToast(profileForm.resumeError);
    setProfileSaving(true);
    try {
      const payload = { phone: profileForm.phone.trim() };
      if (profileForm.resumeFile) {
        payload.resumeDataUrl = await readFileAsDataUrl(profileForm.resumeFile);
        payload.resumeFilename = profileForm.resumeFile.name;
        payload.resumeSize = profileForm.resumeFile.size;
      }
      const { profile: next } = await api.saveProfile(payload);
      setProfile(next);
      showToast("Account details saved.");
      setActivePanel(null);
    } catch (err) {
      showToast(err.message);
    } finally {
      setProfileSaving(false);
    }
  }

  // ---------- applying (candidate) ----------
  function handleApplyClick(job) {
    if (!currentUser || currentUser.role !== "candidate")
      return requireAuth(() => handleApplyClick(job), { roleHint: "candidate" });
    openApplyModal(job);
  }
  function openApplyModal(job) {
    setApplicant({ name: currentUser?.name || "", email: currentUser?.email || "", phone: profile?.phone || "", coverNote: "" });
    setUseSavedResume(!!profile?.resumeDataUrl);
    setResumeFile(null);
    setResumeError(null);
    setApplyingJob(job);
  }
  function closeApplyModal() {
    setApplyingJob(null);
    setApplicant(emptyApplicant);
    setResumeFile(null);
    setResumeError(null);
  }
  function handleResumeChange(e) {
    const file = e.target.files?.[0];
    if (!file) return setResumeFile(null) || setResumeError(null);
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) { setResumeFile(null); setResumeError("Resume must be a PDF file."); e.target.value = ""; return; }
    if (file.size > MAX_RESUME_BYTES) { setResumeFile(null); setResumeError(`That file is ${formatBytes(file.size)} — resumes must be 1MB or smaller.`); e.target.value = ""; return; }
    setResumeError(null);
    setResumeFile(file);
  }
  async function submitApplication(e) {
    e.preventDefault();
    if (!applicant.name.trim() || !applicant.email.trim()) return showToast("Add your name and email.");

    setSubmittingApp(true);
    try {
      let resumeDataUrl, resumeFilename, resumeSize;
      if (useSavedResume && profile?.resumeDataUrl) {
        resumeDataUrl = profile.resumeDataUrl;
        resumeFilename = profile.resumeFilename;
        resumeSize = profile.resumeSize;
      } else if (resumeFile) {
        resumeDataUrl = await readFileAsDataUrl(resumeFile);
        resumeFilename = resumeFile.name;
        resumeSize = resumeFile.size;
      } else {
        showToast("Attach your resume as a PDF (max 1MB), or save one to your account.");
        setSubmittingApp(false);
        return;
      }
      const { application } = await api.apply({
        jobId: applyingJob.id,
        name: applicant.name.trim(),
        email: applicant.email.trim(),
        phone: applicant.phone.trim(),
        coverNote: applicant.coverNote.trim(),
        resumeDataUrl, resumeFilename, resumeSize,
      });
      setMyApplications((prev) => [application, ...prev]);
      showToast("Application submitted — the employer can review it live.");
      closeApplyModal();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSubmittingApp(false);
    }
  }

  // ---------- applicants panel (employer, own jobs only — enforced server-side) ----------
  async function openApplicantsPanel(job) {
    setApplicantsPanelJob(job);
    setLoadingApplicants(true);
    try {
      const { applicants } = await api.getApplicants(job.id);
      setApplicants(applicants);
    } catch (err) {
      showToast(err.message);
      setApplicants([]);
    } finally {
      setLoadingApplicants(false);
    }
  }
  async function downloadResume(applicationId, filename) {
    try {
      const { resumeDataUrl } = await api.getResume(applicationId);
      const a = document.createElement("a");
      a.href = resumeDataUrl;
      a.download = filename || "resume.pdf";
      a.click();
    } catch (err) {
      showToast(err.message);
    }
  }
  async function updateApplicationStatus(applicationId, status) {
    try {
      await api.updateStatus(applicationId, status);
      setApplicants((prev) => prev.map((a) => (a.id === applicationId ? { ...a, status } : a)));
      showToast(`Marked as ${status}.`);
    } catch (err) {
      showToast(err.message);
    }
  }

  // ---------- derived ----------
  const locations = useMemo(() => (jobs ? Array.from(new Set(jobs.map((j) => j.location))).sort() : []), [jobs]);
  const baseJobs = useMemo(() => {
    if (!jobs) return [];
    if (isEmployerView) return jobs;
    return jobs.filter((j) => !trashed.includes(j.id));
  }, [jobs, trashed, isEmployerView]);
  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = query.trim().toLowerCase();
    const bucket = SALARY_BUCKETS.find((b) => b.label === salaryFilter);
    return baseJobs.filter((j) => {
      if (showSavedOnly && !saved.includes(j.id)) return false;
      if (typeFilter !== "All" && j.type !== typeFilter) return false;
      if (locationFilter !== "All" && j.location !== locationFilter) return false;
      if (shiftFilter !== "All" && (j.shift || "Not specified") !== shiftFilter) return false;
      if (bucket && bucket.min !== null) {
        if (j.salaryMin == null || j.salaryMax == null) return false;
        const overlaps = j.salaryMax >= bucket.min && (bucket.max === Infinity ? true : j.salaryMin <= bucket.max);
        if (!overlaps) return false;
      }
      if (!q) return true;
      return `${j.title} ${j.company} ${j.location} ${j.tags.join(" ")}`.toLowerCase().includes(q);
    });
  }, [jobs, baseJobs, query, typeFilter, locationFilter, salaryFilter, shiftFilter, showSavedOnly, saved]);
  const activeFilterCount = [typeFilter !== "All", locationFilter !== "All", salaryFilter !== "Any salary", shiftFilter !== "All"].filter(Boolean).length;
  function clearFilters() { setTypeFilter("All"); setLocationFilter("All"); setSalaryFilter("Any salary"); setShiftFilter("All"); }
  const trashedJobs = useMemo(() => (jobs ? trashed.map((id) => jobs.find((j) => j.id === id)).filter(Boolean) : []), [jobs, trashed]);

  function renderJobMeta(job) {
    return (
      <div className="jb-detail-meta">
        {job.salary} · {job.location} · {job.type} · {job.shift || "Shift not specified"} ·{" "}
        {job.vacancies || 1} opening{(job.vacancies || 1) === 1 ? "" : "s"}
      </div>
    );
  }

  return (
    <div className="jb-root">
      <div className="jb-shell">
        <div className="jb-header">
          <div>
            <FlapTitle text="QUICK APPLY" />
            <div className="jb-sub">
              {jobs === null ? "LOADING BOARD…" : isEmployerView
                ? `${ownJobs.length} ROLE${ownJobs.length === 1 ? "" : "S"} POSTED BY YOU`
                : `${filtered.length} OF ${baseJobs.length} POSITION${baseJobs.length === 1 ? "" : "S"} LISTED`}
            </div>
          </div>
          <div className="jb-header-right">
            <BoardClock />
            <span className="jb-live-badge" title={live ? "Connected via WebSocket" : "Reconnecting…"}>
              <span className={`jb-live-dot ${live ? "" : "off"}`} /> {live ? "Live" : "Offline"}
            </span>
            <div className="jb-auth-widget">
              {currentUser ? (
                <>
                  {currentUser.role === "candidate" && (
                    <button className="jb-hamburger" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">☰</button>
                  )}
                  <span className="jb-auth-user">{currentUser.name} · {currentUser.role === "employer" ? "Employer" : "Candidate"}</span>
                  <button className="jb-auth-btn" onClick={() => setSessionInfoOpen(true)}>Session</button>
                  <button className="jb-auth-btn" onClick={logout}>Log out</button>
                </>
              ) : (
                <button className="jb-auth-btn" onClick={() => openAuth("login")}>Log in / Sign up</button>
              )}
            </div>
            {menuOpen && currentUser?.role === "candidate" && (
              <div className="jb-menu-dropdown">
                <button className="jb-menu-item" onClick={openAccountPanel}>Account</button>
                <button className="jb-menu-item" onClick={() => { setActivePanel("trash"); setMenuOpen(false); }}>Trash ({trashed.length})</button>
                <button className="jb-menu-item" onClick={() => { setActivePanel("history"); setMenuOpen(false); }}>View history</button>
                <button className="jb-menu-item" onClick={() => { setActivePanel("applications"); setMenuOpen(false); }}>Applications made</button>
              </div>
            )}
          </div>
        </div>

        {isEmployerView ? (
          <>
            <div className="jb-controls">
              <button className="jb-post-btn" onClick={handlePostClick}>+ Post a role</button>
            </div>
            <div className="jb-board">
              {jobs !== null && ownJobs.length > 0 && (
                <div className="jb-col-headers"><span>Posted</span><span>Role</span><span>Location</span><span>Type</span><span>Applicants</span></div>
              )}
              {jobs === null && <div className="jb-empty">Pulling your listings…</div>}
              {jobs !== null && ownJobs.length === 0 && <div className="jb-empty">You haven't posted any roles yet — click "+ Post a role" to add one.</div>}
              {jobs !== null && ownJobs.map((job) => (
                <div key={job.id} style={{ borderBottom: "1px solid var(--panel-2)" }}>
                  <div className="jb-row" style={{ cursor: "pointer" }} onClick={() => toggleExpand(job)}>
                    <span className="jb-row-time">{timeAgo(job.postedAt)}</span>
                    <span className="jb-row-main"><div className="jb-row-title">{job.title}</div><div className="jb-row-company">{job.company}</div></span>
                    <span className="jb-row-loc">{job.location}</span>
                    <span className="jb-badge">{job.type}</span>
                    <span className="jb-row-actions">{job.applicantCount || 0} applicant{(job.applicantCount || 0) === 1 ? "" : "s"}</span>
                  </div>
                  {expandedId === job.id && (
                    <div className="jb-detail">
                      {renderJobMeta(job)}
                      <div className="jb-detail-desc">{job.description || "No description provided."}</div>
                      <div>{job.tags.map((t) => <span className="jb-tag" key={t}>{t}</span>)}</div>
                      <div className="jb-detail-actions">
                        <button className="jb-applicants-link" onClick={() => openApplicantsPanel(job)}>
                          View applicants ({job.applicantCount || 0}) →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="jb-controls">
              <input className="jb-search" placeholder="Search role, company, location, tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <button className="jb-chip" onClick={() => setFiltersOpen(true)}>
                Filters{activeFilterCount > 0 && <span className="jb-filter-badge">{activeFilterCount}</span>}
              </button>
              <button className={`jb-chip ${showSavedOnly ? "active" : ""}`} onClick={() => setShowSavedOnly((s) => !s)}>★ Saved ({saved.length})</button>
              {!currentUser && <button className="jb-post-btn" onClick={handlePostClick}>+ Post a role</button>}
            </div>
            <div className="jb-board">
              {jobs !== null && filtered.length > 0 && (
                <div className="jb-col-headers"><span>Posted</span><span>Role</span><span>Location</span><span>Type</span><span></span></div>
              )}
              {jobs === null && <div className="jb-empty">Pulling the latest listings…</div>}
              {jobs !== null && filtered.length === 0 && (
                <div className="jb-empty">
                  {showSavedOnly ? "Nothing saved yet. Swipe right (or tap ☆) on a role to keep it here." : "Board's empty for this search — try clearing filters, or be the first employer to post."}
                </div>
              )}
              {jobs !== null && filtered.map((job) => (
                <div key={job.id}>
                  <SwipeRow job={job} enabled={true} onSwipeRight={handleSwipeRight} onSwipeLeft={handleSwipeLeft} onTap={() => toggleExpand(job)}>
                    <div className="jb-row">
                      <span className="jb-row-time">{timeAgo(job.postedAt)}</span>
                      <span className="jb-row-main"><div className="jb-row-title">{job.title}</div><div className="jb-row-company">{job.company}</div></span>
                      <span className="jb-row-loc">{job.location}</span>
                      <span className="jb-badge">{job.type}</span>
                      <span className="jb-row-actions">
                        <button className={`jb-save-btn ${saved.includes(job.id) ? "saved" : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleSaveExplicit(job); }} aria-label="Save role">{saved.includes(job.id) ? "★" : "☆"}</button>
                        <button className="jb-hide-btn" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleSwipeLeft(job); }} aria-label="Remove role">✕</button>
                      </span>
                    </div>
                  </SwipeRow>
                  {expandedId === job.id && (
                    <div className="jb-detail">
                      {renderJobMeta(job)}
                      <div className="jb-detail-desc">{job.description || "No description provided."}</div>
                      <div>{job.tags.map((t) => <span className="jb-tag" key={t}>{t}</span>)}</div>
                      <div className="jb-detail-actions">
                        <button className="jb-apply-btn" onClick={() => handleApplyClick(job)}>Apply →</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="jb-footnote">
          Postings and applications (including resumes) live in a real backend database. Only
          the employer who posted a role can see its applicants — enforced server-side, not just
          hidden in the UI. Login uses a JWT signed with a secret that never leaves the server.
          New postings, applicants, and status changes appear over a live WebSocket connection.
        </div>
      </div>

      {/* ---------- Post a role ---------- */}
      {showForm && (
        <div className="jb-modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Post a role</h2>
            <p className="jb-modal-sub">This goes straight on the board, tagged with your company.</p>
            <form onSubmit={submitJob}>
              <div className="jb-field-row">
                <div className="jb-field"><label>Role title *</label><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Senior Backend Engineer" /></div>
                <div className="jb-field"><label>Company *</label><input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} placeholder="Acme Co." /></div>
              </div>
              <div className="jb-field-row">
                <div className="jb-field"><label>Location</label><input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Remote (US)" /></div>
                <div className="jb-field"><label>Type</label><select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
              </div>
              <div className="jb-field-row">
                <div className="jb-field"><label>Salary (display text)</label><input value={draft.salary} onChange={(e) => setDraft({ ...draft, salary: e.target.value })} placeholder="$120k–$150k" /></div>
                <div className="jb-field"><label>Tags (comma separated)</label><input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="react, frontend, remote" /></div>
              </div>
              <div className="jb-field-row">
                <div className="jb-field"><label>Salary min ($k)</label><input type="number" value={draft.salaryMin} onChange={(e) => setDraft({ ...draft, salaryMin: e.target.value })} placeholder="120" /></div>
                <div className="jb-field"><label>Salary max ($k)</label><input type="number" value={draft.salaryMax} onChange={(e) => setDraft({ ...draft, salaryMax: e.target.value })} placeholder="150" /></div>
                <div className="jb-field"><label>Shift</label><select value={draft.shift} onChange={(e) => setDraft({ ...draft, shift: e.target.value })}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></div>
                <div className="jb-field"><label>Vacancies</label><input type="number" min="1" value={draft.vacancies} onChange={(e) => setDraft({ ...draft, vacancies: e.target.value })} placeholder="1" /></div>
              </div>
              <div className="jb-field"><label>Apply link or email</label><input value={draft.apply} onChange={(e) => setDraft({ ...draft, apply: e.target.value })} placeholder="jobs@company.com or https://…" /></div>
              <div className="jb-field"><label>Description</label><textarea rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What they'll do, what you're looking for…" /></div>
              <div className="jb-modal-actions">
                <button type="button" className="jb-btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="jb-post-btn" disabled={posting} style={{ marginLeft: 0 }}>{posting ? "Posting…" : "Post to board"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Filters ---------- */}
      {filtersOpen && (
        <div className="jb-modal-backdrop" onClick={() => setFiltersOpen(false)}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Filters</h2>
            <p className="jb-modal-sub">Narrow the board down by whatever matters most to you.</p>
            <div className="jb-field"><label>Job type</label><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option>All</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="jb-field"><label>Location</label><select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}><option>All</option>{locations.map((loc) => <option key={loc}>{loc}</option>)}</select></div>
            <div className="jb-field"><label>Salary range</label><select value={salaryFilter} onChange={(e) => setSalaryFilter(e.target.value)}>{SALARY_BUCKETS.map((b) => <option key={b.label}>{b.label}</option>)}</select></div>
            <div className="jb-field"><label>Shift</label><select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}><option>All</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="jb-modal-actions">
              <button type="button" className="jb-btn-secondary" onClick={clearFilters}>Clear all</button>
              <button type="button" className="jb-post-btn" style={{ marginLeft: 0 }} onClick={() => setFiltersOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Apply ---------- */}
      {applyingJob && (
        <div className="jb-modal-backdrop" onClick={closeApplyModal}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Apply — {applyingJob.title}</h2>
            <p className="jb-modal-sub">{applyingJob.company} · Sent straight to the employer's dashboard.</p>
            <form onSubmit={submitApplication}>
              <div className="jb-field-row">
                <div className="jb-field"><label>Full name *</label><input value={applicant.name} onChange={(e) => setApplicant({ ...applicant, name: e.target.value })} placeholder="Jordan Lee" /></div>
                <div className="jb-field"><label>Email *</label><input type="email" value={applicant.email} onChange={(e) => setApplicant({ ...applicant, email: e.target.value })} placeholder="jordan@example.com" /></div>
              </div>
              <div className="jb-field"><label>Phone</label><input value={applicant.phone} onChange={(e) => setApplicant({ ...applicant, phone: e.target.value })} placeholder="Optional" /></div>

              {profile?.resumeDataUrl && (
                <div className="jb-field">
                  <label>Resume</label>
                  <div className="jb-role-options">
                    <button type="button" className={`jb-role-option ${useSavedResume ? "active" : ""}`} onClick={() => setUseSavedResume(true)}>Use saved resume ({profile.resumeFilename})</button>
                    <button type="button" className={`jb-role-option ${!useSavedResume ? "active" : ""}`} onClick={() => setUseSavedResume(false)}>Upload a different PDF</button>
                  </div>
                </div>
              )}
              {(!profile?.resumeDataUrl || !useSavedResume) && (
                <div className="jb-field">
                  <label>{profile?.resumeDataUrl ? "New resume (PDF, max 1MB)" : "Resume (PDF, max 1MB) *"}</label>
                  <div className="jb-file-input">
                    <input type="file" accept="application/pdf,.pdf" onChange={handleResumeChange} />
                    {!resumeError && !resumeFile && <div className="jb-file-hint">PDF only, up to 1MB.</div>}
                    {resumeError && <div className="jb-file-error">{resumeError}</div>}
                    {resumeFile && !resumeError && <div className="jb-file-ok">{resumeFile.name} · {formatBytes(resumeFile.size)}</div>}
                  </div>
                </div>
              )}
              <div className="jb-field"><label>Cover note</label><textarea rows={3} value={applicant.coverNote} onChange={(e) => setApplicant({ ...applicant, coverNote: e.target.value })} placeholder="Anything you'd like the employer to know…" /></div>
              <div className="jb-modal-actions">
                <button type="button" className="jb-btn-secondary" onClick={closeApplyModal}>Cancel</button>
                <button type="submit" className="jb-post-btn" disabled={submittingApp} style={{ marginLeft: 0 }}>{submittingApp ? "Submitting…" : "Submit application"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Applicants (employer, own jobs — server-enforced) ---------- */}
      {applicantsPanelJob && (
        <div className="jb-modal-backdrop" onClick={() => setApplicantsPanelJob(null)}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Applicants — {applicantsPanelJob.title}</h2>
            <p className="jb-modal-sub">{applicantsPanelJob.company}</p>
            {loadingApplicants && <div className="jb-empty" style={{ padding: "24px 0" }}>Loading applicants…</div>}
            {!loadingApplicants && applicants.length === 0 && <div className="jb-empty" style={{ padding: "24px 0" }}>No applications yet for this role.</div>}
            {!loadingApplicants && applicants.map((a) => {
              const status = a.status || "Review";
              return (
                <div className="jb-applicant-row" key={a.id}>
                  <div className="jb-applicant-name">{a.name}</div>
                  <div className="jb-applicant-meta">{a.email}{a.phone ? ` · ${a.phone}` : ""} · {timeAgo(a.appliedAt)}</div>
                  {a.coverNote && <div className="jb-applicant-note">{a.coverNote}</div>}
                  <button className="jb-resume-link" style={{ background: "transparent", border: "none", cursor: "pointer" }} onClick={() => downloadResume(a.id, a.resumeFilename)}>
                    Download resume ({formatBytes(a.resumeSize || 0)}) ↓
                  </button>
                  <div className="jb-status-row">
                    <span className={`jb-status-badge status-${status.toLowerCase()}`}>{status}</span>
                    <button className="jb-status-btn" onClick={() => updateApplicationStatus(a.id, "Review")}>Mark reviewing</button>
                    <button className="jb-status-btn" onClick={() => updateApplicationStatus(a.id, "Accepted")}>Accept</button>
                    <button className="jb-status-btn" onClick={() => updateApplicationStatus(a.id, "Rejected")}>Reject</button>
                  </div>
                </div>
              );
            })}
            <div className="jb-modal-actions">
              <button type="button" className="jb-btn-secondary" onClick={() => setApplicantsPanelJob(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Auth ---------- */}
      {authOpen && (
        <div className="jb-modal-backdrop" onClick={closeAuthModal}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{authMode === "login" ? "Log in" : "Create an account"}</h2>
            <p className="jb-modal-sub">{pendingAction ? "Sign in to continue — you'll pick up right where you left off." : "Your session is a JWT stored in this browser and verified by the server."}</p>
            <div style={{ display: "flex", gap: 4, marginBottom: 16, border: "1px solid var(--panel-2)", borderRadius: 4, padding: 3 }}>
              <button type="button" className="jb-menu-item" style={{ flex: 1, border: "none", borderRadius: 3, textAlign: "center", background: authMode === "login" ? "var(--panel-2)" : "transparent", color: authMode === "login" ? "var(--amber)" : "var(--slate)" }} onClick={() => { setAuthMode("login"); setAuthError(null); }}>Log in</button>
              <button type="button" className="jb-menu-item" style={{ flex: 1, border: "none", borderRadius: 3, textAlign: "center", background: authMode === "signup" ? "var(--panel-2)" : "transparent", color: authMode === "signup" ? "var(--amber)" : "var(--slate)" }} onClick={() => { setAuthMode("signup"); setAuthError(null); }}>Sign up</button>
            </div>
            {authError && <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--red)", marginBottom: 12 }}>{authError}</div>}
            <form onSubmit={submitAuth}>
              {authMode === "signup" && (
                <>
                  <div className="jb-field"><label>Name</label><input value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} placeholder="Jordan Lee, or a company name" /></div>
                  <div className="jb-field">
                    <label>I'm signing up as</label>
                    <div className="jb-role-options">
                      <button type="button" className={`jb-role-option ${authForm.role === "candidate" ? "active" : ""}`} onClick={() => setAuthForm({ ...authForm, role: "candidate" })}>Candidate — apply to jobs</button>
                      <button type="button" className={`jb-role-option ${authForm.role === "employer" ? "active" : ""}`} onClick={() => setAuthForm({ ...authForm, role: "employer" })}>Employer — post jobs</button>
                    </div>
                  </div>
                </>
              )}
              <div className="jb-field"><label>Email</label><input type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="you@example.com" /></div>
              <div className="jb-field"><label>Password</label><input type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="At least 6 characters" /></div>
              <div className="jb-modal-actions">
                <button type="button" className="jb-btn-secondary" onClick={closeAuthModal}>Cancel</button>
                <button type="submit" className="jb-post-btn" disabled={authLoading} style={{ marginLeft: 0 }}>{authLoading ? "Please wait…" : authMode === "login" ? "Log in" : "Create account"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Session (JWT) ---------- */}
      {sessionInfoOpen && (
        <div className="jb-modal-backdrop" onClick={() => setSessionInfoOpen(false)}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Session</h2>
            <p className="jb-modal-sub">
              The JWT the server issued at login. The signature is verified against a secret that only
              the backend holds — this view just decodes the payload for your own reference.
            </p>
            {(() => {
              const claims = decodeJwtPayload(getToken());
              if (!claims) return <div className="jb-empty" style={{ padding: "24px 0" }}>No active session.</div>;
              const minsLeft = Math.max(0, Math.floor((claims.exp - Math.floor(Date.now() / 1000)) / 60));
              return (
                <div className="jb-field">
                  <label>Claims (payload)</label>
                  <div className="jb-file-input" style={{ fontSize: 11, lineHeight: 1.7 }}>
                    sub: {claims.sub}<br />name: {claims.name}<br />email: {claims.email}<br />role: {claims.role}<br />
                    iat: {new Date(claims.iat * 1000).toLocaleString()}<br />
                    exp: {new Date(claims.exp * 1000).toLocaleString()} (~{minsLeft} min left)
                  </div>
                </div>
              );
            })()}
            <div className="jb-modal-actions">
              <button type="button" className="jb-btn-secondary" onClick={() => setSessionInfoOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Options panels ---------- */}
      {activePanel === "account" && (
        <div className="jb-modal-backdrop" onClick={() => setActivePanel(null)}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Your account</h2>
            <p className="jb-modal-sub">{currentUser?.name} · {currentUser?.email}</p>
            <form onSubmit={saveProfile}>
              <div className="jb-field"><label>Phone</label><input value={profileForm.phone} onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Optional" /></div>
              <div className="jb-field">
                <label>{profile?.resumeFilename ? "Replace resume (PDF, max 1MB)" : "Resume (PDF, max 1MB)"}</label>
                {profile?.resumeFilename && !profileForm.resumeFile && (
                  <div className="jb-file-ok" style={{ marginBottom: 8 }}>Currently saved: {profile.resumeFilename} · {formatBytes(profile.resumeSize || 0)}</div>
                )}
                <div className="jb-file-input">
                  <input type="file" accept="application/pdf,.pdf" onChange={handleProfileResumeChange} />
                  {!profileForm.resumeError && !profileForm.resumeFile && <div className="jb-file-hint">Save a resume here to apply in one click later.</div>}
                  {profileForm.resumeError && <div className="jb-file-error">{profileForm.resumeError}</div>}
                  {profileForm.resumeFile && !profileForm.resumeError && <div className="jb-file-ok">{profileForm.resumeFile.name} · {formatBytes(profileForm.resumeFile.size)}</div>}
                </div>
              </div>
              <div className="jb-modal-actions">
                <button type="button" className="jb-btn-secondary" onClick={() => setActivePanel(null)}>Close</button>
                <button type="submit" className="jb-post-btn" disabled={profileSaving} style={{ marginLeft: 0 }}>{profileSaving ? "Saving…" : "Save account"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activePanel === "trash" && (
        <div className="jb-modal-backdrop" onClick={() => setActivePanel(null)}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Trash</h2>
            <p className="jb-modal-sub">Roles you removed. Restore any of them back to your board.</p>
            {trashedJobs.length === 0 && <div className="jb-empty" style={{ padding: "24px 0" }}>Trash is empty.</div>}
            {trashedJobs.map((job) => (
              <div className="jb-panel-item" key={job.id}>
                <div><div className="jb-panel-item-title">{job.title}</div><div className="jb-panel-item-sub">{job.company} · {job.location}</div></div>
                <button className="jb-status-btn" onClick={() => restoreFromTrash(job.id)}>Restore</button>
              </div>
            ))}
            <div className="jb-modal-actions"><button type="button" className="jb-btn-secondary" onClick={() => setActivePanel(null)}>Close</button></div>
          </div>
        </div>
      )}

      {activePanel === "history" && (
        <div className="jb-modal-backdrop" onClick={() => setActivePanel(null)}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>View history</h2>
            <p className="jb-modal-sub">Roles you've opened, most recent first.</p>
            {history.length === 0 && <div className="jb-empty" style={{ padding: "24px 0" }}>You haven't viewed any roles yet.</div>}
            {history.map((h) => (
              <div className="jb-panel-item" key={`${h.jobId}-${h.viewedAt}`}>
                <div><div className="jb-panel-item-title">{h.jobTitle}</div><div className="jb-panel-item-sub">{h.company} · {timeAgo(h.viewedAt)}</div></div>
              </div>
            ))}
            <div className="jb-modal-actions"><button type="button" className="jb-btn-secondary" onClick={() => setActivePanel(null)}>Close</button></div>
          </div>
        </div>
      )}

      {activePanel === "applications" && (
        <div className="jb-modal-backdrop" onClick={() => setActivePanel(null)}>
          <div className="jb-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Applications made</h2>
            <p className="jb-modal-sub">Track the status of every role you've applied to — updates live.</p>
            {myApplications.length === 0 && <div className="jb-empty" style={{ padding: "24px 0" }}>You haven't applied to anything yet.</div>}
            {myApplications.map((a) => {
              const status = a.status || "Review";
              return (
                <div className="jb-panel-item" key={a.id}>
                  <div><div className="jb-panel-item-title">{a.jobTitle}</div><div className="jb-panel-item-sub">{a.company} · {timeAgo(a.appliedAt)}</div></div>
                  <span className={`jb-status-badge status-${status.toLowerCase()}`}>{status}</span>
                </div>
              );
            })}
            <div className="jb-modal-actions"><button type="button" className="jb-btn-secondary" onClick={() => setActivePanel(null)}>Close</button></div>
          </div>
        </div>
      )}

      {toast && <div className="jb-toast">{toast}</div>}
      {undoAction && (
        <div className="jb-toast">
          {undoAction.message}
          <button className="jb-undo-btn" onClick={() => { undoAction.run(); setUndoAction(null); }}>Undo</button>
        </div>
      )}
      {error && <div className="jb-toast">{error}</div>}
    </div>
  );
}
