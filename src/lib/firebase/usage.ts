import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "@/lib/firebase/admin";
import type { AgentRunUsage } from "@/lib/agent";
import { decideAgentQuota, type QuotaSettings } from "@/lib/firebase/quota";
import { AgentQuotaError, type AgentReservation } from "@/lib/agent-api";

const defaultPerMinuteLimit = 6;
const defaultDailyRequestLimit = 40;
const defaultDailyTokenLimit = 180_000;
const defaultTokenReservation = 32_000;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.max(1, Math.min(Number(value), 10_000_000));
}

function dayKeyFor(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export async function reserveAgentRequest(
  uid: string,
  now = Date.now(),
): Promise<AgentReservation> {
  const { firestore } = getFirebaseAdmin();
  const limits = firestore.collection("agentLimits").doc(uid);
  const dayKey = dayKeyFor(now);
  const usage = firestore
    .collection("agentUsage")
    .doc(uid)
    .collection("days")
    .doc(dayKey);
  const globalLimits = firestore.collection("agentGlobalLimits").doc("shared");
  const globalUsage = firestore
    .collection("agentGlobalUsage")
    .doc("shared")
    .collection("days")
    .doc(dayKey);
  const settings: QuotaSettings = {
    perMinuteLimit: positiveInteger(
      process.env.WORKFINDER_AGENT_PER_MINUTE_LIMIT,
      defaultPerMinuteLimit,
    ),
    dailyRequestLimit: positiveInteger(
      process.env.WORKFINDER_AGENT_DAILY_REQUEST_LIMIT,
      defaultDailyRequestLimit,
    ),
    dailyTokenLimit: positiveInteger(
      process.env.WORKFINDER_AGENT_DAILY_TOKEN_LIMIT,
      defaultDailyTokenLimit,
    ),
    tokenReservation: positiveInteger(
      process.env.WORKFINDER_AGENT_TOKEN_RESERVATION,
      defaultTokenReservation,
    ),
  };
  const globalSettings: QuotaSettings = {
    perMinuteLimit: positiveInteger(
      process.env.WORKFINDER_AGENT_GLOBAL_PER_MINUTE_LIMIT,
      120,
    ),
    dailyRequestLimit: positiveInteger(
      process.env.WORKFINDER_AGENT_GLOBAL_DAILY_REQUEST_LIMIT,
      200,
    ),
    dailyTokenLimit: positiveInteger(
      process.env.WORKFINDER_AGENT_GLOBAL_DAILY_TOKEN_LIMIT,
      1_000_000,
    ),
    tokenReservation: settings.tokenReservation,
  };

  return firestore.runTransaction(async (transaction) => {
    const [
      limitSnapshot,
      usageSnapshot,
      globalLimitSnapshot,
      globalUsageSnapshot,
    ] = await Promise.all([
      transaction.get(limits),
      transaction.get(usage),
      transaction.get(globalLimits),
      transaction.get(globalUsage),
    ]);
    const limitData = limitSnapshot.data() ?? {};
    const usageData = usageSnapshot.data() ?? {};
    const decision = decideAgentQuota(limitData, usageData, now, settings);
    if (!decision.allowed) {
      throw new AgentQuotaError(decision.retryAfterSeconds ?? 60);
    }
    const globalDecision = decideAgentQuota(
      globalLimitSnapshot.data() ?? {},
      globalUsageSnapshot.data() ?? {},
      now,
      globalSettings,
    );
    if (!globalDecision.allowed) {
      throw new AgentQuotaError(globalDecision.retryAfterSeconds ?? 60);
    }

    transaction.set(limits, {
      minuteKey: decision.minuteKey,
      minuteRequests: decision.minuteRequests,
      dayKey: decision.dayKey,
      dailyRequests: decision.dailyRequests,
      updatedAt: Timestamp.fromMillis(now),
    });
    transaction.set(
      usage,
      {
        reservedTokens: decision.reservedTokens,
        expiresAt: Timestamp.fromMillis(now + 90 * 24 * 60 * 60 * 1000),
      },
      { merge: true },
    );
    transaction.set(globalLimits, {
      minuteKey: globalDecision.minuteKey,
      minuteRequests: globalDecision.minuteRequests,
      dayKey: globalDecision.dayKey,
      dailyRequests: globalDecision.dailyRequests,
      updatedAt: Timestamp.fromMillis(now),
    });
    transaction.set(
      globalUsage,
      {
        reservedTokens: globalDecision.reservedTokens,
        expiresAt: Timestamp.fromMillis(now + 90 * 24 * 60 * 60 * 1000),
      },
      { merge: true },
    );
    return {
      dayKey: decision.dayKey,
      reservedTokens: settings.tokenReservation,
    };
  });
}

export async function recordAgentUsage(
  uid: string,
  reservation: AgentReservation,
  usage: AgentRunUsage,
  durationMs: number,
  succeeded: boolean,
): Promise<void> {
  const { firestore } = getFirebaseAdmin();
  const usageDocument = firestore
    .collection("agentUsage")
    .doc(uid)
    .collection("days")
    .doc(reservation.dayKey);
  const globalUsageDocument = firestore
    .collection("agentGlobalUsage")
    .doc("shared")
    .collection("days")
    .doc(reservation.dayKey);

  await firestore.runTransaction(async (transaction) => {
    const [usageSnapshot, globalUsageSnapshot] = await Promise.all([
      transaction.get(usageDocument),
      transaction.get(globalUsageDocument),
    ]);
    const currentUsage = usageSnapshot.data() ?? {};
    const currentReserved = currentUsage.reservedTokens ?? 0;
    const currentGlobalUsage = globalUsageSnapshot.data() ?? {};
    const currentGlobalReserved = currentGlobalUsage.reservedTokens ?? 0;
    const meteredTokens =
      usage.reportedUsageCalls === usage.completionCalls && succeeded
        ? usage.totalTokens
        : reservation.reservedTokens;

    transaction.set(
      usageDocument,
      {
        reservedTokens: Math.max(
          0,
          currentReserved - reservation.reservedTokens,
        ),
        inputTokens: FieldValue.increment(usage.inputTokens),
        outputTokens: FieldValue.increment(usage.outputTokens),
        totalTokens: FieldValue.increment(usage.totalTokens),
        quotaTokens: FieldValue.increment(meteredTokens),
        completionCalls: FieldValue.increment(usage.completionCalls),
        reportedUsageCalls: FieldValue.increment(usage.reportedUsageCalls),
        toolCalls: FieldValue.increment(usage.toolCalls),
        requests: FieldValue.increment(1),
        failedRequests: FieldValue.increment(succeeded ? 0 : 1),
        durationMs: FieldValue.increment(Math.max(0, Math.floor(durationMs))),
        model: usage.model.slice(0, 120),
        lastUpdatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
      { merge: true },
    );
    transaction.set(
      globalUsageDocument,
      {
        reservedTokens: Math.max(
          0,
          currentGlobalReserved - reservation.reservedTokens,
        ),
        quotaTokens: FieldValue.increment(meteredTokens),
        inputTokens: FieldValue.increment(usage.inputTokens),
        outputTokens: FieldValue.increment(usage.outputTokens),
        totalTokens: FieldValue.increment(usage.totalTokens),
        requests: FieldValue.increment(1),
        failedRequests: FieldValue.increment(succeeded ? 0 : 1),
        expiresAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
      { merge: true },
    );
  });
}
