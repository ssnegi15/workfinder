import { cookies } from "next/headers";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import {
  reserveSessionExchange,
  SessionExchangeLimitError,
} from "@/lib/firebase/auth-limits";
import {
  ApiSecurityError,
  getSessionCookie,
  isAllowedOrigin,
  sessionCookieName,
  sessionCookieOptions,
  verifyLimitedAppCheckToken,
  verifySessionCookie,
} from "@/lib/firebase/security";
import { withRequestTelemetry } from "@/lib/request-telemetry";

export const runtime = "nodejs";

const sessionLifetimeMs = 5 * 24 * 60 * 60 * 1000;
const privateHeaders = { "cache-control": "private, no-store" };

async function getSession(request: Request): Promise<Response> {
  const session = getSessionCookie(request);
  if (!session)
    return Response.json({ user: null }, { headers: privateHeaders });

  try {
    const decoded = await verifySessionCookie(session);
    if (!decoded.email || decoded.email_verified !== true) {
      return Response.json({ user: null }, { headers: privateHeaders });
    }
    return Response.json(
      { user: { uid: decoded.uid, email: decoded.email } },
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof SessionExchangeLimitError) {
      return Response.json(
        { error: "Too many sign-in sessions. Try again shortly." },
        {
          status: 429,
          headers: {
            ...privateHeaders,
            "retry-after": String(error.retryAfterSeconds),
          },
        },
      );
    }
    if (error instanceof ApiSecurityError) {
      return Response.json({ user: null }, { headers: privateHeaders });
    }
    return Response.json(
      { error: "Authentication service unavailable." },
      { status: 503, headers: privateHeaders },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return withRequestTelemetry(request, "/api/auth/session", () =>
    getSession(request),
  );
}

async function createSession(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403, headers: privateHeaders },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const idToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!idToken || idToken.length > 10_000) {
    return Response.json(
      { error: "Sign in is required." },
      { status: 401, headers: privateHeaders },
    );
  }

  try {
    await verifyLimitedAppCheckToken(request);
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(idToken, true);
    if (!decoded.email || decoded.email_verified !== true) {
      return Response.json(
        { error: "Verify your email before starting a session." },
        { status: 403, headers: privateHeaders },
      );
    }

    await reserveSessionExchange(decoded.uid);

    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: sessionLifetimeMs,
    });
    const cookieStore = await cookies();
    cookieStore.set(sessionCookieName(), sessionCookie, sessionCookieOptions());
    return Response.json(
      {
        user: { uid: decoded.uid, email: decoded.email },
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof ApiSecurityError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: privateHeaders },
      );
    }
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    return Response.json(
      { error: "Could not establish a secure session." },
      { status: code.startsWith("auth/") ? 401 : 503, headers: privateHeaders },
    );
  }
}

export function POST(request: Request): Promise<Response> {
  return withRequestTelemetry(request, "/api/auth/session", () =>
    createSession(request),
  );
}

async function deleteSession(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403, headers: privateHeaders },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return Response.json({ signedOut: true }, { headers: privateHeaders });
}

export function DELETE(request: Request): Promise<Response> {
  return withRequestTelemetry(request, "/api/auth/session", () =>
    deleteSession(request),
  );
}
