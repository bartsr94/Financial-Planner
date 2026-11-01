// Turning a bank statement grid into importable lines. Shared by the Import page and scripts,
// so both build the same descriptions and a re-import dedupes. No Node or DOM imports.
import { parseAmount, parseCurrency, parseDate } from './parse.ts';

export interface StatementColumns { date: number; desc: number; amount: number; desc2: number; currency: number }
export interface StatementLine { date: string; amount: number; description: string; currency: string | null }

const find = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h.replace(/^[#\s"']+/, '')));

/**
 * Guess the columns from a header row. Where the bank has a counterparty column but no "Opis"
 * (Pekao's "Nadawca / Odbiorca") it leads the description and the title follows, since Pekao card
 * lines carry only the card number in the title.
 */
export function guessColumns(header: string[]): StatementColumns {
  const title = find(header, /opis|tytu|description|title|details/i);
  // mBank has both an "Opis operacji" and a counterparty column; its description stays the "Opis"
  const party = find(header, /opis/i) < 0 ? find(header, /nadawca|odbiorca|counterparty|payee/i) : -1;
  return {
    date: Math.max(0, find(header, /data|date/i)),
    desc: Math.max(0, party >= 0 ? party : title),
    desc2: party >= 0 ? title : -1,
    amount: Math.max(0, find(header, /kwota|amount/i)),
    currency: find(header, /^(waluta|currency)$/i),
  };
}

// mBank pads descriptions with runs of spaces, and tags card payments still pending; the tag disappears
// once they settle, which would otherwise make a re-import look like new transactions.
const tidy = (s: string) => s.replace(/transakcja nierozliczona/gi, '').replace(/\s+/g, ' ').trim();

/** The lines below the header row. The currency comes from the amount cell, else a currency column. */
export function statementLines(grid: string[][], headerRow: number, cols: StatementColumns): { lines: StatementLine[]; skipped: number } {
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const r of grid.slice(headerRow + 1)) {
    const date = parseDate(r[cols.date] ?? '');
    const amount = parseAmount(r[cols.amount] ?? '');
    if (!date || amount === null) { skipped++; continue; }
    const description = [r[cols.desc], cols.desc2 >= 0 ? r[cols.desc2] : ''].map((x) => tidy(x ?? '')).filter(Boolean).join(' · ');
    const currency = parseCurrency(r[cols.amount] ?? '') ?? (cols.currency >= 0 ? parseCurrency(r[cols.currency] ?? '') : null);
    lines.push({ date, amount, description, currency });
  }
  return { lines, skipped };
}
