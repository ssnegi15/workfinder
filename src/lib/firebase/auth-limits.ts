import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "@/lib/firebase/admin";

export class SessionExchangeLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many session requests.");
    this.name = "SessionExchangeLimitError";
  }
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.max(1, Math.min(Number(value), 1000));
}

export async function reserveSessionExchange(
  uid: string,
  now = Date.now(),
): Promise<void> {
  const minuteKey = Math.floor(now / 60_000);
  const minuteLimit = parseLimit(
    process.env.WORKFINDER_SESSION_EXCHANGE_PER_MINUTE_LIMIT,
    6,
  );
  const { firestore } = getFirebaseAdmin();
  const reference = firestore.collection("authLimits").doc(uid);

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() ?? {};
    const count = data.minuteKey === minuteKey ? (data.minuteRequests ?? 0) : 0;
    if (count >= minuteLimit) {
      throw new SessionExchangeLimitError(
        Math.max(1, Math.ceil(((minuteKey + 1) * 60_000 - now) / 1000)),
      );
    }
    transaction.set(reference, {
      minuteKey,
      minuteRequests: count + 1,
      updatedAt: Timestamp.fromMillis(now),
    });
  });
}
