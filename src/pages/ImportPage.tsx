import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { api, fmtMoneyExact, type Account } from '../api.ts';
import { useGet } from '../hooks.ts';
import { parseAmount, parseDate } from '../../shared/parse.ts';

const guess = (header: string[], re: RegExp) => Math.max(0, header.findIndex((h) => re.test(h)));

// Papa's auto-detect is thrown by preamble lines (mBank has tab-indented address lines), so pick the
// delimiter by how many lines contain it. Decimal commas are in every row, so ';' and tab get first say.
function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (const d of [';', '\t']) {
    if (lines.filter((l) => l.includes(d)).length > lines.length / 2) return d;
  }
  return ',';
}

// mBank pads descriptions with runs of spaces, and tags card payments still pending; the tag disappears
// once they settle, which would otherwise make a re-import look like new transactions.
const tidy = (s: string) => s.replace(/transakcja nierozliczona/gi, '').replace(/\s+/g, ' ').trim();

export function ImportPage() {
  const { data: accounts } = useGet<Account[]>('/accounts');
  const [accountId, setAccountId] = useState('');
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [encoding, setEncoding] = useState('utf-8');
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [cols, setCols] = useState({ date: 0, desc: 0, amount: 0, desc2: -1 });
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const grid = useMemo<string[][]>(() => {
    if (!buffer) return [];
    const text = new TextDecoder(encoding).decode(buffer);
    return Papa.parse<string[]>(text, { skipEmptyLines: true, delimiter: detectDelimiter(text) }).data;
  }, [buffer, encoding]);

  // Auto-detect the header row (banks add preamble lines) and guess the columns.
  const autoHeader = useMemo(() => {
    // mBank prefixes header cells with "#", so strip that and quotes before looking for date + amount columns.
    const clean = (c: string) => c.replace(/^[#\s"']+/, '');
    const i = grid.findIndex((r) => r.some((c) => /^(data|date)/i.test(clean(c))) && r.some((c) => /kwota|amount/i.test(clean(c))));
    return i >= 0 ? i : 0;
  }, [grid]);
  const hdr = headerRow ?? autoHeader;
  const header = grid[hdr] ?? [];

  // Re-guess the columns whenever a new file or header row is chosen.
  useEffect(() => {
    if (header.length) setCols({
      date: guess(header, /data|date/i), desc: guess(header, /opis|tytu|description|title|details/i),
      amount: guess(header, /kwota|amount/i), desc2: -1,
    });
  }, [grid, hdr]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const out: { date: string; amount: number; description: string }[] = [];
    let skipped = 0;
    for (const r of grid.slice(hdr + 1)) {
      const date = parseDate(r[cols.date] ?? '');
      const amount = parseAmount(r[cols.amount] ?? '');
      if (!date || amount === null) { skipped++; continue; }
      const description = [r[cols.desc], cols.desc2 >= 0 ? r[cols.desc2] : ''].map((x) => tidy(x ?? '')).filter(Boolean).join(' · ');
      out.push({ date, amount, description });
    }
    return { out, skipped };
  }, [grid, hdr, cols]);

  function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name); setResult(''); setError(''); setHeaderRow(null);
    f.arrayBuffer().then((b) => {
      setBuffer(b);
      // bank exports are often windows-1250; if UTF-8 decoding produces replacement characters, switch.
      const utf8 = new TextDecoder('utf-8').decode(b);
      setEncoding(utf8.includes('�') ? 'windows-1250' : 'utf-8');
    });
  }

  function applyGuess() {
    setCols({
      date: guess(header, /data|date/i),
      desc: guess(header, /opis|tytu|description|title|details/i),
      amount: guess(header, /kwota|amount/i),
      desc2: -1,
    });
  }

  async function doImport() {
    setBusy(true); setError(''); setResult('');
    try {
      const r = await api<{ added: number; duplicates: number; billsPaid: number }>('/import', 'POST', { accountId: Number(accountId), rows: rows.out });
      setResult(`Imported ${r.added} new transactions. ${r.duplicates} were already there. ${r.billsPaid} bill(s) marked paid.`);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Import a bank statement (CSV)</h2>
        <div className="row">
          <label className="field">Into account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Choose…</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.owner === 'business' ? ' (business)' : ''}</option>)}
            </select></label>
          <label className="field">File<input type="file" accept=".csv,.txt" onChange={(e) => onFile(e.target.files?.[0])} /></label>
          {buffer && <label className="field">Encoding
            <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
              <option value="utf-8">UTF-8</option><option value="windows-1250">Windows-1250 (Polish banks)</option></select></label>}
        </div>
        <div className="sub">Importing the same period twice is safe: lines already in the app are skipped.</div>
      </div>

      {grid.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h2>{fileName}: match the columns</h2>
          <div className="row">
            <label className="field">Header row
              <select value={hdr} onChange={(e) => { setHeaderRow(Number(e.target.value)); }}>
                {grid.slice(0, 40).map((r, i) => <option key={i} value={i}>{i + 1}: {r.slice(0, 3).join(' | ').slice(0, 50)}</option>)}</select></label>
            <button className="btn" onClick={applyGuess}>Auto-detect columns</button>
          </div>
          <div className="row">
            {([['date', 'Date'], ['amount', 'Amount (+ in / − out)'], ['desc', 'Description'], ['desc2', 'More description (optional)']] as const).map(([k, label]) => (
              <label className="field" key={k}>{label}
                <select value={cols[k]} onChange={(e) => setCols({ ...cols, [k]: Number(e.target.value) })}>
                  {k === 'desc2' && <option value={-1}>none</option>}
                  {header.map((h, i) => <option key={i} value={i}>{i + 1}: {h.slice(0, 30)}</option>)}</select></label>))}
          </div>
          <div className="sub">
            {rows.out.length} usable rows{rows.skipped ? `, ${rows.skipped} skipped (no valid date or amount)` : ''}. Preview:
          </div>
          <div className="scroll"><table>
            <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr></thead>
            <tbody>{rows.out.slice(0, 6).map((r, i) => (
              <tr key={i}><td>{r.date}</td><td>{r.description.slice(0, 90)}</td><td className="num">{fmtMoneyExact(r.amount)}</td></tr>))}</tbody>
          </table></div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={busy || !accountId || rows.out.length === 0} onClick={doImport}>
              Import {rows.out.length} rows</button>
            {!accountId && <span className="muted">Choose an account first.</span>}
          </div>
        </div>)}
      {result && <div className="ok">{result}</div>}
      {error && <div className="error">{error}</div>}
    </>
  );
}
