export const WAITER_CATALOG_PAGE_SIZE = 12;

export function getCatalogWindow<T>(items: readonly T[], visibleCount: number) {
  const boundedCount = Math.max(WAITER_CATALOG_PAGE_SIZE, visibleCount);
  return {
    items: items.slice(0, boundedCount),
    hasMore: boundedCount < items.length,
    nextVisibleCount: Math.min(boundedCount + WAITER_CATALOG_PAGE_SIZE, items.length),
  };
}
