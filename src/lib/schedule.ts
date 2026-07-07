export const SYNC_INTERVALS = ["manual", "hourly", "daily", "weekly"] as const;
export type SyncInterval = (typeof SYNC_INTERVALS)[number];

const INTERVAL_MS: Record<Exclude<SyncInterval, "manual">, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function isSyncInterval(value: string): value is SyncInterval {
  return (SYNC_INTERVALS as readonly string[]).includes(value);
}

/** When the next scheduled sync should run, or null for manual-only sources. */
export function nextSyncAt(interval: string, from: Date = new Date()): Date | null {
  if (!isSyncInterval(interval) || interval === "manual") return null;
  return new Date(from.getTime() + INTERVAL_MS[interval]);
}
