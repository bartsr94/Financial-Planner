import { useState } from 'react';
import { api, fmtDate, fmtMoney } from '../api.ts';
import { useGet } from '../hooks.ts';
import { Legend, LineChart, type LineSeries } from '../charts.tsx';
import { BalanceHistory } from '../BalanceHistory.tsx';
import { Mortgage } from './Mortgage.tsx';

interface Loan {
  id: number; name: string; bank: string; currency: string; balance: number; owed: number; fromStatement: boolean;
  totals: { borrowed: number; principalRepaid: number; interestPaid: number; principalLast12: number; interestLast12: number; owed: number | null; firstDate: string | null; lastDate: string | null } | null;
  history: { month: string; owed: number | null; recorded: boolean }[];
}

/** A statement file as text: UTF-8 if it is valid UTF-8, else the Windows-1250 Polish banks export. */
async function readStatement(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1250').decode(bytes); }
}

export function Loans() {
  const { data: loans, error, reload } = useGet<Loan[]>('/loans');
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<Record<number, string>>({});

  async function importStatement(loan: Loan, file: File | undefined) {
    if (!file) return;
    try {
      const r = await api<{ added: number; duplicates: number; owed: number | null }>(`/loans/${loan.id}/statement`, 'POST', { text: await readStatement(file) });
      setMsg({ ...msg, [loan.id]: `${r.added} lines added, ${r.duplicates} already known.${r.owed !== null ? ` Owed now: ${fmtMoney(r.owed)}.` : ''}` });
      reload();
    } catch (e) { setMsg({ ...msg, [loan.id]: (e as Error).message }); }
  }

  if (error) return <p className="error">{error}</p>;
  if (!loans) return <p className="muted">Loading…</p>;

  // one line per loan over the months any of them has a balance for
  const months = [...new Set(loans.flatMap((l) => l.history.map((h) => h.month)))].sort();
  const series: LineSeries[] = loans.map((l, i) => ({
    key: String(l.id), label: l.name, color: `var(--series-${(i % 7) + 1})`,
    values: months.map((m) => l.history.find((h) => h.month === m)?.owed ?? null),
  }));
  const total = loans.reduce((t, l) => t + l.owed, 0);

  return (
    <>
      {loans.length === 0 && <div className="card muted" style={{ marginBottom: 12 }}>No loans yet. Add each one on <b>Accounts</b> as a Debt account, then come back to import its history.</div>}

      {months.length > 1 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head">
            <h2>Owed over time</h2>
            {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
          </div>
          <LineChart months={months} series={series} format={fmtMoney} height={240} />
          <div className="sub">{fmtMoney(total)} owed in total today.</div>
        </div>)}

      {loans.map((l) => (
        <div className="card" key={l.id} style={{ marginBottom: 12 }}>
          <div className="card-head">
            <h2>{l.name}</h2>
            <span className="muted small">{l.fromStatement ? `From the bank statement${l.totals?.lastDate ? `, last line ${fmtDate(l.totals.lastDate)}` : ''}` : 'Balances recorded by hand'}</span>
          </div>
          <div className="grid">
            <div><div className="sub">Owed now</div><div className="big">{fmtMoney(l.owed)}</div></div>
            {l.totals && <>
              <div><div className="sub">Borrowed</div><div className="big">{fmtMoney(l.totals.borrowed)}</div>
                {l.totals.firstDate && <div className="sub">{fmtDate(l.totals.firstDate)}</div>}</div>
              <div><div className="sub">Repaid</div><div className="big">{fmtMoney(l.totals.principalRepaid)}</div>
                <div className="sub">{fmtMoney(l.totals.principalLast12)} in the last 12 months</div></div>
              <div><div className="sub">Interest paid</div><div className="big">{fmtMoney(l.totals.interestPaid)}</div>
                <div className="sub">{fmtMoney(l.totals.interestLast12)} in the last 12 months</div></div>
            </>}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="btn">Import loan history (CSV)
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { importStatement(l, e.target.files?.[0]); e.target.value = ''; }} /></label>
            <button className="btn" onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Hide monthly balances' : 'Monthly balances'}</button>
          </div>
          {msg[l.id] && <div className="sub">{msg[l.id]}</div>}
          {!l.fromStatement && <div className="sub">mBank: Kredyty → the loan → Historia → export CSV. Until then, record what is owed each month by hand.</div>}
          {open === l.id && <BalanceHistory account={{ ...l, kind: 'debt' }} onChange={reload} />}
        </div>))}

      <Mortgage />
    </>
  );
}
