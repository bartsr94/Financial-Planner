// Exchange rates for converting foreign-currency accounts to PLN. Rates come from NBP table A (the
// average rate Polish tax uses) and are cached in fx_rates, so the app keeps working offline.
import { db } from './db.ts';
import { addDays, dateChunks, todayISO } from './logic.ts';

/**
 * SQL for the PLN rate of currency `cur` on `date` (both SQL expressions): the latest NBP rate on or
 * before that day, or the earliest known rate for days before the cache starts. NULL if none is cached.
 */
export const rateSql = (cur: string, date: string) => `(CASE WHEN ${cur} = 'PLN' THEN 1.0 ELSE COALESCE(
  (SELECT r.rate FROM fx_rates r WHERE r.currency = ${cur} AND r.date <= ${date} ORDER BY r.date DESC LIMIT 1),
  (SELECT r.rate FROM fx_rates r WHERE r.currency = ${cur} ORDER BY r.date LIMIT 1)) END)`;

/** Currencies held by an active account that have no cached rate at all, so their amounts count as 0. */
export function missingRates(): string[] {
  return (db.prepare(
    `SELECT DISTINCT a.currency FROM accounts a WHERE a.archived = 0 AND a.currency <> 'PLN'
     AND NOT EXISTS (SELECT 1 FROM fx_rates r WHERE r.currency = a.currency)`,
  ).all() as { currency: string }[]).map((r) => r.currency);
}

async function fetchRange(currency: string, from: string, to: string): Promise<void> {
  const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/A/${currency}/${from}/${to}/?format=json`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return; // no business day in the range
  if (!res.ok) throw new Error(`NBP ${currency} ${from}..${to}: HTTP ${res.status}`);
  const body = await res.json() as { rates: { effectiveDate: string; mid: number }[] };
  const ins = db.prepare('INSERT OR REPLACE INTO fx_rates (currency, date, rate) VALUES (?, ?, ?)');
  for (const r of body.rates) ins.run(currency, r.effectiveDate, r.mid);
}

const checkedToday = new Map<string, string>();
let inFlight: Promise<void> | null = null;

/**
 * Fill the rate cache for every foreign currency in use, from a week before its oldest transaction or
 * balance to today. Already-cached days are not fetched again, and today's tail is checked once per day.
 * Never throws: without a network the app carries on with what is cached.
 */
export function ensureRates(): Promise<void> {
  inFlight ??= (async () => {
    const today = todayISO();
    const used = db.prepare(
      `SELECT a.currency, MIN(COALESCE(
         (SELECT MIN(t.date) FROM transactions t WHERE t.account_id = a.id),
         (SELECT MIN(s.month) || '-01' FROM balance_snapshots s WHERE s.account_id = a.id),
         ?)) AS first
       FROM accounts a WHERE a.archived = 0 AND a.currency <> 'PLN' GROUP BY a.currency`,
    ).all(today) as { currency: string; first: string }[];
    for (const { currency, first } of used) {
      const want = addDays(first < today ? first : today, -7);
      const have = db.prepare('SELECT MIN(date) AS lo, MAX(date) AS hi FROM fx_rates WHERE currency = ?').get(currency) as { lo: string | null; hi: string | null };
      const ranges: [string, string][] = [];
      if (!have.lo) ranges.push([want, today]);
      else {
        if (want < have.lo) ranges.push([want, addDays(have.lo, -1)]);
        if (have.hi! < today && checkedToday.get(currency) !== today) ranges.push([addDays(have.hi!, 1), today]);
      }
      try {
        for (const [from, to] of ranges) for (const [a, b] of dateChunks(from, to)) await fetchRange(currency, a, b);
        checkedToday.set(currency, today);
      } catch (e) {
        console.warn(`Exchange rates for ${currency} not updated: ${(e as Error).message}`);
      }
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}
