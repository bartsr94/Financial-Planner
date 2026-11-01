import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = resolve(process.env.FP_DB ?? 'data/planner.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bank TEXT NOT NULL DEFAULT '',
  -- cash: counts as cash; investment: counts as investments; asset: property/vehicle; debt: negative balance
  kind TEXT NOT NULL CHECK (kind IN ('cash','investment','asset','debt')),
  owner TEXT NOT NULL DEFAULT 'personal' CHECK (owner IN ('personal','business')),
  currency TEXT NOT NULL DEFAULT 'PLN',
  balance REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','enable_banking')),
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month TEXT NOT NULL,            -- YYYY-MM
  balance REAL NOT NULL,
  PRIMARY KEY (account_id, month)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,             -- YYYY-MM-DD
  amount REAL NOT NULL,           -- negative = money out
  description TEXT NOT NULL DEFAULT '',
  category TEXT,
  hash TEXT NOT NULL,
  UNIQUE (account_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  amount_varies INTEGER NOT NULL DEFAULT 0,   -- utilities: amount is an estimate
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly','once')),
  next_due TEXT NOT NULL,                      -- YYYY-MM-DD
  category TEXT NOT NULL DEFAULT 'Misc',
  match_pattern TEXT,                          -- text found in the bank description of this payment
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  paid_date TEXT NOT NULL,
  amount REAL NOT NULL,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  category TEXT NOT NULL
);

-- NBP table A mid rates: PLN per 1 unit of currency, one row per business day
CREATE TABLE IF NOT EXISTS fx_rates (
  currency TEXT NOT NULL,
  date TEXT NOT NULL,             -- YYYY-MM-DD
  rate REAL NOT NULL,
  PRIMARY KEY (currency, date)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Migration: remember the day of month a bill is really due on, so a 31st bill survives short months.
if (!db.prepare("SELECT 1 FROM pragma_table_info('bills') WHERE name = 'anchor_day'").get()) {
  db.exec('ALTER TABLE bills ADD COLUMN anchor_day INTEGER');
  db.exec("UPDATE bills SET anchor_day = CAST(substr(next_due, 9, 2) AS INTEGER)");
}

// Defaults taken from the FIRE spreadsheet (SWR sheet).
const DEFAULTS: Record<string, string> = {
  withdrawalRate: '0.04',
  stockAllocation: '0.95',
  stockGrowth: '0.07',
  bondGrowth: '0.03',
  birthDate: '',
  retirementAge: '35',
  currentAge: '32',
  // mortgage (Amortization sheet)
  loanPrincipal: '0',
  loanApr: '0.035',
  loanYears: '30',
  loanStart: '',
  loanExtraMonthly: '0',
};
const seed = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULTS)) seed.run(k, v);

export const CATEGORIES = [
  'Housing', 'Gas (Home)', 'Electric', 'Internet', 'Insurance', 'Groceries', 'Eating Out',
  'Gas (Car)', 'Rideshare', 'Public Transit', 'Tolls', 'Entertainment', 'Clothing',
  'Self Care', 'Debt Repayment', 'Gym', 'Music', 'Education', 'Medical', 'Gifts',
  'Charity', 'Fees', 'Taxes', 'Income', 'Transfer', 'Misc',
] as const;

export function getSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
