// Pure finance logic: no database, no HTTP. Mirrors the formulas in the FIRE spreadsheet.
import { createHash } from 'node:crypto';
export { parseAmount, parseCurrency, parseDate } from '../shared/parse.ts';

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'once';

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISO(s: string): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Add months, clamping the day (31 Jan + 1 month = 28/29 Feb). `anchorDay` keeps 31st bills on month ends. */
export function addMonths(iso: string, months: number, anchorDay?: number): string {
  const [y, m, d] = parseISO(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(ny, nm, 0).getDate();
  return fmt(ny, nm, Math.min(anchorDay ?? d, last));
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parseISO(iso);
  const dt = new Date(y, m - 1, d + days);
  return fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = parseISO(fromISO);
  const [ty, tm, td] = parseISO(toISO);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** The due date after `due` for a recurring bill; null for one-off bills. */
export function nextOccurrence(due: string, frequency: Frequency, anchorDay?: number): string | null {
  switch (frequency) {
    case 'weekly': return addDays(due, 7);
    case 'monthly': return addMonths(due, 1, anchorDay);
    case 'quarterly': return addMonths(due, 3, anchorDay);
    case 'yearly': return addMonths(due, 12, anchorDay);
    case 'once': return null;
  }
}

/** All due dates of a bill falling in [from, to], inclusive. Used for the calendar and cash-needed totals. */
export function occurrencesBetween(
  nextDue: string, frequency: Frequency, from: string, to: string, anchorDay?: number,
): string[] {
  const out: string[] = [];
  const anchor = anchorDay ?? parseISO(nextDue)[2];
  let cur: string | null = nextDue;
  for (let i = 0; cur && cur <= to && i < 1000; i++) {
    if (cur >= from) out.push(cur);
    cur = nextOccurrence(cur, frequency, anchor);
  }
  return out;
}

export type BillStatus = 'overdue' | 'due-soon' | 'upcoming';

export function billStatus(nextDue: string, today: string, soonDays = 7): BillStatus {
  if (nextDue < today) return 'overdue';
  return daysBetween(today, nextDue) <= soonDays ? 'due-soon' : 'upcoming';
}

// ---------------------------------------------------------------- FIRE (Dashboard / SWR sheets)

export interface FireInputs {
  yearlySpend: number;
  withdrawalRate: number;
  netWorth: number;
  investments: number;
  stockAllocation: number;
  stockGrowth: number;
  bondGrowth: number;
  currentAge: number;
  retirementAge: number;
}

export function blendedReturn(i: Pick<FireInputs, 'stockAllocation' | 'stockGrowth' | 'bondGrowth'>): number {
  return i.stockAllocation * i.stockGrowth + (1 - i.stockAllocation) * i.bondGrowth;
}

export function fireSummary(i: FireInputs) {
  const fiNumber = i.withdrawalRate > 0 ? i.yearlySpend / i.withdrawalRate : 0;
  const rate = blendedReturn(i);
  const yearsToRetire = Math.max(0, i.retirementAge - i.currentAge);
  // Coast FI: what you need invested today so growth alone reaches the FI number at retirement age.
  const coastFi = fiNumber / Math.pow(1 + rate, yearsToRetire);
  return {
    fiNumber,
    leanFi: fiNumber * 0.8,
    fatFi: fiNumber * 2,
    coastFi,
    returnRate: rate,
    percentToFi: fiNumber > 0 ? i.investments / fiNumber : 0,
    investedCoversYearly: i.investments * i.withdrawalRate,
    coastReached: i.investments >= coastFi,
  };
}

/** Investments' value after `years` of growth with a yearly contribution (spreadsheet: FV(rate, n, -contrib, -pv, 1)). */
export function futureValue(rate: number, years: number, yearlyContribution: number, present: number): number {
  let v = present;
  for (let y = 0; y < years; y++) v = (v + yearlyContribution) * (1 + rate);
  return v;
}

// ---------------------------------------------------------------- Mortgage (Amortization sheet)

export interface LoanInputs {
  principal: number;
  apr: number;
  years: number;
  extraMonthly: number;
}

export interface AmortRow {
  n: number;
  balanceStart: number;
  principalPaid: number;
  interestPaid: number;
  extra: number;
  balanceEnd: number;
}

export function monthlyPayment(principal: number, apr: number, years: number): number {
  const n = years * 12;
  const r = apr / 12;
  if (n <= 0) return 0;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export function amortize(loan: LoanInputs) {
  const n = loan.years * 12;
  const r = loan.apr / 12;
  const pmt = monthlyPayment(loan.principal, loan.apr, loan.years);
  const rows: AmortRow[] = [];
  let bal = loan.principal;
  let totalInterest = 0;
  for (let k = 1; k <= n && bal > 0.005; k++) {
    const interest = bal * r;
    let principalPaid = pmt - interest;
    let extra = Math.max(0, loan.extraMonthly);
    if (principalPaid + extra > bal) { principalPaid = Math.min(principalPaid, bal); extra = bal - principalPaid; }
    const end = Math.max(0, bal - principalPaid - extra);
    rows.push({ n: k, balanceStart: bal, principalPaid, interestPaid: interest, extra, balanceEnd: end });
    totalInterest += interest;
    bal = end;
  }
  return { monthlyPayment: pmt, totalInterest, payments: rows.length, rows };
}

/** How far through the schedule a loan started on `start` (YYYY-MM-DD) is, as of `today`. */
export function paymentsMade(start: string, today: string): number {
  const [sy, sm] = parseISO(start);
  const [ty, tm, td] = parseISO(today);
  const [, , sd] = parseISO(start);
  let months = (ty - sy) * 12 + (tm - sm);
  if (td < sd) months -= 1;
  return Math.max(0, months);
}

// ---------------------------------------------------------------- CSV statement import helpers

/** Stable identity for a statement line, so importing an overlapping export twice never duplicates. */
export function txHash(date: string, amount: number, description: string, occurrence: number): string {
  // `occurrence` distinguishes two genuinely identical lines in the same statement (e.g. two coffees).
  const text = `${date}|${amount.toFixed(2)}|${description.trim().toLowerCase().replace(/\s+/g, ' ')}|${occurrence}`;
  return createHash('sha1').update(text).digest('hex').slice(0, 20);
}

// ---------------------------------------------------------------- text matching (rules, bills, search)

/** Case-fold and collapse whitespace. SQLite's lower()/LIKE only fold A-Z, so Polish text is matched here instead. */
export function normText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The rule whose pattern is found in the description. The longest pattern wins, so a specific rule beats a broad one. */
export function matchRule<T extends { pattern: string }>(rules: T[], description: string): T | undefined {
  const d = normText(description);
  let best: T | undefined;
  let bestLen = 0;
  for (const r of rules) {
    const p = normText(r.pattern);
    if (p && d.includes(p) && p.length > bestLen) { best = r; bestLen = p.length; }
  }
  return best;
}

export interface TrendRow { month: string; category: string; income: number; expenses: number }
export interface MonthTrend { month: string; income: number; expenses: number; net: number; savingsRate: number | null; byCategory: Record<string, number> }

/**
 * Month-by-month income and spending from `from` to `to` (YYYY-MM, inclusive), with empty months filled in.
 * Spending is split into the `topN` categories by total over all rows (so a category keeps its colour whatever
 * range is shown), and everything else is folded into "Other".
 */
export function monthlyTrends(rows: TrendRow[], from: string, to: string, topN = 6): { months: MonthTrend[]; categories: string[] } {
  const totals = new Map<string, number>();
  for (const r of rows) if (r.expenses > 0) totals.set(r.category, (totals.get(r.category) ?? 0) + r.expenses);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([c]) => c);
  const hasOther = totals.size > top.length;
  const categories = hasOther ? [...top, 'Other'] : top;

  const months: MonthTrend[] = [];
  for (let m = from; m <= to; m = addMonths(`${m}-01`, 1).slice(0, 7)) {
    const mine = rows.filter((r) => r.month === m);
    const income = mine.reduce((t, r) => t + r.income, 0);
    const expenses = mine.reduce((t, r) => t + r.expenses, 0);
    const byCategory: Record<string, number> = Object.fromEntries(categories.map((c) => [c, 0]));
    for (const r of mine) if (r.expenses > 0) byCategory[top.includes(r.category) ? r.category : 'Other'] += r.expenses;
    months.push({ month: m, income, expenses, net: income - expenses, savingsRate: income > 0 ? (income - expenses) / income : null, byCategory });
  }
  return { months, categories };
}

// ---------------------------------------------------------------- exchange rates

/** Split [from, to] into ranges of at most `days` days (NBP answers at most 367 days per request). */
export function dateChunks(from: string, to: string, days = 360): [string, string][] {
  const out: [string, string][] = [];
  for (let start = from; start <= to; start = addDays(start, days)) {
    const end = addDays(start, days - 1);
    out.push([start, end < to ? end : to]);
  }
  return out;
}
