/** A cast net stays deployed for this many seconds (12 hours) before it yields fish. */
export const NET_DURATION_SECONDS = 43_200;

/** How often the readiness notifier polls for nets that became ready unannounced. */
export const NET_READY_POLL_INTERVAL_MS = 60_000;

/**
 * Rarity distribution of net catches. Weights total 100 and intentionally favor
 * common fish harder than ordinary `/fish` rolls: every tier 2-6 is less likely.
 */
export const NET_RARITY_WEIGHTS: Readonly<Record<number, number>> = {
  1: 85,
  2: 12,
  3: 2,
  4: 0.7,
  5: 0.25,
  6: 0.05,
};
