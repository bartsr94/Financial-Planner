// Parser for a bank's loan history ("Historia kredytu") export. No Node or DOM imports.
import { parseAmount, parseDate } from './parse.ts';

export type LoanEventKind = 'drawdown' | 'principal' | 'interest';

/** One line of a loan history. `balanceAfter` is what is still owed after it, known for drawdowns and principal. */
export interface LoanEvent { date: string; kind: LoanEventKind; amount: number; balanceAfter: number | null; description: string }

// mBank lines: "otwarcie kredytu - kapitał", "spłata raty - kapitał|odsetki", "częśc.spłata kredytu - kapitał|odsetki".
// Matched without the Polish letters, which arrive mangled when the file is read with the wrong encoding.
function kindOf(description: string): LoanEventKind | null {
  const d = description.toLowerCase();
  if (/kapita/.test(d)) return /otwarcie|uruchomienie|wyp.ata/.test(d) ? 'drawdown' : 'principal';
  if (/odsetk/.test(d)) return 'interest';
  return null; // "zmiana wysokości odsetek" and other zero-amount notices
}

/** A loan history CSV from mBank or Pekao, whichever it is. */
export function parseLoanHistory(text: string): LoanEvent[] {
  const rows = text.split(/\r?\n/).map((l) => l.split(';').map((c) => c.trim().replace(/^"|"$/g, '')));
  const mbank = parseMbankLoan(rows);
  return mbank.length ? mbank : parsePekaoLoan(rows);
}

/**
 * Lines of an mBank "Historia kredytu" CSV (semicolon-separated, header starting "#Data"):
 * date; booking date; description; amount; currency; amount still owed; currency.
 * Zero-amount notices and lines that are not principal or interest are dropped.
 */
function parseMbankLoan(rows: string[][]): LoanEvent[] {
  const head = rows.findIndex((r) => /^#?data/i.test(r[0] ?? '') && r.some((c) => /kwota/i.test(c)));
  if (head < 0) return [];
  const h = rows[head].map((c) => c.replace(/^#/, '').toLowerCase());
  const col = { date: 0, desc: h.findIndex((c) => c.startsWith('opis')), amount: h.findIndex((c) => c === 'kwota'), left: h.findIndex((c) => /pozosta/.test(c)) };
  if (col.desc < 0 || col.amount < 0) return [];
  const out: LoanEvent[] = [];
  for (const r of rows.slice(head + 1)) {
    const date = parseDate(r[col.date] ?? '');
    const amount = parseAmount(r[col.amount] ?? '');
    const description = (r[col.desc] ?? '').trim();
    const kind = kindOf(description);
    if (!date || amount === null || amount === 0 || !kind) continue;
    const left = col.left >= 0 ? parseAmount(r[col.left] ?? '') : null;
    out.push({ date, kind, amount: Math.abs(amount), balanceAfter: kind === 'interest' ? null : left, description });
  }
  return out;
}

/**
 * Lines of a Pekao loan "Lista operacji" CSV: booking date; operation type; amount with currency;
 * capital still owed. A payment line does not split itself, so the fall in capital owed since the
 * line before is its principal and the rest of the payment is interest.
 */
function parsePekaoLoan(rows: string[][]): LoanEvent[] {
  const head = rows.findIndex((r) => r.some((c) => /^kapita. do sp.aty/i.test(c)));
  if (head < 0) return [];
  const h = rows[head].map((c) => c.toLowerCase());
  const col = { date: h.findIndex((c) => c.startsWith('data')), type: h.findIndex((c) => c.startsWith('typ')), amount: h.findIndex((c) => /^warto/.test(c)), left: h.findIndex((c) => /^kapita/.test(c)) };
  if (col.date < 0 || col.type < 0 || col.amount < 0) return [];
  const lines = rows.slice(head + 1)
    .map((r) => ({ date: parseDate(r[col.date] ?? ''), type: (r[col.type] ?? '').trim(), amount: parseAmount(r[col.amount] ?? ''), left: parseAmount(r[col.left] ?? '') }))
    .filter((l): l is { date: string; type: string; amount: number; left: number | null } => !!l.date && l.amount !== null && l.amount !== 0)
    .reverse(); // the file is newest first
  const out: LoanEvent[] = [];
  let owed: number | null = null;
  for (const l of lines) {
    const amount = Math.abs(l.amount);
    if (/advance|uruchomienie|wyp.ata/i.test(l.type)) {
      out.push({ date: l.date, kind: 'drawdown', amount, balanceAfter: l.left, description: l.type });
    } else if (owed !== null && l.left !== null) {
      const principal = Math.round((owed - l.left) * 100) / 100;
      out.push({ date: l.date, kind: 'principal', amount: principal, balanceAfter: l.left, description: `${l.type} - capital` });
      const interest = Math.round((amount - principal) * 100) / 100;
      if (interest > 0) out.push({ date: l.date, kind: 'interest', amount: interest, balanceAfter: null, description: `${l.type} - interest` });
    } else continue;
    owed = l.left;
  }
  return out;
}
