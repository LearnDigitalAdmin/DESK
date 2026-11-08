export const COMPLIANCE_REPORT_TYPES = [
  { id: "mri_monthly", title: "MRI working paper", blurb: "The month's rent received, agent commission, final rental income, the 7.5% MRI and the KES 288,000 band test, ready to file on iTax by the 20th." },
  { id: "annual_summary", title: "Annual rental income summary", blurb: "Month by month for the year to date, with the annual band test and totals." },
] as const;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const reportMonthLabel = (m: string): string => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;

/** Nairobi calendar month `offset` months back from now (0 = this month). */
export function monthsBack(offset: number, now = new Date()): string {
  const t = new Date(now.getTime() + 3 * 3_600_000);
  let y = t.getUTCFullYear(), m = t.getUTCMonth() + 1 - offset;
  while (m <= 0) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
/** The month whose MRI is due on the 20th of the current month. */
export const defaultReportMonth = (now = new Date()): string => monthsBack(1, now);
export const recentMonths = (count: number, now = new Date()): string[] => Array.from({ length: count }, (_, i) => monthsBack(i, now));
