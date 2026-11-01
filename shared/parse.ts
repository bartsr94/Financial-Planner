// Statement-parsing helpers shared by the browser preview and the server. No Node or DOM imports.

/** "1 234,56", "-1.234,56", "1,234.56", "−12,00 PLN" -> number. Returns null if it isn't a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\u00a0/g, ' ').replace(/[−–]/g, '-').replace(/[A-Za-z]/g, '').replace(/\s/g, '').trim();
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // whichever comes last is the decimal separator
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-10-31", "31-10-2026", "31.10.2026", "31/10/2026" -> YYYY-MM-DD. */
export function parseDate(raw: string): string | null {
  const s = raw.trim().slice(0, 10);
  let m = /^(\d{4})[-./](\d{2})[-./](\d{2})$/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{2})[-./](\d{2})[-./](\d{4})$/.exec(s);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  return null;
}

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
