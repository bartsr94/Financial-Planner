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

/**
 * Lines of an mBank "Historia kredytu" CSV (semicolon-separated, header starting "#Data"):
 * date; booking date; description; amount; currency; amount still owed; currency.
 * Zero-amount notices and lines that are not principal or interest are dropped.
 */
export function parseLoanHistory(text: string): LoanEvent[] {
  const rows = text.split(/\r?\n/).map((l) => l.split(';').map((c) => c.trim().replace(/^"|"$/g, '')));
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
