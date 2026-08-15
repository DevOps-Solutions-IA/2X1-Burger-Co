export const POLLING_INTERVAL = {
  critical: 15_000,
  operational: 30_000,
  reference: 60_000,
} as const;

export function visiblePolling(intervalMs: number) {
  return () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return false as const;
    }

    return intervalMs;
  };
}
