export function quoteTotal(values: string[]): number | null {
  if (values.length !== 3 || values.some(value => !/^\d+(?:\.\d{1,2})?$/.test(value.trim()))) return null;
  const cents = values.map(value => Math.round(Number(value) * 100));
  const total = cents.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total / 100 : null;
}
