import { useState } from 'react';
import { api, fmtDate, fmtMoneyIn, fmtPct } from '../api.ts';
import { useGet } from '../hooks.ts';
import { payoff } from '../../shared/loan.ts';

interface Mortgage {
  configured: boolean; currency: string; principal: number; apr: number; years: number; extraMonthly: number; start: string;
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
    loanStart: s?.loanStart ?? '', loanExtraMonthly: s?.loanExtraMonthly ?? '0', loanCurrency: s?.loanCurrency ?? 'PLN',
  };
  const edit = (k: string, v: string) => setForm({ ...values, [k]: v });

  async function save() {
    await api('/settings', 'PUT', {
      loanPrincipal: Number(values.loanPrincipal) || 0,
      loanApr: (Number(values.loanApr.replace(',', '.')) || 0) / 100,
      loanYears: Number(values.loanYears) || 30,
      loanStart: values.loanStart,
      loanExtraMonthly: Number(values.loanExtraMonthly) || 0,
      loanCurrency: values.loanCurrency,
    });
    setForm(null); reload(); reloadSettings();
  }

  // the loan's own currency, whole units except the monthly payment
  const money = (exact: boolean, n: number) => fmtMoneyIn(n, m?.currency ?? 'PLN', exact);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Payoff calculator</h2>
        <div className="row">
          <label className="field">Amount borrowed<input value={values.loanPrincipal} onChange={(e) => edit('loanPrincipal', e.target.value)} /></label>
          <label className="field">Currency
            <select value={values.loanCurrency} onChange={(e) => edit('loanCurrency', e.target.value)}>
              {['PLN', 'EUR', 'GBP', 'USD'].map((c) => <option key={c}>{c}</option>)}</select></label>
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
            <div className="card"><h2>Monthly payment</h2><div className="big">{money(true, m.monthlyPayment)}</div>
              {m.extraMonthly > 0 && <div className="sub">+ {money(false, m.extraMonthly)} extra</div>}</div>
            <div className="card"><h2>Remaining balance</h2><div className="big">{money(false, m.remainingBalance)}</div>
              <div className="sub">{m.paymentsMade} of {m.payoffPayments} payments made ({fmtPct(1 - m.remainingBalance / m.principal)} repaid)</div></div>
            <div className="card"><h2>Total interest</h2><div className="big">{money(false, m.totalInterest)}</div>
              {m.interestSaved > 0 && <div className="sub good">Extra payments save {money(false, m.interestSaved)}</div>}</div>
            <div className="card"><h2>Paid off</h2><div className="big">{m.payoffDate ? fmtDate(m.payoffDate) : '—'}</div>
              <div className="sub">{(m.payoffPayments / 12).toFixed(1)} years in total</div></div>
          </div>
          <Overpaying m={m} money={money} />
          <div className="card scroll"><h2>Schedule</h2>
            <table>
              <thead><tr><th>#</th><th className="num">Balance</th><th className="num">Principal</th><th className="num">Interest</th><th className="num">Extra</th><th className="num">End balance</th></tr></thead>
              <tbody>{m.schedule.slice(0, showAll ? undefined : 24).map((r) => (
                <tr key={r.n} style={r.n === m.paymentsMade ? { fontWeight: 700 } : undefined}>
                  <td>{r.n}</td><td className="num">{money(false, r.balanceStart)}</td><td className="num">{money(false, r.principalPaid)}</td>
                  <td className="num">{money(false, r.interestPaid)}</td><td className="num">{r.extra ? money(false, r.extra) : ''}</td><td className="num">{money(false, r.balanceEnd)}</td>
                </tr>))}</tbody>
            </table>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show first 24' : `Show all ${m.schedule.length}`}</button>
          </div>
        </>)}
    </>
  );
}

const EXTRAS = [0, 100, 250, 500, 1000, 2000];

// the month `n` months after the first payment date, as "Apr 2045"
const monthAfter = (start: string, n: number) => {
  const total = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1 + n;
  return new Date(Math.floor(total / 12), total % 12, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};
const span = (months: number) => `${Math.floor(months / 12)} y ${months % 12} m`;

/** What paying more each month, or a lump sum now, does to what is left of the loan. */
function Overpaying({ m, money }: { m: Mortgage; money: (exact: boolean, n: number) => string }) {
  const { data: s } = useGet<{ fire: { returnRate: number } }>('/summary');
  const [lump, setLump] = useState('');
  const lumpSum = Math.max(0, Number(lump.replace(/\s/g, '').replace(',', '.')) || 0);
  const base = payoff(m.remainingBalance, m.apr, m.monthlyPayment);
  const extras = [...new Set([...EXTRAS, m.extraMonthly])].sort((a, b) => a - b);
  const rows = extras.map((extra) => ({ extra, ...payoff(m.remainingBalance, m.apr, m.monthlyPayment, extra, lumpSum) }));
  const ret = s?.fire.returnRate;
  return (
    <div className="card scroll" style={{ marginBottom: 12 }}>
      <div className="card-head">
        <div>
          <h2>Paying more</h2>
          <div className="sub">From today's balance of {money(false, m.remainingBalance)}, {span(base.payments)} and {money(false, base.interest)} of interest still to go.</div>
        </div>
        <label className="field inline">Lump sum now
          <input value={lump} onChange={(e) => setLump(e.target.value)} placeholder="0" style={{ width: 100 }} aria-label={`Lump sum, ${m.currency}`} /></label>
      </div>
      <table>
        <thead><tr><th className="num">Extra a month</th><th>Paid off</th><th className="num">Sooner by</th><th className="num">Interest to go</th><th className="num">Interest saved</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.extra} style={r.extra === m.extraMonthly ? { fontWeight: 700 } : undefined}>
            <td className="num">{r.extra ? money(false, r.extra) : 'None'}</td>
            <td>{m.start ? monthAfter(m.start, m.paymentsMade + r.payments - 1) : `${r.payments} payments`}</td>
            <td className="num">{base.payments - r.payments > 0 ? span(base.payments - r.payments) : '–'}</td>
            <td className="num">{money(false, r.interest)}</td>
            <td className="num good">{base.interest - r.interest >= 1 ? money(false, base.interest - r.interest) : '–'}</td>
          </tr>))}
        </tbody>
      </table>
      <div className="sub">
        Each row keeps the {money(true, m.monthlyPayment)} payment and adds the extra{lumpSum > 0 ? `, after ${money(false, lumpSum)} paid off today` : ''}; bold is what's set above.
        {ret !== undefined && <> Overpaying earns a sure {fmtPct(m.apr)} a year in interest not paid, against the {fmtPct(ret)} assumed for investments,
          {m.apr >= ret ? ' so on these numbers overpaying wins, before tax and any overpayment fee.' : ' which investing beats on these numbers, at more risk.'}</>}
      </div>
    </div>
  );
}
