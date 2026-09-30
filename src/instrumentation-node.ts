import type { Attributes, Context, Link, SpanKind } from "@opentelemetry/api";
import { registerOTel } from "@vercel/otel";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  SamplingDecision,
  type Sampler,
} from "@opentelemetry/sdk-trace-base";
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

const parentBasedSampler = new ParentBasedSampler({
  root: new AlwaysOnSampler(),
});

const querySafeSampler: Sampler = {
  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ) {
    const queryString = attributes["url.query"] ?? attributes["http.query"];
    const targetHasQuery = [
      attributes["http.target"],
      attributes["http.url"],
      attributes["url.full"],
    ].some((value) => typeof value === "string" && value.includes("?"));
    if (
      targetHasQuery ||
      (typeof queryString === "string" && queryString.length > 0)
    ) {
      return { decision: SamplingDecision.NOT_RECORD };
    }

    return parentBasedSampler.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links,
    );
  },
  toString: () => "workfinder-query-safe-parent-based",
};

const logsConfigured = Boolean(
  process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
);
const logRecordProcessor = logsConfigured
  ? new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })
  : new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() });

const metricsConfigured = Boolean(
  process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
);
const metricReaders = metricsConfigured
  ? [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 30_000,
      }),
    ]
  : [];

registerOTel({
  serviceName: "workfinder",
  attributes: {
    "deployment.environment.name": process.env.NODE_ENV ?? "production",
  },
  traceSampler: querySafeSampler,
  logRecordProcessors: [logRecordProcessor],
  metricReaders,
});
