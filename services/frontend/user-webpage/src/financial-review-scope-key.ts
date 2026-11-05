/** Keep marketplace and amount-unit navigation independent, including an automatic unit. */
export function reviewPeriodKey(month: string, marketplace: string, currency: string): string {
  return JSON.stringify([month, marketplace, currency]);
}
