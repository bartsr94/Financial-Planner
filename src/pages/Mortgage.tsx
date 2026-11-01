import { useState } from 'react';
import { api, fmtDate, fmtMoney, fmtMoneyExact, fmtPct } from '../api.ts';
import { useGet } from '../hooks.ts';

interface Mortgage {
  configured: boolean; principal: number; apr: number; years: number; extraMonthly: number; start: string;
  monthlyPayment: number; totalInterest: number; interestSaved: number; payoffPayments: number;
  paymentsMade: number; remainingBalance: number; payoffDate: string | null;
  schedule: { n: number; balanceStart: number; principalPaid: number; interestPaid: number; extra: number; balanceEnd: number }[];
}

export function Mortgage() {
  const { data: m, error, reload } = useGet<Mortgage>('/mortgage');
  const { data: s, reload: reloadSettings } = useGet<Record<string, string>>('/settings');
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [showAll, setShowAll] = useState(false);

  const values = form ?? {
    loanPrincipal: s?.loanPrincipal ?? '0', loanApr: String(Number(s?.loanApr ?? 0.035) * 100), loanYears: s?.loanYears ?? '30',
    loanStart: s?.loanStart ?? '', loanExtraMonthly: s?.loanExtraMonthly ?? '0',
  };
  const edit = (k: string, v: string) => setForm({ ...values, [k]: v });

  async function save() {
    await api('/settings', 'PUT', {
      loanPrincipal: Number(values.loanPrincipal) || 0,
      loanApr: (Number(values.loanApr.replace(',', '.')) || 0) / 100,
      loanYears: Number(values.loanYears) || 30,
      loanStart: values.loanStart,
      loanExtraMonthly: Number(values.loanExtraMonthly) || 0,
    });
    setForm(null); reload(); reloadSettings();
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Payoff calculator</h2>
        <div className="row">
          <label className="field">Amount borrowed (PLN)<input value={values.loanPrincipal} onChange={(e) => edit('loanPrincipal', e.target.value)} /></label>
          <label className="field">Interest rate (% a year)<input value={values.loanApr} onChange={(e) => edit('loanApr', e.target.value)} style={{ width: 90 }} /></label>
          <label className="field">Term (years)<input value={values.loanYears} onChange={(e) => edit('loanYears', e.target.value)} style={{ width: 70 }} /></label>
          <label className="field">First payment date<input type="date" value={values.loanStart} onChange={(e) => edit('loanStart', e.target.value)} /></label>
          <label className="field">Extra per month<input value={values.loanExtraMonthly} onChange={(e) => edit('loanExtraMonthly', e.target.value)} style={{ width: 90 }} /></label>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
        <div className="sub">Fixed-rate, equal-payment schedule, the same maths as the Amortization sheet. Variable-rate loans (WIBOR) will differ: update the rate when it resets.</div>
      </div>

      {m?.configured && (
        <>
          <div className="grid">
            <div className="card"><h2>Monthly payment</h2><div className="big">{fmtMoneyExact(m.monthlyPayment)}</div>
              {m.extraMonthly > 0 && <div className="sub">+ {fmtMoney(m.extraMonthly)} extra</div>}</div>
            <div className="card"><h2>Remaining balance</h2><div className="big">{fmtMoney(m.remainingBalance)}</div>
              <div className="sub">{m.paymentsMade} of {m.payoffPayments} payments made ({fmtPct(1 - m.remainingBalance / m.principal)} repaid)</div></div>
            <div className="card"><h2>Total interest</h2><div className="big">{fmtMoney(m.totalInterest)}</div>
              {m.interestSaved > 0 && <div className="sub good">Extra payments save {fmtMoney(m.interestSaved)}</div>}</div>
            <div className="card"><h2>Paid off</h2><div className="big">{m.payoffDate ? fmtDate(m.payoffDate) : '—'}</div>
              <div className="sub">{(m.payoffPayments / 12).toFixed(1)} years in total</div></div>
          </div>
          <div className="card scroll"><h2>Schedule</h2>
            <table>
              <thead><tr><th>#</th><th className="num">Balance</th><th className="num">Principal</th><th className="num">Interest</th><th className="num">Extra</th><th className="num">End balance</th></tr></thead>
              <tbody>{m.schedule.slice(0, showAll ? undefined : 24).map((r) => (
                <tr key={r.n} style={r.n === m.paymentsMade ? { fontWeight: 700 } : undefined}>
                  <td>{r.n}</td><td className="num">{fmtMoney(r.balanceStart)}</td><td className="num">{fmtMoney(r.principalPaid)}</td>
                  <td className="num">{fmtMoney(r.interestPaid)}</td><td className="num">{r.extra ? fmtMoney(r.extra) : ''}</td><td className="num">{fmtMoney(r.balanceEnd)}</td>
                </tr>))}</tbody>
            </table>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show first 24' : `Show all ${m.schedule.length}`}</button>
          </div>
        </>)}
    </>
  );
}
