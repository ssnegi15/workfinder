export class ApiSecurityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiSecurityError";
  }
}

export interface VerifiedIdentity {
  uid: string;
  email?: string;
  email_verified?: boolean;
}

export function isAllowedOrigin(request: Request): boolean {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) return false;

  try {
    const expectedOrigin = process.env.WORKFINDER_ALLOWED_ORIGIN
      ? new URL(process.env.WORKFINDER_ALLOWED_ORIGIN).origin
      : new URL(request.url).origin;
    return new URL(requestOrigin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function sessionCookieName(environment = process.env.NODE_ENV): string {
  return environment === "production"
    ? "__Host-workfinder_session"
    : "workfinder_session";
}

export function sessionCookieOptions(environment = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    secure: environment === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 5,
  };
}

export function getSessionCookie(request: Request): string | null {
  const prefix = `${sessionCookieName()}=`;
  const entry = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix));
  return entry ? entry.slice(prefix.length) || null : null;
}

export async function verifyAgentIdentity(
  request: Request,
  verifySession: (session: string) => Promise<VerifiedIdentity>,
  verifyAppCheck: (request: Request) => Promise<void>,
): Promise<{ uid: string; email: string }> {
  const session = getSessionCookie(request);
  if (!session)
    throw new ApiSecurityError("Sign in to use the career agent.", 401);

  const decoded = await verifySession(session);
  if (decoded.email_verified !== true || !decoded.email) {
    throw new ApiSecurityError(
      "Verify your email before using the career agent.",
      403,
    );
  }

  await verifyAppCheck(request);
  return { uid: decoded.uid, email: decoded.email };
}

export async function consumeAppCheckHeader(
  request: Request,
  verifyToken: (token: string) => Promise<boolean>,
): Promise<void> {
  const token = request.headers.get("x-firebase-appcheck");
  if (!token) throw new ApiSecurityError("App Check is required.", 403);
  if (await verifyToken(token)) {
    throw new ApiSecurityError("App Check token has already been used.", 403);
  }
}
