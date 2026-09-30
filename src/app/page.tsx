"use client";

import {
  useDeferredValue,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  MapPin,
  MessageSquareText,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import jobsData from "@/data/jobs.json";
import CareerAgent from "@/components/career-agent";
import AuthDialog from "@/components/auth-dialog";
import { useFirebaseSession } from "@/components/firebase-session";
import {
  defaultPreferences,
  plainText,
  scoreJob,
  type CareerPreferences,
} from "@/lib/matching";
import type { Job } from "@/lib/types";

const jobs = jobsData as Job[];
const savedStoragePrefix = "workfinder.saved.v1";
const preferencesStoragePrefix = "workfinder.preferences.v1";
const feedbackStoragePrefix = "workfinder.feedback.v1";
const storageEvent = "workfinder-storage";

function subscribeToStorage(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(storageEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(storageEvent, listener);
  };
}

function getStorageSnapshot(key: string, legacyKey?: string): string {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    if (!legacyKey) return "";
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) localStorage.setItem(key, legacy);
    return legacy ?? "";
  } catch {
    return "";
  }
}

type View = "matches" | "all" | "saved";

export default function Home() {
  const { user, loading: authLoading, signOut } = useFirebaseSession();
  const userScope = user?.uid ?? "guest";
  const savedStorageKey = `${savedStoragePrefix}.${userScope}`;
  const preferencesStorageKey = `${preferencesStoragePrefix}.${userScope}`;
  const feedbackStorageKey = `${feedbackStoragePrefix}.${userScope}`;
  const legacyStorage = user ? undefined : true;
  const [view, setView] = useState<View>("matches");
  const [query, setQuery] = useState("");
  const storedPreferences = useSyncExternalStore(
    subscribeToStorage,
    () =>
      getStorageSnapshot(
        preferencesStorageKey,
        legacyStorage ? preferencesStoragePrefix : undefined,
      ),
    () => "",
  );
  const storedSavedIds = useSyncExternalStore(
    subscribeToStorage,
    () =>
      getStorageSnapshot(
        savedStorageKey,
        legacyStorage ? savedStoragePrefix : undefined,
      ),
    () => "",
  );
  const storedFeedback = useSyncExternalStore(
    subscribeToStorage,
    () =>
      getStorageSnapshot(
        feedbackStorageKey,
        legacyStorage ? feedbackStoragePrefix : undefined,
      ),
    () => "",
  );
  const preferences = useMemo(() => {
    try {
      return storedPreferences
        ? { ...defaultPreferences, ...JSON.parse(storedPreferences) }
        : defaultPreferences;
    } catch {
      return defaultPreferences;
    }
  }, [storedPreferences]);
  const savedIds = useMemo(() => {
    try {
      return storedSavedIds ? (JSON.parse(storedSavedIds) as string[]) : [];
    } catch {
      return [];
    }
  }, [storedSavedIds]);
  const feedback = useMemo(() => {
    try {
      const value: unknown = storedFeedback ? JSON.parse(storedFeedback) : {};
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, "relevant" | "irrelevant"] =>
            entry[1] === "relevant" || entry[1] === "irrelevant",
        ),
      );
    } catch {
      return {};
    }
  }, [storedFeedback]);
  const [selectedId, setSelectedId] = useState(jobs[0]?.id ?? "");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const scoredJobs = useMemo(
    () =>
      jobs.map((job) => ({ ...job, matchScore: scoreJob(job, preferences) })),
    [preferences],
  );

  const filteredJobs = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return scoredJobs
      .filter((job) => view !== "saved" || savedIds.includes(job.id))
      .filter((job) => {
        if (!normalizedQuery) return true;
        return `${job.title} ${job.company} ${job.location} ${job.description}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((first, second) =>
        view === "all"
          ? new Date(second.discovered_at).getTime() -
            new Date(first.discovered_at).getTime()
          : second.matchScore - first.matchScore,
      );
  }, [deferredQuery, savedIds, scoredJobs, view]);

  const selectedJob =
    scoredJobs.find((job) => job.id === selectedId) ?? filteredJobs[0];
  const updatePreferences = (next: CareerPreferences) => {
    localStorage.setItem(preferencesStorageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(storageEvent));
  };

  const toggleSaved = (jobId: string) => {
    const next = savedIds.includes(jobId)
      ? savedIds.filter((id) => id !== jobId)
      : [...savedIds, jobId];
    localStorage.setItem(savedStorageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(storageEvent));
  };

  const setJobFeedback = (jobId: string, signal: "relevant" | "irrelevant") => {
    localStorage.setItem(
      feedbackStorageKey,
      JSON.stringify({ ...feedback, [jobId]: signal }),
    );
    window.dispatchEvent(new Event(storageEvent));
  };

  return (
    <main className="workspace">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Workfinder home">
          <span className="brand-mark">
            <span />
          </span>
          <span>
            workfinder<span className="wordmark-period">.</span>
          </span>
        </a>
        <div className="topbar-right">
          <span className="source-status">
            <span className="status-dot" />
            Open listings
          </span>
          <button
            className="agent-launch"
            type="button"
            onClick={() => (user ? setAgentOpen(true) : setAuthOpen(true))}
            title={
              user ? "Open career agent" : "Sign in to use the career agent"
            }
          >
            <MessageSquareText size={15} />
            <span>Career agent</span>
          </button>
          <button
            className="icon-button profile-button"
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Career preferences"
            title="Career preferences"
          >
            <Settings2 size={17} />
          </button>
          {user ? (
            <button
              className="profile-avatar"
              type="button"
              onClick={() => {
                setAgentOpen(false);
                void signOut();
              }}
              aria-label={`Sign out ${user.email}`}
              title={`Sign out ${user.email}`}
            >
              {user.email.slice(0, 1).toUpperCase()}
            </button>
          ) : (
            <button
              className="sign-in-launch"
              type="button"
              disabled={authLoading}
              onClick={() => setAuthOpen(true)}
            >
              {authLoading ? "Checking" : "Sign in"}
            </button>
          )}
        </div>
      </header>

      <div className="content-shell" id="top">
        <aside className="left-rail">
          <p className="rail-label">Workspace</p>
          <nav className="rail-nav" aria-label="Job views">
            <button
              className={view === "matches" ? "rail-link active" : "rail-link"}
              onClick={() => setView("matches")}
            >
              <Sparkles size={16} />
              <span>For you</span>
              <span className="rail-count">{jobs.length}</span>
            </button>
            <button
              className={view === "all" ? "rail-link active" : "rail-link"}
              onClick={() => setView("all")}
            >
              <BriefcaseBusiness size={16} />
              <span>All roles</span>
            </button>
            <button
              className={view === "saved" ? "rail-link active" : "rail-link"}
              onClick={() => setView("saved")}
            >
              <Bookmark size={16} />
              <span>Saved</span>
              <span className="rail-count">{savedIds.length}</span>
            </button>
          </nav>

          <div className="profile-summary">
            <div className="summary-heading">
              <span className="summary-icon">
                <SlidersHorizontal size={14} />
              </span>
              <span>YOUR SEARCH</span>
            </div>
            <p className="summary-role">
              {preferences.roles.split(",")[0] || "Add target roles"}
            </p>
            <p className="summary-location">
              <MapPin size={13} />
              {preferences.location || "Any location"}
            </p>
            <button
              className="text-action"
              onClick={() => setSettingsOpen(true)}
            >
              Edit preferences <ArrowUpRight size={13} />
            </button>
          </div>

          <div className="rail-footer">
            <span>TRUST TECH JOBS</span>
            <span>×</span>
            <span>CAREER AGENT</span>
          </div>
        </aside>

        <section className="results-column" aria-label="Job listings">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                CAREER INTELLIGENCE /{" "}
                {view === "saved" ? "SAVED ROLES" : "JOB DISCOVERY"}
              </p>
              <h1>
                {view === "saved"
                  ? "Saved roles"
                  : view === "all"
                    ? "Explore opportunities"
                    : "Your next move"}
              </h1>
              <p className="heading-caption">
                {view === "matches"
                  ? "Roles ranked against your experience and preferences."
                  : view === "saved"
                    ? "A shortlist that stays on this device."
                    : "Fresh roles from trusted company boards."}
              </p>
            </div>
            <button
              className="filter-button"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <SlidersHorizontal size={15} /> Preferences
            </button>
          </div>

          <div className="search-row">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, company, skill..."
                aria-label="Search jobs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <button
              className="sort-button"
              type="button"
              onClick={() => setView(view === "all" ? "matches" : "all")}
              title="Toggle sort order"
            >
              <ArrowDownWideNarrow size={15} />
              {view === "all" ? "Most recent" : "Best match"}
              <ChevronDown size={13} />
            </button>
          </div>

          <div className="list-meta">
            <span>{filteredJobs.length} roles</span>
            <span className="meta-divider" />
            <span>
              {view === "all" ? "Sorted by newest" : "Sorted by match"}
            </span>
          </div>

          <div className="job-list">
            {filteredJobs.map((job, index) => (
              <article
                key={job.id}
                className={`job-row ${selectedJob?.id === job.id ? "selected" : ""}`}
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <button
                  className="job-main"
                  onClick={() => setSelectedId(job.id)}
                >
                  <span className="company-monogram" aria-hidden="true">
                    {job.company.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="job-copy">
                    <span className="job-title">{job.title}</span>
                    <span className="job-company">
                      {job.company}
                      <span className="job-dot">·</span>
                      {job.location}
                    </span>
                    <span className="job-tags">
                      <span>{job.remote_status || "On-site"}</span>
                      <span>{job.source}</span>
                    </span>
                  </span>
                </button>
                <div className="job-score">
                  <span
                    className={
                      job.matchScore >= 65
                        ? "score-value strong"
                        : "score-value"
                    }
                  >
                    {job.matchScore}
                  </span>
                  <span className="score-caption">MATCH</span>
                </div>
                <button
                  className={`save-button ${savedIds.includes(job.id) ? "is-saved" : ""}`}
                  type="button"
                  onClick={() => toggleSaved(job.id)}
                  title={
                    savedIds.includes(job.id)
                      ? "Remove saved role"
                      : "Save role"
                  }
                  aria-label={
                    savedIds.includes(job.id)
                      ? "Remove saved role"
                      : "Save role"
                  }
                >
                  {savedIds.includes(job.id) ? (
                    <Check size={16} />
                  ) : (
                    <Bookmark size={16} />
                  )}
                </button>
              </article>
            ))}
            {filteredJobs.length === 0 && (
              <div className="empty-state">
                <Search size={21} />
                <strong>No roles found</strong>
                <span>
                  Try another search or save a role from your matches.
                </span>
              </div>
            )}
          </div>
          <p className="data-note">
            Listings are sourced from public company job boards. Match scores
            are directional, not hiring recommendations.
          </p>
        </section>

        <aside className="detail-column" aria-label="Selected job details">
          {selectedJob ? (
            <div className="detail-panel">
              <div className="detail-topline">
                <span>ROLE SNAPSHOT</span>
                <button
                  className={`save-button ${savedIds.includes(selectedJob.id) ? "is-saved" : ""}`}
                  type="button"
                  onClick={() => toggleSaved(selectedJob.id)}
                  title="Save role"
                  aria-label="Save role"
                >
                  {savedIds.includes(selectedJob.id) ? (
                    <Check size={16} />
                  ) : (
                    <Bookmark size={16} />
                  )}
                </button>
              </div>
              <div className="detail-company-mark">
                {selectedJob.company.slice(0, 1).toUpperCase()}
              </div>
              <p className="detail-company">{selectedJob.company}</p>
              <h2>{selectedJob.title}</h2>
              <p className="detail-location">
                <MapPin size={14} />
                {selectedJob.location}
              </p>
              <div className="match-meter">
                <div className="meter-copy">
                  <span>Career-agent match</span>
                  <strong>
                    {selectedJob.matchScore}
                    <small>/100</small>
                  </strong>
                </div>
                <div className="meter-track">
                  <span style={{ width: `${selectedJob.matchScore}%` }} />
                </div>
                <p>Based on role alignment, skills and location preferences.</p>
              </div>
              <div className="match-feedback">
                <span>Is this a useful match?</span>
                <button
                  className={
                    feedback[selectedJob.id] === "relevant"
                      ? "feedback-choice chosen"
                      : "feedback-choice"
                  }
                  type="button"
                  aria-pressed={feedback[selectedJob.id] === "relevant"}
                  onClick={() => setJobFeedback(selectedJob.id, "relevant")}
                  title="Tell the agent this role is relevant"
                >
                  <ThumbsUp size={13} />
                  Relevant
                </button>
                <button
                  className={
                    feedback[selectedJob.id] === "irrelevant"
                      ? "feedback-choice chosen"
                      : "feedback-choice"
                  }
                  type="button"
                  aria-pressed={feedback[selectedJob.id] === "irrelevant"}
                  onClick={() => setJobFeedback(selectedJob.id, "irrelevant")}
                  title="Tell the agent this role is not relevant"
                >
                  <ThumbsDown size={13} />
                  Not for me
                </button>
              </div>
              <div className="detail-description">
                <p className="detail-label">ROLE OVERVIEW</p>
                <p>
                  {plainText(selectedJob.description).slice(0, 950)}
                  {plainText(selectedJob.description).length > 950 ? "…" : ""}
                </p>
              </div>
              <a
                className="apply-button"
                href={selectedJob.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View original listing <ArrowUpRight size={16} />
              </a>
              <p className="source-footnote">
                SOURCE <span>{selectedJob.source}</span>
              </p>
            </div>
          ) : (
            <div className="detail-empty">
              Choose a role to see its details.
            </div>
          )}
        </aside>
      </div>

      {settingsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="preferences-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preferences-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">CAREER PROFILE</p>
                <h2 id="preferences-title">Tune your matches</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close preferences"
              >
                <X size={18} />
              </button>
            </div>
            <p className="modal-description">
              Preferences stay in this browser. Add comma-separated values to
              adjust the match ranking.
            </p>
            <label className="field-label">
              Target roles
              <textarea
                rows={3}
                value={preferences.roles}
                onChange={(event) =>
                  updatePreferences({
                    ...preferences,
                    roles: event.target.value,
                  })
                }
                placeholder="Staff Engineer, Engineering Manager"
              />
            </label>
            <label className="field-label">
              Preferred location
              <input
                value={preferences.location}
                onChange={(event) =>
                  updatePreferences({
                    ...preferences,
                    location: event.target.value,
                  })
                }
                placeholder="Remote, India"
              />
            </label>
            <label className="field-label">
              Experience
              <input
                value={preferences.experience}
                onChange={(event) =>
                  updatePreferences({
                    ...preferences,
                    experience: event.target.value,
                  })
                }
                placeholder="10+ years"
              />
            </label>
            <label className="field-label">
              Skills to prioritize
              <input
                value={preferences.skills}
                onChange={(event) =>
                  updatePreferences({
                    ...preferences,
                    skills: event.target.value,
                  })
                }
                placeholder="Distributed systems, Kubernetes"
              />
            </label>
            <div className="modal-actions">
              <button
                className="reset-button"
                onClick={() => updatePreferences(defaultPreferences)}
              >
                Reset defaults
              </button>
              <button
                className="apply-button modal-done"
                onClick={() => setSettingsOpen(false)}
              >
                Done <Check size={15} />
              </button>
            </div>
          </section>
        </div>
      )}
      {agentOpen && (
        <CareerAgent
          preferences={preferences}
          savedJobIds={savedIds}
          feedback={Object.entries(feedback).map(([jobId, signal]) => ({
            jobId,
            signal,
          }))}
          onClose={() => setAgentOpen(false)}
        />
      )}
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
    </main>
  );
}
