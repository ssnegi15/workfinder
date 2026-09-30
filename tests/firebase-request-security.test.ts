import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiSecurityError,
  consumeAppCheckHeader,
  getSessionCookie,
  isAllowedOrigin,
  sessionCookieName,
  sessionCookieOptions,
  verifyAgentIdentity,
} from "../src/lib/firebase/request-security";

test("origin policy requires an exact origin match", () => {
  const valid = new Request("https://workfinder.example/api/agent", {
    headers: { origin: "https://workfinder.example" },
  });
  const invalid = new Request("https://workfinder.example/api/agent", {
    headers: { origin: "https://workfinder.example.attacker.test" },
  });
  const missing = new Request("https://workfinder.example/api/agent");

  assert.equal(isAllowedOrigin(valid), true);
  assert.equal(isAllowedOrigin(invalid), false);
  assert.equal(isAllowedOrigin(missing), false);
});

test("session cookie parsing matches the complete cookie name", () => {
  const request = new Request("http://localhost:3000", {
    headers: {
      cookie:
        "other=1; workfinder_session=verified.jwt.token; workfinder_session_old=bad",
    },
  });
  assert.equal(getSessionCookie(request), "verified.jwt.token");
  assert.equal(sessionCookieName(), "workfinder_session");
});

test("production sessions use host-only secure HttpOnly cookies", () => {
  assert.equal(sessionCookieName("production"), "__Host-workfinder_session");
  assert.deepEqual(sessionCookieOptions("production"), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 432000,
  });
});

test("agent identity requires verified email before App Check verification", async () => {
  const request = new Request("https://workfinder.example/api/agent", {
    headers: {
      cookie: `${sessionCookieName()}=session.jwt`,
      "x-firebase-appcheck": "limited-use-token",
    },
  });
  let appCheckCalls = 0;
  await assert.rejects(
    verifyAgentIdentity(
      request,
      async () => ({
        uid: "user-1",
        email: "user@example.test",
        email_verified: false,
      }),
      async () => {
        appCheckCalls += 1;
      },
    ),
    (error: unknown) =>
      error instanceof ApiSecurityError && error.status === 403,
  );
  assert.equal(appCheckCalls, 0);
});

test("verified email identity still requires successful App Check", async () => {
  const request = new Request("https://workfinder.example/api/agent", {
    headers: {
      cookie: `${sessionCookieName()}=session.jwt`,
      "x-firebase-appcheck": "fresh-token",
    },
  });
  let checkedToken = "";
  const user = await verifyAgentIdentity(
    request,
    async () => ({
      uid: "user-1",
      email: "user@example.test",
      email_verified: true,
    }),
    async (appCheckRequest) => {
      checkedToken = appCheckRequest.headers.get("x-firebase-appcheck") ?? "";
    },
  );
  assert.deepEqual(user, { uid: "user-1", email: "user@example.test" });
  assert.equal(checkedToken, "fresh-token");
});

test("App Check policy consumes a fresh token and rejects token replay", async () => {
  const request = new Request("https://workfinder.example/api/agent", {
    headers: { "x-firebase-appcheck": "one-use-token" },
  });
  let verifiedToken = "";
  await consumeAppCheckHeader(request, async (token) => {
    verifiedToken = token;
    return false;
  });
  assert.equal(verifiedToken, "one-use-token");

  await assert.rejects(
    consumeAppCheckHeader(request, async () => true),
    (error: unknown) =>
      error instanceof ApiSecurityError && error.status === 403,
  );
});
