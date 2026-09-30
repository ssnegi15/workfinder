"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "@firebase/auth";
import {
  firebaseClientConfigured,
  getFirebaseClient,
  getLimitedAppCheckToken,
} from "@/lib/firebase/client";

export interface SessionUser {
  uid: string;
  email: string;
}

interface FirebaseSessionValue {
  user: SessionUser | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const FirebaseSessionContext = createContext<FirebaseSessionValue | null>(null);

function safeAuthError(
  error: unknown,
  operation: "signin" | "signup" | "reset",
): Error {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (
    operation === "signin" &&
    [
      "auth/invalid-credential",
      "auth/user-not-found",
      "auth/wrong-password",
    ].includes(code)
  ) {
    return new Error("Email or password is incorrect.");
  }
  if (operation === "signup" && code === "auth/email-already-in-use") {
    return new Error("Could not create an account with those details.");
  }
  if (code === "auth/too-many-requests") {
    return new Error("Too many attempts. Wait a while before trying again.");
  }
  if (code === "auth/weak-password") {
    return new Error("Choose a stronger password.");
  }
  if (code === "auth/invalid-email") {
    return new Error("Enter a valid email address.");
  }
  if (error instanceof Error && !code) return error;
  return new Error(
    "Authentication could not be completed. Check your details and try again.",
  );
}

async function requestSessionExchange(idToken: string): Promise<SessionUser> {
  const appCheckToken = await getLimitedAppCheckToken();
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "X-Firebase-AppCheck": appCheckToken,
    },
  });
  const result = (await response.json()) as {
    user?: SessionUser;
    error?: string;
  };
  if (!response.ok || !result.user) {
    throw new Error(result.error ?? "Could not establish a secure session.");
  }
  return result.user;
}

export function FirebaseSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = firebaseClientConfigured();

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const result = (await response.json()) as { user?: SessionUser | null };
        return result.user ?? null;
      })
      .catch(() => null)
      .then((sessionUser) => {
        if (active) setUser(sessionUser);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { auth } = getFirebaseClient();
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      try {
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          throw new Error(
            "Verify your email first. We sent you a fresh verification link.",
          );
        }
        const sessionUser = await requestSessionExchange(
          await credential.user.getIdToken(true),
        );
        setUser(sessionUser);
      } finally {
        await signOut(auth);
      }
    } catch (error) {
      throw safeAuthError(error, "signin");
    }
  }

  async function signUp(email: string, password: string) {
    const { auth } = getFirebaseClient();
    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      try {
        await sendEmailVerification(credential.user);
      } finally {
        await signOut(auth);
      }
    } catch (error) {
      throw safeAuthError(error, "signup");
    }
  }

  async function resetPassword(email: string) {
    const { auth } = getFirebaseClient();
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code === "auth/user-not-found") return;
      throw safeAuthError(error, "reset");
    }
  }

  async function signOutSession() {
    try {
      await fetch("/api/auth/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
    } finally {
      setUser(null);
    }
  }

  return (
    <FirebaseSessionContext.Provider
      value={{
        user,
        loading,
        configured,
        signIn,
        signUp,
        resetPassword,
        signOut: signOutSession,
      }}
    >
      {children}
    </FirebaseSessionContext.Provider>
  );
}

export function useFirebaseSession(): FirebaseSessionValue {
  const value = useContext(FirebaseSessionContext);
  if (!value) {
    throw new Error(
      "useFirebaseSession must be used within FirebaseSessionProvider.",
    );
  }
  return value;
}
