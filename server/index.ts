import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, getSettings, CATEGORIES } from './db.ts';
import {
  amortize, billStatus, fireSummary, nextOccurrence, occurrencesBetween, paymentsMade,
  todayISO, addDays, addMonths, txHash, type Frequency, type LoanInputs,
} from './logic.ts';

const app = express();
app.use(express.json({ limit: '10mb' }));

type Row = Record<string, string | number | null>;
const all = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as Row[];
const one = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).get(...p) as Row | undefined;
const run = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bad = (res: express.Response, msg: string) => res.status(400).json({ error: msg });

app.get('/api/meta', (_req, res) => res.json({ categories: CATEGORIES, today: todayISO() }));

// ------------------------------------------------------------------ accounts
function saveSnapshot(accountId: number, balance: number) {
  run(
    'INSERT INTO balance_snapshots (account_id, month, balance) VALUES (?, ?, ?) ON CONFLICT(account_id, month) DO UPDATE SET balance = excluded.balance',
    accountId, todayISO().slice(0, 7), balance,
  );
}

app.get('/api/accounts', (_req, res) => {
  res.json(all('SELECT * FROM accounts WHERE archived = 0 ORDER BY owner, kind, name'));
});

app.post('/api/accounts', (req, res) => {
  const b = req.body ?? {};
  if (!str(b.name)) return bad(res, 'name required');
  if (!['cash', 'investment', 'asset', 'debt'].includes(str(b.kind))) return bad(res, 'bad kind');
  const owner = str(b.owner, 'personal') === 'business' ? 'business' : 'personal';
  const r = run(
    'INSERT INTO accounts (name, bank, kind, owner, currency, balance, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    str(b.name), str(b.bank), str(b.kind), owner, str(b.currency, 'PLN'), num(b.balance), str(b.source, 'manual'),
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
    'UPDATE accounts SET name = ?, bank = ?, kind = ?, owner = ?, balance = ? WHERE id = ?',
    str(b.name, String(cur.name)), str(b.bank, String(cur.bank)), str(b.kind, String(cur.kind)),
    str(b.owner, String(cur.owner)), balance, id,
  );
  saveSnapshot(id, balance);
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
  if (typeof q.q === 'string' && q.q) { where.push('t.description LIKE ?'); p.push(`%${q.q}%`); }
  const rows = all(
    `SELECT t.id, t.account_id, a.name AS account, a.owner, t.date, t.amount, t.description, t.category
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.id DESC LIMIT 1000`,
    ...p,
  );
  res.json(rows);
});

app.patch('/api/transactions/:id', (req, res) => {
  const category = req.body?.category;
  run('UPDATE transactions SET category = ? WHERE id = ?', typeof category === 'string' && category ? category : null, Number(req.params.id));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ category rules
app.get('/api/rules', (_req, res) => res.json(all('SELECT * FROM category_rules ORDER BY id')));
app.post('/api/rules', (req, res) => {
  const pattern = str(req.body?.pattern).trim();
  const category = str(req.body?.category);
  if (!pattern || !category) return bad(res, 'pattern and category required');
  run('INSERT INTO category_rules (pattern, category) VALUES (?, ?)', pattern, category);
  // apply retroactively to uncategorised transactions
  const r = run(
    'UPDATE transactions SET category = ? WHERE category IS NULL AND lower(description) LIKE ?',
    category, `%${pattern.toLowerCase()}%`,
  );
  res.json({ categorised: Number(r.changes) });
});
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
interface ImportRow { date: string; amount: number; description: string }

app.post('/api/import', (req, res) => {
  const accountId = Number(req.body?.accountId);
  const rows = req.body?.rows as ImportRow[] | undefined;
  if (!one('SELECT id FROM accounts WHERE id = ?', accountId)) return bad(res, 'unknown account');
  if (!Array.isArray(rows)) return bad(res, 'rows required');

  const rules = all('SELECT pattern, category FROM category_rules ORDER BY id') as { pattern: string; category: string }[];
  const bills = all('SELECT * FROM bills WHERE active = 1 AND match_pattern IS NOT NULL') as BillRow[];
  const seen = new Map<string, number>();
  let added = 0, duplicates = 0, billsPaid = 0;

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  db.exec('BEGIN');
  try {
    for (const r of sorted) {
      if (typeof r.date !== 'string' || typeof r.amount !== 'number' || !Number.isFinite(r.amount)) continue;
      const description = str(r.description);
      const key = `${r.date}|${r.amount.toFixed(2)}|${description}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);

      const lower = description.toLowerCase();
      let category = rules.find((x) => lower.includes(x.pattern.toLowerCase()))?.category ?? null;
      const bill = r.amount < 0 ? bills.find((b) => lower.includes(String(b.match_pattern).toLowerCase())) : undefined;
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
  res.json({ added, duplicates, billsPaid });
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

app.get('/api/summary', (_req, res) => {
  const s = getSettings();
  const today = todayISO();
  const accts = all("SELECT * FROM accounts WHERE archived = 0 AND owner = 'personal'") as (Row & { kind: string; balance: number })[];
  const sum = (kind: string) => accts.filter((a) => a.kind === kind).reduce((t, a) => t + Number(a.balance), 0);
  const cash = sum('cash'), investments = sum('investment'), assets = sum('asset'), debt = sum('debt');
  const netWorth = cash + investments + assets + debt;
  const business = all("SELECT SUM(balance) AS b FROM accounts WHERE archived = 0 AND owner = 'business' AND kind = 'cash'")[0]?.b ?? 0;

  // last 6 full months + this month of personal income / expenses (transfers excluded)
  const from = addMonths(today.slice(0, 7) + '-01', -6);
  const months = all(
    `SELECT substr(t.date, 1, 7) AS month,
            SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
            SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS expenses
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.owner = 'personal' AND a.archived = 0 AND t.date >= ? AND COALESCE(t.category, '') <> 'Transfer'
     GROUP BY month ORDER BY month`, from,
  );
  const thisMonth = today.slice(0, 7);
  const byCategory = all(
    `SELECT COALESCE(t.category, 'Uncategorised') AS category, SUM(-t.amount) AS spent
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.owner = 'personal' AND a.archived = 0 AND t.amount < 0 AND substr(t.date, 1, 7) = ?
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
    today, netWorth, cash, investments, assets, debt, businessCash: Number(business),
    months, byCategory, avgMonthlyExpenses: avgMonthly, fire,
    bills: {
      dueNext30Days: upcoming.reduce((t, u) => t + u.amount, 0),
      overdueCount: overdue.length,
      overdueTotal: overdue.reduce((t, u) => t + u.amount, 0),
      next: upcoming.slice(0, 8).map((u) => ({ ...u, status: billStatus(u.date, today) })),
    },
  });
});

app.get('/api/networth-history', (_req, res) => {
  res.json(all(
    `SELECT s.month, SUM(s.balance) AS netWorth FROM balance_snapshots s
     JOIN accounts a ON a.id = s.account_id WHERE a.owner = 'personal' AND a.archived = 0
     GROUP BY s.month ORDER BY s.month`,
  ));
});

// ------------------------------------------------------------------ static UI (after `npm run build`)
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, '127.0.0.1', () => console.log(`Finance Planner API on http://127.0.0.1:${PORT}`));
