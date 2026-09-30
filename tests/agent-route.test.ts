import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  AgentQuotaError,
  handleAgentPost,
  type AgentRequestDependencies,
} from "../src/lib/agent-api";
import { runCareerAgent } from "../src/lib/agent";

const sameOrigin = "http://localhost:3000";

function makeRequest(
  body: string,
  origin = sameOrigin,
  contentType = "application/json",
) {
  return new Request(`${sameOrigin}/api/agent`, {
    method: "POST",
    headers: { origin, "content-type": contentType },
    body,
  });
}

const testDependencies: AgentRequestDependencies = {
  authenticate: async () => ({ uid: "test-user", email: "user@example.test" }),
  reserve: async () => ({ dayKey: "2026-10-01", reservedTokens: 12_000 }),
  record: async () => {},
  run: runCareerAgent,
  isAllowedOrigin: (request) =>
    request.headers.get("origin") === new URL(request.url).origin,
};

test("agent API rejects cross-origin requests before model access", async () => {
  const response = await handleAgentPost(
    makeRequest("{}", "https://untrusted.example"),
    testDependencies,
  );
  assert.equal(response.status, 403);
});

test("agent API enforces JSON and request-size limits", async () => {
  const contentTypeResponse = await handleAgentPost(
    makeRequest("{}", sameOrigin, "text/plain"),
    testDependencies,
  );
  assert.equal(contentTypeResponse.status, 415);

  const sizeResponse = await handleAgentPost(
    makeRequest(JSON.stringify({ message: "x".repeat(17_000) })),
    testDependencies,
  );
  assert.equal(sizeResponse.status, 413);
});

test("agent API rejects unauthenticated and rate-limited callers before inference", async () => {
  let modelCalls = 0;
  const noSession = await handleAgentPost(
    makeRequest(JSON.stringify({ message: "hello" })),
    {
      ...testDependencies,
      authenticate: async () => {
        throw Object.assign(new Error("Sign in is required."), { status: 401 });
      },
      run: async (...args) => {
        modelCalls += 1;
        return runCareerAgent(...args);
      },
    },
  );
  assert.equal(noSession.status, 401);

  const overQuota = await handleAgentPost(
    makeRequest(JSON.stringify({ message: "hello" })),
    {
      ...testDependencies,
      reserve: async () => {
        throw new AgentQuotaError(37);
      },
      run: async (...args) => {
        modelCalls += 1;
        return runCareerAgent(...args);
      },
    },
  );
  assert.equal(overQuota.status, 429);
  assert.equal(overQuota.headers.get("retry-after"), "37");
  assert.equal(modelCalls, 0);
});

test("agent API uses a configured OpenAI-compatible endpoint without exposing its key", async () => {
  let receivedAuthorization = "";
  const fakeModel = createServer((request, response) => {
    receivedAuthorization = request.headers.authorization ?? "";
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "completion-test",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "Here is your private career briefing.",
              },
              logprobs: null,
            },
          ],
        }),
      );
    });
  });

  await new Promise<void>((resolve) =>
    fakeModel.listen(0, "127.0.0.1", resolve),
  );
  const address = fakeModel.address();
  assert.ok(address && typeof address === "object");

  const previousBase = process.env.WORKFINDER_LLM_BASE_URL;
  const previousKey = process.env.WORKFINDER_LLM_API_KEY;
  const previousModel = process.env.WORKFINDER_LLM_MODEL;
  process.env.WORKFINDER_LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.WORKFINDER_LLM_API_KEY = "server-only-test-key";
  process.env.WORKFINDER_LLM_MODEL = "test-model";

  try {
    const response = await handleAgentPost(
      makeRequest(
        JSON.stringify({
          message: "Create a briefing",
          preferences: {
            roles: "Staff Engineer",
            location: "Remote",
            skills: "Distributed systems",
          },
          savedJobIds: [],
          feedback: [],
          conversation: [],
        }),
      ),
      testDependencies,
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      answer: string;
      usage: { completionCalls: number; totalTokens: number };
    };
    assert.equal(result.answer, "Here is your private career briefing.");
    assert.equal(result.usage.completionCalls, 1);
    assert.equal(result.usage.totalTokens, 0);
    assert.equal(receivedAuthorization, "Bearer server-only-test-key");
  } finally {
    if (previousBase === undefined) delete process.env.WORKFINDER_LLM_BASE_URL;
    else process.env.WORKFINDER_LLM_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.WORKFINDER_LLM_API_KEY;
    else process.env.WORKFINDER_LLM_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.WORKFINDER_LLM_MODEL;
    else process.env.WORKFINDER_LLM_MODEL = previousModel;
    await new Promise<void>((resolve, reject) => {
      fakeModel.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
