export function getDayRange(input?: string) {
  const base = input ? new Date(`${input}T00:00:00.000Z`) : new Date();
  const start = new Date(base);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}

export function getRange(from?: string, to?: string) {
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date('2000-01-01T00:00:00.000Z');
  const endBase = to ? new Date(`${to}T00:00:00.000Z`) : new Date();
  const end = new Date(endBase);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}
