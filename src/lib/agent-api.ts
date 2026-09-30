import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  runCareerAgent,
  AgentRunFailure,
  type AgentContext,
  type AgentRunResult,
  type CareerSignal,
} from "@/lib/agent";
import type { CareerPreferences } from "@/lib/matching";

const maxBodyBytes = 8_000;

export interface AgentApiUser {
  uid: string;
  email: string;
}

export interface AgentReservation {
  dayKey: string;
  reservedTokens: number;
}

export class AgentQuotaError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Agent usage limit reached.");
    this.name = "AgentQuotaError";
  }
}

export interface AgentRequestDependencies {
  authenticate: (request: Request) => Promise<AgentApiUser>;
  reserve: (uid: string) => Promise<AgentReservation>;
  record: (
    uid: string,
    reservation: AgentReservation,
    result: AgentRunResult["usage"],
    durationMs: number,
    succeeded: boolean,
  ) => Promise<void>;
  run: typeof runCareerAgent;
  isAllowedOrigin: (request: Request) => boolean;
}

const emptyUsage = (model: string) => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  completionCalls: 0,
  reportedUsageCalls: 0,
  toolCalls: 0,
  model,
});

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > maxBodyBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseContext(payload: Record<string, unknown>): AgentContext {
  const rawPreferences = isRecord(payload.preferences)
    ? payload.preferences
    : {};
  const preferences: CareerPreferences = {
    roles: boundedString(rawPreferences.roles, 600),
    location: boundedString(rawPreferences.location, 240),
    skills: boundedString(rawPreferences.skills, 800),
    experience: boundedString(rawPreferences.experience, 160),
  };
  const savedJobIds = Array.isArray(payload.savedJobIds)
    ? payload.savedJobIds
        .filter((id): id is string => typeof id === "string")
        .slice(0, 20)
    : [];
  const feedback: CareerSignal[] = Array.isArray(payload.feedback)
    ? payload.feedback
        .filter(isRecord)
        .slice(0, 20)
        .flatMap((item) =>
          typeof item.jobId === "string" &&
          (item.signal === "relevant" || item.signal === "irrelevant")
            ? [{ jobId: item.jobId.slice(0, 160), signal: item.signal }]
            : [],
        )
    : [];

  return { preferences, savedJobIds, feedback };
}

function parseConversation(value: unknown): ChatCompletionMessageParam[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-4).flatMap((item) => {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant"))
      return [];
    const content = boundedString(item.content, 1000);
    return content ? [{ role: item.role, content }] : [];
  });
}

function modelConfiguration(): { client: OpenAI; model: string } | null {
  const baseURL =
    process.env.WORKFINDER_LLM_BASE_URL ?? "http://127.0.0.1:11434/v1";
  const model = boundedString(
    process.env.WORKFINDER_LLM_MODEL ?? "qwen3:8b",
    120,
  );

  try {
    const endpoint = new URL(baseURL);
    const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      endpoint.hostname,
    );
    if (
      !model ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol !== "https:" &&
        !(endpoint.protocol === "http:" && isLoopback))
    ) {
      return null;
    }

    return {
      client: new OpenAI({
        apiKey: process.env.WORKFINDER_LLM_API_KEY ?? "ollama",
        baseURL: endpoint.toString(),
        timeout: 30_000,
        maxRetries: 0,
      }),
      model,
    };
  } catch {
    return null;
  }
}

export async function handleAgentPost(
  request: Request,
  dependencies: AgentRequestDependencies,
): Promise<Response> {
  const requestId = randomUUID();
  if (!dependencies.isAllowedOrigin(request)) {
    return jsonResponse({ error: "Request origin is not allowed." }, 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return jsonResponse({ error: "Expected a JSON request." }, 415);
  }

  const rawBody = await readBoundedBody(request).catch(() => null);
  if (rawBody === null) {
    return jsonResponse({ error: "Request is too large or unreadable." }, 413);
  }

  let user: AgentApiUser;
  try {
    user = await dependencies.authenticate(request);
  } catch (error) {
    if (error instanceof AgentQuotaError) {
      return jsonResponse({ error: error.message }, 429, {
        "retry-after": String(error.retryAfterSeconds),
      });
    }
    const status =
      isRecord(error) && typeof error.status === "number" ? error.status : 503;
    const message =
      status === 401 || status === 403
        ? error instanceof Error
          ? error.message
          : "Authentication required."
        : "Authentication service unavailable.";
    return jsonResponse({ error: message }, status);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON request." }, 400);
  }
  if (!isRecord(payload)) {
    return jsonResponse({ error: "Invalid agent request." }, 400);
  }

  const prompt = boundedString(payload.message, 3000);
  if (!prompt) {
    return jsonResponse(
      { error: "Enter a question for the career agent." },
      400,
    );
  }
  const configuration = modelConfiguration();
  if (!configuration) {
    return jsonResponse(
      { error: "The configured model endpoint is invalid." },
      503,
    );
  }

  let reservation: AgentReservation;
  try {
    reservation = await dependencies.reserve(user.uid);
  } catch (error) {
    if (error instanceof AgentQuotaError) {
      return jsonResponse(
        { error: "Agent usage limit reached. Try again later." },
        429,
        { "retry-after": String(error.retryAfterSeconds) },
      );
    }
    return jsonResponse({ error: "Usage controls are unavailable." }, 503);
  }

  const startedAt = Date.now();
  try {
    const result = await dependencies.run(
      configuration.client,
      configuration.model,
      prompt,
      parseContext(payload),
      parseConversation(payload.conversation),
    );
    try {
      await dependencies.record(
        user.uid,
        reservation,
        result.usage,
        Date.now() - startedAt,
        true,
      );
    } catch {
      console.error(
        JSON.stringify({ event: "agent_usage_write_failed", requestId }),
      );
      return jsonResponse(
        {
          error: "Usage metering is unavailable. Please retry later.",
          requestId,
        },
        503,
      );
    }
    return jsonResponse({
      answer: result.answer,
      usage: result.usage,
      requestId,
    });
  } catch (error) {
    const failedUsage =
      error instanceof AgentRunFailure
        ? error.usage
        : emptyUsage(configuration.model);
    await dependencies
      .record(user.uid, reservation, failedUsage, Date.now() - startedAt, false)
      .catch(() => {
        console.error(
          JSON.stringify({
            event: "agent_failure_meter_write_failed",
            requestId,
          }),
        );
      });
    return jsonResponse(
      {
        error:
          "The career agent could not reach the configured model. Check that the endpoint and model are available.",
        requestId,
      },
      502,
    );
  }
}
