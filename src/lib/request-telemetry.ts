import "server-only";

import { randomUUID } from "node:crypto";
import { context, metrics } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type TelemetryRoute = "/api/agent" | "/api/auth/session";

const meter = metrics.getMeter("workfinder.http");
const requestCount = meter.createCounter("workfinder.http.server.requests", {
  description: "HTTP requests handled by Workfinder API routes",
  unit: "{request}",
});
const requestDuration = meter.createHistogram(
  "workfinder.http.server.duration",
  {
    description: "Duration of Workfinder API requests",
    unit: "ms",
  },
);
const requestLogger = logs.getLogger("workfinder.http");

const knownMethods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

function safeMethod(method: string): string {
  return knownMethods.has(method) ? method : "OTHER";
}

export async function withRequestTelemetry(
  request: Request,
  route: TelemetryRoute,
  handler: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const startedAt = performance.now();
  const requestId = randomUUID();
  let statusCode = 500;

  try {
    const response = await handler(requestId);
    statusCode = response.status;
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    statusCode = 500;
    throw error;
  } finally {
    const durationMs = Math.max(0, performance.now() - startedAt);
    const method = safeMethod(request.method);
    const metricAttributes = {
      "http.request.method": method,
      "http.route": route,
      "http.response.status_code": statusCode,
    };

    requestCount.add(1, metricAttributes);
    requestDuration.record(durationMs, metricAttributes);
    requestLogger.emit({
      context: context.active(),
      eventName: "http.server.request",
      severityNumber:
        statusCode >= 500
          ? SeverityNumber.ERROR
          : statusCode >= 400
            ? SeverityNumber.WARN
            : SeverityNumber.INFO,
      severityText:
        statusCode >= 500 ? "ERROR" : statusCode >= 400 ? "WARN" : "INFO",
      body:
        statusCode >= 500 ? "HTTP request failed" : "HTTP request completed",
      attributes: {
        ...metricAttributes,
        duration_ms: Math.round(durationMs),
        request_id: requestId,
      },
    });
  }
}
