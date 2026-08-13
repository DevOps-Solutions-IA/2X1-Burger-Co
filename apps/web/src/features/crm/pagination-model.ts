export function clampCrmPage(page: number, pages: number) {
  return Math.min(Math.max(Math.trunc(page) || 1, 1), Math.max(Math.trunc(pages), 1));
}
