import { useState } from 'react';
import { fmtMoney, fmtPct } from '../api.ts';
import { useGet } from '../hooks.ts';
import { BarChart, Legend, monthLabel, type Series } from '../charts.tsx';

interface BusinessMonth { month: string; revenue: number; costs: number; taxes: number; paidOut: number; kept: number; cash: number }
interface Business { months: BusinessMonth[]; costsByCategory: { category: string; amount: number }[] }

const RANGES = [['6', '6M'], ['12', '12M'], ['24', '2Y']] as const;
// fixed categorical order: revenue, then where it went
const PARTS = [
  ['revenue', 'Revenue', 'var(--series-1)'], ['costs', 'Costs', 'var(--series-2)'],
  ['taxes', 'Taxes', 'var(--series-4)'], ['paidOut', 'Paid to you', 'var(--series-3)'],
] as const;

/** The business accounts on their own: what came in, what it cost, the taxes, and what you took out. */
export function Business() {
  const [range, setRange] = useState(() => localStorage.getItem('businessRange') ?? '12');
  const { data: b, error } = useGet<Business>(`/business?months=${range}`);
  const pick = (r: string) => { setRange(r); localStorage.setItem('businessRange', r); };

  if (error) return <p className="error">{error}</p>;
  if (!b) return <div className="muted">Loading…</div>;
  const total = (k: keyof Omit<BusinessMonth, 'month' | 'cash'>) => b.months.reduce((t, m) => t + m[k], 0);
  const revenue = total('revenue');
  const series: Series[] = PARTS.map(([key, label, color]) => ({ key, label, color, values: b.months.map((m) => m[key]) }));
  const span = `${monthLabel(b.months[0].month, true)} – ${monthLabel(b.months.at(-1)!.month, true)}`;
  const share = (n: number) => (revenue > 0 ? <>{fmtPct(n / revenue)} of revenue</> : <>&nbsp;</>);
  const costTotal = b.costsByCategory.reduce((t, c) => t + c.amount, 0);

  return (
    <>
      <div className="card-head">
        <div className="sub">{span}, business accounts only, in złoty at each day's rate.</div>
        <div className="segmented" role="group" aria-label="Range">
          {RANGES.map(([v, label]) => <button key={v} className={range === v ? 'on' : ''} onClick={() => pick(v)}>{label}</button>)}
        </div>
      </div>
      <div className="grid">
        <div className="card kpi"><h2>Revenue</h2><div className="big">{fmtMoney(revenue)}</div><div className="sub">{fmtMoney(revenue / b.months.length)} a month</div></div>
        <div className="card kpi"><h2>Costs</h2><div className="big">{fmtMoney(total('costs'))}</div><div className="sub">{share(total('costs'))}</div></div>
        <div className="card kpi"><h2>Taxes</h2><div className="big">{fmtMoney(total('taxes'))}</div><div className="sub">{share(total('taxes'))}</div></div>
        <div className="card kpi"><h2>Paid to you</h2><div className="big">{fmtMoney(total('paidOut'))}</div><div className="sub">{share(total('paidOut'))}</div></div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Month by month</h2><Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /></div>
        <BarChart months={b.months.map((m) => m.month)} series={series} format={fmtMoney} height={240}
          tooltipExtra={(i) => <>
            <div className="tt-row total"><span /><span>Kept</span><b>{fmtMoney(b.months[i].kept)}</b></div>
            <div className="tt-row"><span /><span>Cash at month end</span><b>{fmtMoney(b.months[i].cash)}</b></div>
          </>} />
      </div>

      <div className="cols-2">
        <div className="card scroll">
          <h2>The numbers</h2>
          <table>
            <thead><tr><th>Month</th><th className="num">Revenue</th><th className="num">Costs</th><th className="num">Taxes</th><th className="num">Paid to you</th><th className="num">Kept</th><th className="num">Cash</th></tr></thead>
            <tbody>{[...b.months].reverse().map((m) => (
              <tr key={m.month}>
                <td className="nowrap">{monthLabel(m.month, true)}</td>
                <td className="num">{fmtMoney(m.revenue)}</td><td className="num">{fmtMoney(m.costs)}</td>
                <td className="num">{fmtMoney(m.taxes)}</td><td className="num">{fmtMoney(m.paidOut)}</td>
                <td className={`num ${m.kept >= 0 ? 'good' : 'bad'}`}>{fmtMoney(m.kept)}</td><td className="num">{fmtMoney(m.cash)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <div className="card">
          <h2>Costs by category</h2>
          {b.costsByCategory.length === 0 ? <div className="muted">No costs in this range.</div> : (
            <table className="cat-table"><tbody>
              {b.costsByCategory.slice(0, 12).map((c) => (
                <tr key={c.category}>
                  <td className="cat-name">{c.category}</td>
                  <td className="cat-bar"><div className="bar"><div style={{ width: `${(c.amount / b.costsByCategory[0].amount) * 100}%` }} /></div></td>
                  <td className="num">{fmtMoney(c.amount)}</td>
                  <td className="num muted">{costTotal > 0 ? fmtPct(c.amount / costTotal) : ''}</td>
                </tr>))}
            </tbody></table>)}
          <div className="sub">Personal spending paid from a business account counts as a cost here. Taxes are lines filed under Taxes, and payments to the tax office, ZUS and VAT transfers.</div>
        </div>
      </div>
      <div className="sub">Paid to you is money moved by transfer out of the business accounts, less what came back; moves between two business accounts cancel out. Kept is revenue less the other three.</div>
    </>
  );
}
