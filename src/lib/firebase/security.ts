import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import {
  ApiSecurityError,
  consumeAppCheckHeader,
  verifyAgentIdentity,
} from "@/lib/firebase/request-security";

export {
  ApiSecurityError,
  getSessionCookie,
  isAllowedOrigin,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/firebase/request-security";

export interface VerifiedUser {
  uid: string;
  email: string;
}

export async function verifyLimitedAppCheckToken(
  request: Request,
): Promise<void> {
  const appCheck = getFirebaseAdmin().appCheck;
  try {
    await consumeAppCheckHeader(request, async (token) => {
      const result = await appCheck.verifyToken(token, { consume: true });
      return result.alreadyConsumed === true;
    });
  } catch (error) {
    if (error instanceof ApiSecurityError) throw error;
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code.startsWith("app-check/")) {
      throw new ApiSecurityError("App Check verification failed.", 403);
    }
    throw error;
  }
}

export async function verifySessionCookie(
  token: string,
): Promise<DecodedIdToken> {
  const auth = getFirebaseAdmin().auth;
  try {
    return await auth.verifySessionCookie(token, true);
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code.startsWith("auth/")) {
      throw new ApiSecurityError("A valid session is required.", 401);
    }
    throw error;
  }
}

export async function requireAgentUser(
  request: Request,
): Promise<VerifiedUser> {
  return verifyAgentIdentity(
    request,
    verifySessionCookie,
    verifyLimitedAppCheckToken,
  );
}
