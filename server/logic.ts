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

/** Payments made as of `today` on a loan whose first payment falls on `start` (YYYY-MM-DD), that date's payment included. */
export function paymentsMade(start: string, today: string): number {
  const [sy, sm] = parseISO(start);
  const [ty, tm, td] = parseISO(today);
  const [, , sd] = parseISO(start);
  let months = (ty - sy) * 12 + (tm - sm);
  if (td < sd) months -= 1;
  return Math.max(0, months + 1);
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

// ---------------------------------------------------------------- net worth over time

/** The last day of month `m` (YYYY-MM). */
export const monthEnd = (m: string) => addDays(addMonths(`${m}-01`, 1), -1);

/** Every month from `from` to `to` (YYYY-MM, inclusive). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(`${m}-01`, 1).slice(0, 7)) out.push(m);
  return out;
}

/**
 * An account's balance at the end of each month, null before anything is known.
 * From its first transaction on, worked back from today's balance by undoing later transactions;
 * before that (and for accounts without transactions) the latest balance recorded for a month carries forward.
 */
export function balanceHistory(
  months: string[], current: number,
  transactions: { date: string; amount: number }[], snapshots: { month: string; balance: number }[],
): (number | null)[] {
  const firstTx = transactions.reduce<string | null>((lo, t) => (lo === null || t.date < lo ? t.date : lo), null)?.slice(0, 7) ?? null;
  const recorded = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));
  return months.map((m) => {
    if (firstTx !== null && m >= firstTx) {
      const end = monthEnd(m);
      return transactions.reduce((bal, t) => (t.date > end ? bal - t.amount : bal), current);
    }
    const last = recorded.filter((s) => s.month <= m).at(-1);
    return last ? last.balance : null;
  });
}

export interface LoanLine { date: string; kind: 'drawdown' | 'principal' | 'interest'; amount: number; balanceAfter: number | null }

/** What was still owed at the end of each month by a loan's history, null before it was drawn. */
export function loanOwed(months: string[], lines: LoanLine[]): (number | null)[] {
  // within a day the smallest balance is the last one (payments only lower it)
  const known = lines.filter((l) => l.balanceAfter !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || b.balanceAfter! - a.balanceAfter!);
  return months.map((m) => {
    const end = monthEnd(m);
    const last = known.filter((l) => l.date <= end).at(-1);
    return last ? last.balanceAfter : null;
  });
}

/** Totals of a loan's history: borrowed, repaid, interest (all time and the 12 months up to `today`). */
export function loanTotals(lines: LoanLine[], today: string) {
  const sum = (kind: LoanLine['kind'], from = '') => lines.filter((l) => l.kind === kind && l.date >= from).reduce((t, l) => t + l.amount, 0);
  const yearAgo = addMonths(today, -12);
  const owed = loanOwed([today.slice(0, 7)], lines)[0];
  return {
    borrowed: sum('drawdown'), principalRepaid: sum('principal'), interestPaid: sum('interest'),
    principalLast12: sum('principal', yearAgo), interestLast12: sum('interest', yearAgo),
    owed, firstDate: lines.map((l) => l.date).sort()[0] ?? null, lastDate: lines.map((l) => l.date).sort().at(-1) ?? null,
  };
}

export interface TransferLine { id: number; accountId: number; date: string; amount: number; currency: string; description: string }

// mBank marks a transfer between the holder's own accounts "PRZELEW WŁASNY"
const OWN_TRANSFER = /przelew w[łl]asny/i;
// tax and social-security payments go to an outside account even when an amount happens to match
const NEVER_TRANSFER = /urz[ąa]d skarbowy|\bvat\b|\bzus\b|\bpit\b/i;

/**
 * Lines that move money between the owner's own accounts: those the bank marks as an own transfer,
 * and pairs of an outgoing and incoming line of exactly the same amount and currency on two
 * different accounts within `days` days. Each line pairs once, with the nearest date. Lines in
 * different currencies are never paired: the rate the bank used is unknown, so a match would be a guess.
 */
export function findTransfers(lines: TransferLine[], days = 3): number[] {
  const found = new Set<number>();
  for (const l of lines) if (OWN_TRANSFER.test(l.description) && !NEVER_TRANSFER.test(l.description)) found.add(l.id);
  const open = lines.filter((l) => !NEVER_TRANSFER.test(l.description));
  const incoming = open.filter((l) => l.amount > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const used = new Set<number>();
  for (const out of open.filter((l) => l.amount < 0).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    let best: TransferLine | undefined;
    let bestGap = Infinity;
    for (const inc of incoming) {
      if (used.has(inc.id) || inc.accountId === out.accountId || inc.currency !== out.currency) continue;
      if (Math.abs(inc.amount + out.amount) > 0.005) continue;
      const gap = Math.abs(daysBetween(out.date, inc.date));
      if (gap <= days && gap < bestGap) { best = inc; bestGap = gap; }
    }
    if (best) { used.add(best.id); found.add(best.id); found.add(out.id); }
  }
  return [...found];
}

export interface RecurringLine { key: string; date: string; amount: number; category: string | null }
export interface Recurring {
  key: string; frequency: Exclude<Frequency, 'once'>; amount: number; amountVaries: boolean;
  nextDue: string; last: string; count: number; category: string | null; monthly: number;
}

// how far apart payments of each frequency fall, in days
const PERIODS: { frequency: Exclude<Frequency, 'once'>; lo: number; hi: number; perMonth: number }[] = [
  { frequency: 'weekly', lo: 6, hi: 8, perMonth: 52 / 12 },
  { frequency: 'monthly', lo: 25, hi: 36, perMonth: 1 },
  { frequency: 'quarterly', lo: 84, hi: 98, perMonth: 1 / 3 },
  { frequency: 'yearly', lo: 350, hi: 380, perMonth: 1 / 12 },
];
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Payments that repeat on a schedule: at least three to one merchant (`key`) of a similar amount,
 * three in four spaced like one frequency, and the latest recent enough that the next is not long
 * overdue. Payments to a merchant on the same day count as one. A merchant paid two different
 * amounts (a subscription, and taxes paid through the same service) is checked once per amount.
 * Amounts are outgoing (negative).
 */
export function findRecurring(lines: RecurringLine[], today: string): Recurring[] {
  const groups = new Map<string, RecurringLine[]>();
  for (const l of lines) if (l.amount < 0) groups.set(l.key, [...(groups.get(l.key) ?? []), l]);
  const out: Recurring[] = [];
  for (const [key, ls] of groups) {
    const byDay = new Map<string, number>();
    for (const l of ls) byDay.set(l.date, (byDay.get(l.date) ?? 0) - l.amount);
    // payments within 30% of each other's amount form one stream
    const streams: { date: string; amount: number }[][] = [];
    for (const [date, amount] of [...byDay].sort((a, b) => a[1] - b[1])) {
      const s = streams.find((st) => Math.abs(amount - median(st.map((p) => p.amount))) <= amount * 0.3);
      if (s) s.push({ date, amount }); else streams.push([{ date, amount }]);
    }
    for (const stream of streams) {
      const r = scheduleOf(key, stream.sort((a, b) => a.date.localeCompare(b.date)), today);
      if (r) out.push({ ...r, category: ls.filter((l) => l.category).sort((a, b) => b.date.localeCompare(a.date))[0]?.category ?? null });
    }
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

function scheduleOf(key: string, pays: { date: string; amount: number }[], today: string): Omit<Recurring, 'category'> | null {
  if (pays.length < 3) return null;
  const gaps = pays.slice(1).map((p, i) => daysBetween(pays[i].date, p.date));
  const period = PERIODS.find((p) => { const g = median(gaps); return g >= p.lo && g <= p.hi; });
  if (!period) return null;
  // recent gaps decide: a merchant can change from irregular to a schedule
  const recent = gaps.slice(-6);
  if (recent.filter((g) => g >= period.lo && g <= period.hi).length / recent.length < 0.75) return null;
  const amounts = pays.slice(-6).map((p) => p.amount);
  const typical = median(amounts);
  const last = pays.at(-1)!.date;
  const nextDue = period.frequency === 'weekly' ? addDays(last, 7) : addMonths(last, period.frequency === 'monthly' ? 1 : period.frequency === 'quarterly' ? 3 : 12);
  // stopped: the next payment is overdue by more than half a period
  if (daysBetween(nextDue, today) > (period.lo + period.hi) / 4) return null;
  return {
    key, frequency: period.frequency, amount: Math.round(typical * 100) / 100,
    amountVaries: Math.max(...amounts) - Math.min(...amounts) > typical * 0.05,
    nextDue, last, count: pays.length, monthly: typical * period.perMonth,
  };
}

export interface ForecastMonth { month: string; income: number; spending: number; balance: number }

/**
 * Cash at the end of this month and the next `ahead` months, if income and spending run at their median of the
 * completed months given. This month counts only the part still to come, by days left.
 */
export function forecastCash(start: number, history: { income: number; expenses: number }[], today: string, ahead: number):
  { income: number; spending: number; months: ForecastMonth[] } {
  const income = history.length ? median(history.map((h) => h.income)) : 0;
  const spending = history.length ? median(history.map((h) => h.expenses)) : 0;
  const first = today.slice(0, 7);
  const days = Number(monthEnd(first).slice(8, 10));
  const left = (days - Number(today.slice(8, 10))) / days;
  const months: ForecastMonth[] = [];
  let balance = start;
  for (let i = 0; i <= ahead; i++) {
    const share = i === 0 ? left : 1;
    balance += (income - spending) * share;
    months.push({ month: addMonths(`${first}-01`, i).slice(0, 7), income: income * share, spending: spending * share, balance });
  }
  return { income, spending, months };
}
