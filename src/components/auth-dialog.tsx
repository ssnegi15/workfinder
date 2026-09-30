"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { useFirebaseSession } from "@/components/firebase-session";

export default function AuthDialog({ onClose }: { onClose: () => void }) {
  const { configured, signIn, signUp, resetPassword } = useFirebaseSession();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
        onClose();
      } else if (mode === "signup") {
        await signUp(email.trim(), password);
        setMode("signin");
        setPassword("");
        setMessage("Check your email, verify the address, then sign in.");
      } else {
        await resetPassword(email.trim());
        setMessage(
          "If that account exists, Firebase sent a password reset link.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Authentication could not be completed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <div className="auth-heading">
          <span className="auth-mark">
            <LockKeyhole size={17} />
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close sign in"
          >
            <X size={18} />
          </button>
        </div>
        <p className="eyebrow">WORKFINDER ACCOUNT</p>
        <h2 id="auth-title">
          {mode === "signin"
            ? "Sign in to your agent"
            : mode === "signup"
              ? "Create your account"
              : "Reset your password"}
        </h2>

        {!configured ? (
          <p className="auth-notice" role="alert">
            Firebase Auth and App Check are not configured for this deployment.
          </p>
        ) : (
          <>
            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="field-label">
                Email
                <input
                  autoComplete="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                  required
                />
              </label>
              {mode !== "reset" && (
                <label className="field-label">
                  Password
                  <input
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>
              )}
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="auth-notice" role="status">
                  {message}
                </p>
              )}
              <button
                className="apply-button auth-submit"
                type="submit"
                disabled={pending}
              >
                {pending ? (
                  <LoaderCircle className="auth-spinner" size={15} />
                ) : null}
                {mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset link"}
              </button>
            </form>
            <div className="auth-alternatives">
              {mode === "signin" ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("reset");
                      setError("");
                      setMessage("");
                    }}
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setError("");
                      setMessage("");
                    }}
                  >
                    Create account
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setError("");
                    setMessage("");
                  }}
                >
                  <ArrowLeft size={13} /> Back to sign in
                </button>
              )}
            </div>
            <p className="auth-disclosure">
              Email verification is required. Agent requests are protected by a
              Firebase session and App Check.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
