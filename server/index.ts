import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, getSettings, CATEGORIES } from './db.ts';
import {
  amortize, billStatus, fireSummary, nextOccurrence, occurrencesBetween, paymentsMade,
  todayISO, addDays, addMonths, txHash, matchRule, monthlyTrends, type TrendRow, normText, type Frequency, type LoanInputs,
  balanceHistory, loanOwed, loanTotals, monthEnd, monthsBetween, type LoanLine,
} from './logic.ts';
import { parseLoanHistory } from '../shared/loan.ts';
import { ensureRates, missingRates, rateSql } from './fx.ts';
import { CURRENCIES } from '../shared/parse.ts';

const app = express();
app.use(express.json({ limit: '10mb' }));

type Row = Record<string, string | number | null>;
const all = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as Row[];
const one = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).get(...p) as Row | undefined;
const run = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bad = (res: express.Response, msg: string) => res.status(400).json({ error: msg });
const currencyOf = (v: unknown, fallback = 'PLN') => (CURRENCIES as readonly string[]).includes(str(v)) ? str(v) : fallback;
// an amount or balance in its account's currency, converted to PLN at the NBP rate of `date` (SQL expressions)
const TODAY_SQL = "date('now', 'localtime')";
const plnSql = (amount: string, date: string) => `(${amount} * ${rateSql('a.currency', date)})`;

app.get('/api/meta', (_req, res) => res.json({ categories: CATEGORIES, today: todayISO() }));

// ------------------------------------------------------------------ accounts
function saveSnapshot(accountId: number, balance: number) {
  run(
    'INSERT INTO balance_snapshots (account_id, month, balance) VALUES (?, ?, ?) ON CONFLICT(account_id, month) DO UPDATE SET balance = excluded.balance',
    accountId, todayISO().slice(0, 7), balance,
  );
}

app.get('/api/accounts', async (_req, res) => {
  await ensureRates();
  res.json(all(`SELECT a.*, ${plnSql('a.balance', TODAY_SQL)} AS balance_pln FROM accounts a WHERE a.archived = 0 ORDER BY a.owner, a.kind, a.name`));
});

app.post('/api/accounts', (req, res) => {
  const b = req.body ?? {};
  if (!str(b.name)) return bad(res, 'name required');
  if (!['cash', 'investment', 'asset', 'debt'].includes(str(b.kind))) return bad(res, 'bad kind');
  const owner = str(b.owner, 'personal') === 'business' ? 'business' : 'personal';
  const r = run(
    'INSERT INTO accounts (name, bank, kind, owner, currency, balance, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    str(b.name), str(b.bank), str(b.kind), owner, currencyOf(b.currency), num(b.balance), str(b.source, 'manual'),
  );
  saveSnapshot(Number(r.lastInsertRowid), num(b.balance));
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put('/api/accounts/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT * FROM accounts WHERE id = ?', id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const b = req.body ?? {};
  const balance = b.balance === undefined ? Number(cur.balance) : num(b.balance);
  run(
    'UPDATE accounts SET name = ?, bank = ?, kind = ?, owner = ?, currency = ?, balance = ? WHERE id = ?',
    str(b.name, String(cur.name)), str(b.bank, String(cur.bank)), str(b.kind, String(cur.kind)),
    str(b.owner, String(cur.owner)), currencyOf(b.currency, String(cur.currency)), balance, id,
  );
  saveSnapshot(id, balance);
  res.json({ ok: true });
});

// Balances recorded for past months: the history of accounts without transactions (property, loans, investments).
app.get('/api/accounts/:id/snapshots', (req, res) => {
  res.json(all('SELECT month, balance FROM balance_snapshots WHERE account_id = ? ORDER BY month', Number(req.params.id)));
});

app.put('/api/accounts/:id/snapshots', (req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT 1 FROM accounts WHERE id = ?', id)) return res.status(404).json({ error: 'not found' });
  const rows = (Array.isArray(req.body?.snapshots) ? req.body.snapshots : []) as { month?: unknown; balance?: unknown }[];
  const valid = rows.filter((r) => /^\d{4}-(0[1-9]|1[0-2])$/.test(str(r.month)) && typeof r.balance === 'number' && Number.isFinite(r.balance));
  if (!valid.length) return bad(res, 'snapshots: [{ month: YYYY-MM, balance }] required');
  const thisMonth = todayISO().slice(0, 7);
  for (const r of valid) {
    run(
      'INSERT INTO balance_snapshots (account_id, month, balance) VALUES (?, ?, ?) ON CONFLICT(account_id, month) DO UPDATE SET balance = excluded.balance',
      id, str(r.month), Number(r.balance),
    );
    if (r.month === thisMonth) run('UPDATE accounts SET balance = ? WHERE id = ?', Number(r.balance), id);
  }
  res.json({ saved: valid.length });
});

app.delete('/api/accounts/:id/snapshots/:month', (req, res) => {
  run('DELETE FROM balance_snapshots WHERE account_id = ? AND month = ?', Number(req.params.id), req.params.month);
  res.json({ ok: true });
});

app.delete('/api/accounts/:id', (req, res) => {
  run('UPDATE accounts SET archived = 1 WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ transactions
app.get('/api/transactions', (req, res) => {
  const where: string[] = ['a.archived = 0'];
  const p: (string | number)[] = [];
  const q = req.query;
  if (typeof q.account === 'string' && q.account) { where.push('t.account_id = ?'); p.push(Number(q.account)); }
  if (typeof q.owner === 'string' && q.owner) { where.push('a.owner = ?'); p.push(q.owner); }
  if (typeof q.from === 'string' && q.from) { where.push('t.date >= ?'); p.push(q.from); }
  if (typeof q.to === 'string' && q.to) { where.push('t.date <= ?'); p.push(q.to); }
  if (typeof q.category === 'string' && q.category) {
    if (q.category === '__none') where.push('t.category IS NULL'); else { where.push('t.category = ?'); p.push(q.category); }
  }
  const rows = all(
    `SELECT t.id, t.account_id, a.name AS account, a.owner, a.currency, t.date, t.amount, t.description, t.category
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.id DESC`,
    ...p,
  );
  // Text search is done here: SQLite's LIKE does not fold Polish capitals.
  const needle = typeof q.q === 'string' ? normText(q.q) : '';
  const found = needle ? rows.filter((r) => normText(String(r.description)).includes(needle)) : rows;
  // one page at a time: rendering every row (each with its own category list) is what made the page slow
  const size = Math.min(500, Math.max(1, Math.floor(Number(q.size ?? 100)) || 100));
  const page = Math.max(1, Math.floor(Number(q.page ?? 1)) || 1);
  res.json({ rows: found.slice((page - 1) * size, page * size), total: found.length, page, size });
});

app.patch('/api/transactions/:id', (req, res) => {
  const category = req.body?.category;
  run('UPDATE transactions SET category = ? WHERE id = ?', typeof category === 'string' && category ? category : null, Number(req.params.id));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ category rules
app.get('/api/rules', (_req, res) => res.json(all('SELECT * FROM category_rules ORDER BY id')));
type RuleRow = { id: number; pattern: string; category: string };

/** File every uncategorised transaction that a rule matches. Never touches a category set by hand. */
function applyRules(): number {
  const rules = all('SELECT id, pattern, category FROM category_rules') as unknown as RuleRow[];
  if (!rules.length) return 0;
  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const t of all('SELECT id, description FROM transactions WHERE category IS NULL')) {
      const rule = matchRule(rules, String(t.description));
      if (rule) { run('UPDATE transactions SET category = ? WHERE id = ?', rule.category, Number(t.id)); changed++; }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return changed;
}

app.post('/api/rules', (req, res) => {
  const pattern = str(req.body?.pattern).trim();
  const category = str(req.body?.category);
  if (!pattern || !category) return bad(res, 'pattern and category required');
  run('INSERT INTO category_rules (pattern, category) VALUES (?, ?)', pattern, category);
  res.json({ categorised: applyRules() });
});
app.post('/api/rules/apply', (_req, res) => res.json({ categorised: applyRules() }));
app.delete('/api/rules/:id', (req, res) => { run('DELETE FROM category_rules WHERE id = ?', Number(req.params.id)); res.json({ ok: true }); });

// ------------------------------------------------------------------ bills
interface BillRow extends Row { id: number; name: string; amount: number; frequency: Frequency; next_due: string; match_pattern: string | null; category: string; anchor_day: number | null }

function recordPayment(bill: BillRow, paidDate: string, amount: number, transactionId: number | null) {
  run(
    'INSERT INTO bill_payments (bill_id, due_date, paid_date, amount, transaction_id) VALUES (?, ?, ?, ?, ?)',
    bill.id, bill.next_due, paidDate, amount, transactionId,
  );
  const next = nextOccurrence(bill.next_due, bill.frequency, bill.anchor_day ?? undefined);
  if (next) run('UPDATE bills SET next_due = ? WHERE id = ?', next, bill.id);
  else run('UPDATE bills SET active = 0 WHERE id = ?', bill.id);
}

app.get('/api/bills', (_req, res) => {
  const today = todayISO();
  const rows = all('SELECT * FROM bills WHERE active = 1 ORDER BY next_due, name') as BillRow[];
  res.json(rows.map((b) => ({ ...b, status: billStatus(b.next_due, today) })));
});

function billFields(b: Record<string, unknown>) {
  return [
    str(b.name), num(b.amount), b.amount_varies ? 1 : 0, str(b.frequency, 'monthly'),
    str(b.next_due), str(b.category, 'Misc'), str(b.match_pattern).trim() || null, str(b.notes),
  ] as const;
}

const anchorOf = (b: Record<string, unknown>) => Number(str(b.next_due).slice(8, 10));

app.post('/api/bills', (req, res) => {
  const b = req.body ?? {};
  if (!str(b.name) || !/^\d{4}-\d{2}-\d{2}$/.test(str(b.next_due))) return bad(res, 'name and next_due (YYYY-MM-DD) required');
  if (!['weekly', 'monthly', 'quarterly', 'yearly', 'once'].includes(str(b.frequency, 'monthly'))) return bad(res, 'bad frequency');
  const r = run(
    'INSERT INTO bills (name, amount, amount_varies, frequency, next_due, category, match_pattern, notes, anchor_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ...billFields(b), anchorOf(b),
  );
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put('/api/bills/:id', (req, res) => {
  const b = req.body ?? {};
  if (!str(b.name) || !/^\d{4}-\d{2}-\d{2}$/.test(str(b.next_due))) return bad(res, 'name and next_due (YYYY-MM-DD) required');
  run(
    'UPDATE bills SET name = ?, amount = ?, amount_varies = ?, frequency = ?, next_due = ?, category = ?, match_pattern = ?, notes = ?, anchor_day = ? WHERE id = ?',
    ...billFields(b), anchorOf(b), Number(req.params.id),
  );
  res.json({ ok: true });
});

app.delete('/api/bills/:id', (req, res) => { run('UPDATE bills SET active = 0 WHERE id = ?', Number(req.params.id)); res.json({ ok: true }); });

app.post('/api/bills/:id/pay', (req, res) => {
  const bill = one('SELECT * FROM bills WHERE id = ? AND active = 1', Number(req.params.id)) as BillRow | undefined;
  if (!bill) return res.status(404).json({ error: 'not found' });
  recordPayment(bill, str(req.body?.paidDate, todayISO()), num(req.body?.amount, bill.amount), null);
  res.json({ ok: true });
});

app.get('/api/bills/payments', (_req, res) => {
  res.json(all(
    `SELECT p.id, b.name, p.due_date, p.paid_date, p.amount FROM bill_payments p
     JOIN bills b ON b.id = p.bill_id ORDER BY p.paid_date DESC, p.id DESC LIMIT 100`,
  ));
});

/** Every bill occurrence between two dates, for the calendar view. */
app.get('/api/bills/calendar', (req, res) => {
  const from = str(req.query.from, todayISO());
  const to = str(req.query.to, addDays(from, 60));
  const bills = all('SELECT * FROM bills WHERE active = 1') as BillRow[];
  const out = bills.flatMap((b) =>
    occurrencesBetween(b.next_due, b.frequency, from, to, b.anchor_day ?? undefined).map((date) => ({
      billId: b.id, name: b.name, amount: b.amount, date, category: b.category,
    })));
  out.sort((a, b) => a.date.localeCompare(b.date));
  res.json(out);
});

// ------------------------------------------------------------------ statement import
interface ImportRow { date: string; amount: number; description: string; currency?: string | null }

app.post('/api/import', (req, res) => {
  const accountId = Number(req.body?.accountId);
  const rows = req.body?.rows as ImportRow[] | undefined;
  const account = one('SELECT id, currency FROM accounts WHERE id = ?', accountId);
  if (!account) return bad(res, 'unknown account');
  if (!Array.isArray(rows)) return bad(res, 'rows required');

  const rules = all('SELECT pattern, category FROM category_rules ORDER BY id') as { pattern: string; category: string }[];
  const bills = all('SELECT * FROM bills WHERE active = 1 AND match_pattern IS NOT NULL') as BillRow[];
  const seen = new Map<string, number>();
  let added = 0, duplicates = 0, billsPaid = 0, otherCurrency = 0;

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  db.exec('BEGIN');
  try {
    for (const r of sorted) {
      if (typeof r.date !== 'string' || typeof r.amount !== 'number' || !Number.isFinite(r.amount)) continue;
      // a line in another currency belongs to a different account; never add it at the wrong value
      if (r.currency && r.currency !== account.currency) { otherCurrency++; continue; }
      const description = str(r.description);
      const key = `${r.date}|${r.amount.toFixed(2)}|${description}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);

      const lower = normText(description);
      let category = matchRule(rules, description)?.category ?? null;
      const bill = r.amount < 0 ? bills.find((b) => lower.includes(normText(String(b.match_pattern)))) : undefined;
      if (bill && !category) category = bill.category;

      const ins = run(
        'INSERT OR IGNORE INTO transactions (account_id, date, amount, description, category, hash) VALUES (?, ?, ?, ?, ?, ?)',
        accountId, r.date, r.amount, description, category, txHash(r.date, r.amount, description, occurrence),
      );
      if (Number(ins.changes) === 0) { duplicates++; continue; }
      added++;

      // A new bank payment matching a bill settles its next due date (only if it is roughly that bill's turn).
      if (bill) {
        const current = one('SELECT * FROM bills WHERE id = ? AND active = 1', bill.id) as BillRow | undefined;
        if (current && r.date >= addDays(current.next_due, -20)) {
          recordPayment(current, r.date, Math.abs(r.amount), Number(ins.lastInsertRowid));
          billsPaid++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: String(e) });
  }
  res.json({ added, duplicates, billsPaid, otherCurrency });
});

// ------------------------------------------------------------------ settings, mortgage, summary
app.get('/api/settings', (_req, res) => res.json(getSettings()));
app.put('/api/settings', (req, res) => {
  const known = getSettings();
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (k in known && (typeof v === 'string' || typeof v === 'number')) {
      run('UPDATE settings SET value = ? WHERE key = ?', String(v), k);
    }
  }
  res.json(getSettings());
});

function loanFromSettings(): LoanInputs & { start: string } {
  const s = getSettings();
  return {
    principal: Number(s.loanPrincipal), apr: Number(s.loanApr), years: Number(s.loanYears),
    extraMonthly: Number(s.loanExtraMonthly), start: s.loanStart,
  };
}

app.get('/api/mortgage', (_req, res) => {
  const loan = loanFromSettings();
  if (loan.principal <= 0) return res.json({ configured: false });
  const plain = amortize({ ...loan, extraMonthly: 0 });
  const withExtra = amortize(loan);
  const made = loan.start ? paymentsMade(loan.start, todayISO()) : 0;
  const row = withExtra.rows[Math.min(made, withExtra.rows.length) - 1];
  res.json({
    configured: true, ...loan,
    monthlyPayment: plain.monthlyPayment,
    totalInterest: withExtra.totalInterest,
    interestSaved: plain.totalInterest - withExtra.totalInterest,
    payoffPayments: withExtra.payments,
    paymentsMade: made,
    remainingBalance: made === 0 ? loan.principal : row ? row.balanceEnd : 0,
    schedule: withExtra.rows,
    payoffDate: loan.start ? addMonths(loan.start, withExtra.payments) : null,
  });
});

app.get('/api/summary', async (_req, res) => {
  await ensureRates();
  const s = getSettings();
  const today = todayISO();
  const accts = all(`SELECT a.kind, a.owner, ${plnSql('a.balance', TODAY_SQL)} AS pln FROM accounts a WHERE a.archived = 0`) as (Row & { kind: string; owner: string; pln: number | null })[];
  const sum = (kind: string) => accts.filter((a) => a.kind === kind).reduce((t, a) => t + Number(a.pln ?? 0), 0);
  const cash = sum('cash'), investments = sum('investment'), assets = sum('asset'), debt = sum('debt');
  const netWorth = cash + investments + assets + debt;
  const business = accts.filter((a) => a.owner === 'business' && a.kind === 'cash').reduce((t, a) => t + Number(a.pln ?? 0), 0);

  // last 6 full months + this month of income / expenses, all accounts (transfers excluded)
  const from = addMonths(today.slice(0, 7) + '-01', -6);
  const months = all(
    `SELECT substr(t.date, 1, 7) AS month,
            SUM(CASE WHEN t.amount > 0 THEN ${plnSql('t.amount', 't.date')} ELSE 0 END) AS income,
            SUM(CASE WHEN t.amount < 0 THEN -${plnSql('t.amount', 't.date')} ELSE 0 END) AS expenses
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.archived = 0 AND t.date >= ? AND COALESCE(t.category, '') <> 'Transfer'
     GROUP BY month ORDER BY month`, from,
  );
  const thisMonth = today.slice(0, 7);
  const byCategory = all(
    `SELECT COALESCE(t.category, 'Uncategorised') AS category, SUM(-${plnSql('t.amount', 't.date')}) AS spent
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.archived = 0 AND t.amount < 0 AND substr(t.date, 1, 7) = ?
       AND COALESCE(t.category, '') <> 'Transfer'
     GROUP BY category ORDER BY spent DESC`, thisMonth,
  );

  // yearly spend for the FIRE number: average of up to the last 6 completed months, else the sheet's default of 0
  const completed = (months as { month: string; expenses: number }[]).filter((m) => m.month < thisMonth).slice(-6);
  const avgMonthly = completed.length ? completed.reduce((t, m) => t + Number(m.expenses), 0) / completed.length : 0;
  const fire = fireSummary({
    yearlySpend: avgMonthly * 12,
    withdrawalRate: Number(s.withdrawalRate), netWorth, investments,
    stockAllocation: Number(s.stockAllocation), stockGrowth: Number(s.stockGrowth), bondGrowth: Number(s.bondGrowth),
    currentAge: Number(s.currentAge), retirementAge: Number(s.retirementAge),
  });

  const bills = all('SELECT * FROM bills WHERE active = 1') as BillRow[];
  const horizon = addDays(today, 30);
  const upcoming = bills
    .flatMap((b) => occurrencesBetween(b.next_due, b.frequency, '0000-01-01', horizon, b.anchor_day ?? undefined).map((date) => ({ id: b.id, name: b.name, amount: b.amount, date })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const overdue = upcoming.filter((u) => u.date < today);

  res.json({
    today, netWorth, cash, investments, assets, debt, businessCash: business, missingRates: missingRates(),
    months, byCategory, avgMonthlyExpenses: avgMonthly, fire,
    bills: {
      dueNext30Days: upcoming.reduce((t, u) => t + u.amount, 0),
      overdueCount: overdue.length,
      overdueTotal: overdue.reduce((t, u) => t + u.amount, 0),
      next: upcoming.slice(0, 8).map((u) => ({ ...u, status: billStatus(u.date, today) })),
    },
  });
});

// Month-by-month income and spending for the dashboard charts. `months` = how many months back (0 = all history).
// `owner` = personal | business | all (the default).
app.get('/api/trends', async (req, res) => {
  await ensureRates();
  const thisMonth = todayISO().slice(0, 7);
  const asked = str(req.query.owner, 'all');
  const owner = ['personal', 'business'].includes(asked) ? asked : 'all';
  const rows = (all(
    `SELECT substr(t.date, 1, 7) AS month, COALESCE(t.category, 'Uncategorised') AS category,
            SUM(CASE WHEN t.amount > 0 THEN ${plnSql('t.amount', 't.date')} ELSE 0 END) AS income,
            SUM(CASE WHEN t.amount < 0 THEN -${plnSql('t.amount', 't.date')} ELSE 0 END) AS expenses
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE (a.owner = ? OR ? = 'all') AND a.archived = 0 AND COALESCE(t.category, '') <> 'Transfer'
     GROUP BY month, category ORDER BY month`, owner, owner,
  ) as unknown as TrendRow[]).map((r) => ({ ...r, income: Number(r.income), expenses: Number(r.expenses) }));
  const latest = rows.at(-1)?.month ?? thisMonth;
  const to = latest > thisMonth ? latest : thisMonth;
  const back = Math.max(0, Math.floor(Number(req.query.months ?? 12)));
  const earliest = rows[0]?.month ?? to;
  const windowStart = back ? addMonths(`${to}-01`, -(back - 1)).slice(0, 7) : earliest;
  const from = windowStart > earliest ? windowStart : earliest; // don't pad with months before the first import
  const inRange = rows.filter((r) => r.month >= from && r.month <= to);
  // all rows, not just the range, pick the top categories, so a category keeps its colour across ranges
  res.json({ ...monthlyTrends(rows, from, to), rows: inRange, latestWithData: rows.at(-1)?.month ?? null, owner });
});

// ------------------------------------------------------------------ loans
const loanLines = (accountId: number) => all(
  'SELECT date, kind, amount, balance_after AS balanceAfter FROM loan_events WHERE account_id = ? ORDER BY date, id', accountId,
) as unknown as LoanLine[];

/** Record what a loan's statement says was owed at each month end, from its first line to this month. */
function rebuildLoanSnapshots(accountId: number): number | null {
  const lines = loanLines(accountId);
  if (!lines.some((l) => l.balanceAfter !== null)) return null;
  const months = monthsBetween(lines[0].date.slice(0, 7), todayISO().slice(0, 7));
  const owed = loanOwed(months, lines);
  db.exec('BEGIN');
  try {
    months.forEach((m, i) => {
      if (owed[i] === null) return;
      run(
        'INSERT INTO balance_snapshots (account_id, month, balance) VALUES (?, ?, ?) ON CONFLICT(account_id, month) DO UPDATE SET balance = excluded.balance',
        accountId, m, -owed[i]!,
      );
    });
    run('UPDATE accounts SET balance = ? WHERE id = ?', -(owed.at(-1) ?? 0), accountId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return owed.at(-1) ?? null;
}

app.post('/api/loans/:id/statement', (req, res) => {
  const id = Number(req.params.id);
  if (!one("SELECT 1 FROM accounts WHERE id = ? AND kind = 'debt'", id)) return bad(res, 'not a debt account');
  const lines = parseLoanHistory(str(req.body?.text));
  if (!lines.length) return bad(res, 'No loan history found. Expected the bank\'s "Historia kredytu" CSV export.');
  const seen = new Map<string, number>();
  let added = 0, duplicates = 0;
  db.exec('BEGIN');
  try {
    for (const l of lines) {
      const key = `${l.date}|${l.kind}|${l.amount}|${l.description}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      const ins = run(
        'INSERT OR IGNORE INTO loan_events (account_id, date, kind, amount, balance_after, description, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, l.date, l.kind, l.amount, l.balanceAfter, l.description, txHash(l.date, l.amount, `${l.kind}|${l.description}`, occurrence),
      );
      if (Number(ins.changes) === 0) duplicates++; else added++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: String(e) }); }
  res.json({ added, duplicates, owed: rebuildLoanSnapshots(id) });
});

/** Every debt account: what is owed month by month, and the statement's totals where one was imported. */
app.get('/api/loans', (_req, res) => {
  const thisMonth = todayISO().slice(0, 7);
  const debts = all("SELECT id, name, bank, currency, balance FROM accounts WHERE kind = 'debt' AND archived = 0 ORDER BY name");
  res.json(debts.map((d) => {
    const id = Number(d.id);
    const lines = loanLines(id);
    const snaps = all('SELECT month, balance FROM balance_snapshots WHERE account_id = ? ORDER BY month', id) as unknown as { month: string; balance: number }[];
    const months = snaps.length ? monthsBetween(snaps[0].month, thisMonth) : [];
    const owed = balanceHistory(months, Number(d.balance), [], snaps);
    return {
      ...d, owed: -Number(d.balance), fromStatement: lines.length > 0,
      totals: lines.length ? loanTotals(lines, todayISO()) : null,
      history: months.map((month, i) => ({ month, owed: owed[i] === null ? null : -owed[i]!, recorded: snaps.some((s) => s.month === month) })),
    };
  }));
});

// ------------------------------------------------------------------ net worth over time
const rateOn = db.prepare(`SELECT ${rateSql('$cur', '$date')} AS rate`);

/**
 * Net worth at the end of every month, split by kind of account, in PLN at each month end's NBP rate.
 * Accounts with transactions are worked back from today's balance; the rest carry their last recorded
 * monthly balance forward until a newer one.
 */
app.get('/api/networth-history', async (_req, res) => {
  await ensureRates();
  const accounts = all('SELECT id, kind, currency, balance FROM accounts WHERE archived = 0');
  const tx = all('SELECT t.account_id, t.date, t.amount FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.archived = 0');
  const snaps = all('SELECT s.account_id, s.month, s.balance FROM balance_snapshots s JOIN accounts a ON a.id = s.account_id WHERE a.archived = 0');
  const thisMonth = todayISO().slice(0, 7);
  const first = [...tx.map((t) => String(t.date).slice(0, 7)), ...snaps.map((s) => String(s.month))].sort()[0] ?? thisMonth;
  const months = monthsBetween(first, thisMonth);

  const rates = new Map<string, number[]>();
  const rate = (cur: string, i: number) => {
    if (!rates.has(cur)) rates.set(cur, months.map((m) => Number((rateOn.get({ cur, date: monthEnd(m) }) as { rate: number | null }).rate ?? 0)));
    return rates.get(cur)![i];
  };
  const KEY: Record<string, 'cash' | 'investments' | 'assets' | 'debt'> = { cash: 'cash', investment: 'investments', asset: 'assets', debt: 'debt' };
  const out = months.map((month) => ({ month, cash: 0, investments: 0, assets: 0, debt: 0, netWorth: 0 }));
  for (const a of accounts) {
    const history = balanceHistory(
      months, Number(a.balance),
      tx.filter((t) => t.account_id === a.id).map((t) => ({ date: String(t.date), amount: Number(t.amount) })),
      snaps.filter((s) => s.account_id === a.id).map((s) => ({ month: String(s.month), balance: Number(s.balance) })),
    );
    history.forEach((bal, i) => {
      if (bal === null) return;
      const pln = bal * rate(String(a.currency), i);
      out[i][KEY[String(a.kind)]] += pln;
      out[i].netWorth += pln;
    });
  }
  res.json(out);
});

// ------------------------------------------------------------------ static UI (after `npm run build`)
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, '127.0.0.1', () => console.log(`Finance Planner API on http://127.0.0.1:${PORT}`));
