import { useMemo } from 'react';
import { fmtDate, fmtMoney } from '../api.ts';
import { useGet } from '../hooks.ts';
import { BarChart, Legend, monthLabel, type Series } from '../charts.tsx';
import { Empty, MonthHeader, colorFor, soFar, useMonthView } from '../monthView.tsx';
import { SkeletonPage, SkeletonRows } from '../Skeleton.tsx';
import { navigate } from '../route.ts';

/** Where the money went: a month's spending by category, what stood out, and each category month by month. */
export function Spending() {
  const view = useMonthView();
  const { t, owner, sel, cur, prev, months, selectMonth } = view;

  // full category breakdown for the selected month, compared with the month before
  const breakdown = useMemo(() => {
    if (!t || !cur) return [];
    const spentIn = (m?: string) => new Map(t.rows.filter((r) => r.month === m && r.expenses > 0).map((r) => [r.category, r.expenses]));
    const now = spentIn(cur.month), before = spentIn(prev?.month);
    return [...now.entries()].sort((a, b) => b[1] - a[1]).map(([category, spent]) => ({ category, spent, before: before.get(category) ?? 0 }));
  }, [t, cur, prev]);

  if (view.error) return <p className="error">{view.error}</p>;
  if (!t) return <><MonthHeader title="Spending" view={view} /><SkeletonPage cards={2} /></>;

  const catSeries: Series[] = t.categories.map((c) => ({ key: c, label: c, color: colorFor(t.categories, c), values: t.months.map((m) => m.byCategory[c] ?? 0) }));
  const maxCat = Math.max(1, ...breakdown.map((b) => b.spent));
  const total = breakdown.reduce((s, b) => s + b.spent, 0);
  const label = cur ? monthLabel(cur.month, true) + soFar(cur.month) : '…';
  // a category's lines for the month, on the Transactions page
  const lines = (category: string) => {
    if (!cur) return;
    const [y, m] = cur.month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const q = new URLSearchParams({ category: category === 'Uncategorised' ? '__none' : category, from: `${cur.month}-01`, to: `${cur.month}-${last}` });
    if (owner !== 'all') q.set('account', owner);
    navigate(`/transactions?${q}`);
  };

  return (
    <>
      <MonthHeader title="Spending" view={view} />

      <div className="cols-2">
        <div className="card">
          <div className="card-head">
            <h2>Spending in {label}</h2>
            {cur && <span className="sub"><b>{fmtMoney(total)}</b> in {breakdown.length} categories</span>}
          </div>
          {breakdown.length === 0 ? <div className="muted">No spending recorded in this month.</div> : (
            <table className="cat-table"><tbody>
              {breakdown.map((b) => {
                const delta = b.spent - b.before;
                return (
                  <tr key={b.category} className="clickable" tabIndex={0} onClick={() => lines(b.category)}
                    onKeyDown={(e) => { if (e.key === 'Enter') lines(b.category); }} title={`See ${b.category} lines for ${label}`}>
                    <td className="cat-name"><span className="swatch" style={{ background: colorFor(t.categories, b.category) }} />{b.category}</td>
                    <td className="cat-bar"><div className="bar"><div style={{ width: `${(b.spent / maxCat) * 100}%` }} /></div></td>
                    <td className="num">{fmtMoney(b.spent)}</td>
                    <td className="num delta">{prev && Math.abs(delta) >= 1
                      ? <span className={delta > 0 ? 'bad' : 'good'} title={`${fmtMoney(b.before)} in ${monthLabel(prev.month)}`}>{delta > 0 ? '▲' : '▼'} {fmtMoney(Math.abs(delta))}</span>
                      : <span className="muted">–</span>}</td>
                  </tr>);
              })}
            </tbody></table>)}
          <div className="sub">{prev && breakdown.length > 0 && <>Arrows compare with {monthLabel(prev.month, true)}. </>}Click a category to see its lines.</div>
        </div>
        {cur ? <StoodOut month={cur.month} owner={owner} label={label} /> : <div />}
      </div>

      <div className="card">
        <div className="card-head"><h2>Where the money went</h2></div>
        {catSeries.length
          ? <>
              <BarChart months={months} series={catSeries} stacked format={fmtMoney} selected={sel} onSelect={selectMonth} height={280} />
              <Legend items={catSeries.map((x) => ({ label: x.label, color: x.color }))} />
            </>
          : <Empty />}
      </div>
    </>
  );
}

interface Insights {
  month: string;
  unusual: { category: string; spent: number; usual: number; diff: number }[];
  biggest: { id: number; date: string; description: string; category: string; amount: number; account: string }[];
  recurring: { count: number; monthly: number; top: { key: string; monthly: number; frequency: string }[] };
}

/** What stands out in a month's spending: categories off their usual, the biggest payments, and regular payments. */
function StoodOut({ month, owner, label }: { month: string; owner: string; label: string }) {
  const { data: d } = useGet<Insights>(`/insights?month=${month}&owner=${owner}`);
  if (!d || d.month !== month) return <div className="card"><h2>What stood out in {label}</h2><SkeletonRows rows={8} /></div>;
  return (
    <div className="card">
      <h2>What stood out in {label}</h2>
      {d.unusual.length === 0 ? <div className="sub">Every category was close to its usual month.</div> : (
        <table className="compact"><tbody>
          {d.unusual.map((u) => (
            <tr key={u.category}>
              <td>{u.category}</td>
              <td className="num">{fmtMoney(u.spent)}</td>
              <td className="num"><span className={u.diff > 0 ? 'bad' : 'good'}>{u.diff > 0 ? '▲' : '▼'} {fmtMoney(Math.abs(u.diff))}</span>
                <div className="sub nowrap">usually {fmtMoney(u.usual)}</div></td>
            </tr>))}
        </tbody></table>)}
      {d.biggest.length > 0 && <>
        <h3>Biggest payments</h3>
        <table className="compact"><tbody>
          {d.biggest.map((b) => (
            <tr key={b.id}>
              <td className="nowrap muted">{fmtDate(b.date)}</td>
              <td className="tx-desc" title={b.description}>{b.description}<div className="sub">{b.category} · {b.account}</div></td>
              <td className="num">{fmtMoney(b.amount)}</td>
            </tr>))}
        </tbody></table>
      </>}
      {d.recurring.count > 0 && <div className="sub">
        Regular payments: <b>{fmtMoney(d.recurring.monthly)}</b> a month across {d.recurring.count}, the largest {d.recurring.top.slice(0, 3).map((r) => r.key).join(', ')}.
      </div>}
      <div className="sub">Usual is the median of the six months before. A category stands out when it is 25% and 300 zł off it.</div>
    </div>
  );
}
