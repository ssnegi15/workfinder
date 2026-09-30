export interface QuotaSettings {
  perMinuteLimit: number;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  tokenReservation: number;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dayKeyFor(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function decideAgentQuota(
  limitData: Record<string, unknown>,
  usageData: Record<string, unknown>,
  now: number,
  settings: QuotaSettings,
) {
  const minuteKey = Math.floor(now / 60_000);
  const dayKey = dayKeyFor(now);
  const minuteRequests =
    limitData.minuteKey === minuteKey
      ? numberOrZero(limitData.minuteRequests)
      : 0;
  const dailyRequests =
    limitData.dayKey === dayKey ? numberOrZero(limitData.dailyRequests) : 0;
  const tokensUsed = numberOrZero(
    usageData.quotaTokens ?? usageData.totalTokens,
  );
  const tokensReserved = numberOrZero(usageData.reservedTokens);

  if (minuteRequests >= settings.perMinuteLimit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(((minuteKey + 1) * 60_000 - now) / 1000),
      ),
      minuteKey,
      minuteRequests,
      dayKey,
      dailyRequests,
      reservedTokens: tokensReserved,
    };
  }

  if (
    dailyRequests >= settings.dailyRequestLimit ||
    tokensUsed + tokensReserved + settings.tokenReservation >
      settings.dailyTokenLimit
  ) {
    const date = new Date(now);
    const nextDay = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + 1,
    );
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((nextDay - now) / 1000)),
      minuteKey,
      minuteRequests,
      dayKey,
      dailyRequests,
      reservedTokens: tokensReserved,
    };
  }

  return {
    allowed: true,
    minuteKey,
    minuteRequests: minuteRequests + 1,
    dayKey,
    dailyRequests: dailyRequests + 1,
    reservedTokens: tokensReserved + settings.tokenReservation,
  };
}
