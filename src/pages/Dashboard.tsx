import { useEffect, useMemo, useState } from 'react';
import { fmtDate, fmtMoney, fmtPct } from '../api.ts';
import { useGet } from '../hooks.ts';
import { projectFire } from '../../shared/fire.ts';
import { BarChart, Legend, LineChart, Sparkline, monthLabel, type LineSeries, type Series } from '../charts.tsx';

interface Summary {
  netWorth: number; cash: number; investments: number; assets: number; debt: number; businessCash: number; missingRates: string[];
  avgMonthlyExpenses: number;
  fire: Fire;
  bills: { dueNext30Days: number; overdueCount: number; overdueTotal: number; next: { id: number; name: string; amount: number; date: string; status: string }[] };
}
interface Fire {
  fiNumber: number; leanFi: number; fatFi: number; coastFi: number; percentToFi: number; investedCoversYearly: number;
  coastReached: boolean; returnRate: number; currentAge: number; retirementAge: number;
}
interface MonthTrend { month: string; income: number; expenses: number; net: number; savingsRate: number | null; byCategory: Record<string, number> }
interface Trends {
  months: MonthTrend[]; categories: string[]; latestWithData: string | null; owner: string;
  rows: { month: string; category: string; income: number; expenses: number }[];
}

// Categorical slots in fixed order (see styles.css); "Other" is always the neutral.
const colorFor = (categories: string[], c: string) => {
  if (c === 'Uncategorised') return 'var(--series-uncat)';
  const named = categories.filter((x) => x !== 'Uncategorised' && x !== 'Other');
  return named.includes(c) ? `var(--series-${named.indexOf(c) + 1})` : 'var(--series-other)';
};
interface Forecast {
  owner: string; today: string; cash: number; basis: string[]; income: number; spending: number;
  months: { month: string; income: number; spending: number; balance: number; bills: number; billCount: number }[];
}
interface NetWorthMonth { month: string; cash: number; investments: number; assets: number; debt: number; netWorth: number }

const RANGES = [['6', '6M'], ['12', '12M'], ['24', '2Y'], ['0', 'All']] as const;
const NW_VIEWS = [['net', 'Net worth'], ['parts', 'Owned and owed']] as const;
const OWNERS = [['personal', 'Personal'], ['business', 'Business'], ['all', 'Both']] as const;

export function Dashboard() {
  const { data: s, error } = useGet<Summary>('/summary');
  const [range, setRange] = useState(() => localStorage.getItem('range') ?? '12');
  const [owner, setOwner] = useState(() => localStorage.getItem('owner') ?? 'all');
  const { data: t } = useGet<Trends>(`/trends?months=${range}&owner=${owner}`);
  const { data: nw } = useGet<NetWorthMonth[]>('/networth-history');
  const { data: fc } = useGet<Forecast>(`/forecast?months=6&owner=${owner}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [nwView, setNwView] = useState(() => localStorage.getItem('nwView') ?? 'net');

  // default to the last complete month: the current one is only partly in, and reads as a sudden drop
  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  useEffect(() => {
    if (!t || (selected && t.months.some((m) => m.month === selected))) return;
    const complete = t.months.filter((m) => m.month < thisMonth && (!t.latestWithData || m.month <= t.latestWithData)).at(-1)?.month;
    setSelected(complete ?? t.latestWithData ?? t.months.at(-1)?.month ?? null);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const soFar = (month: string) => (month === thisMonth ? ' so far' : '');

  const sel = t?.months.findIndex((m) => m.month === selected) ?? -1;
  const cur = t && sel >= 0 ? t.months[sel] : undefined;
  const prev = t && sel > 0 ? t.months[sel - 1] : undefined;

  // full category breakdown for the selected month, compared with the month before
  const breakdown = useMemo(() => {
    if (!t || !cur) return [];
    const spentIn = (m?: string) => new Map(t.rows.filter((r) => r.month === m && r.expenses > 0).map((r) => [r.category, r.expenses]));
    const now = spentIn(cur.month), before = spentIn(prev?.month);
    return [...now.entries()].sort((a, b) => b[1] - a[1]).map(([category, spent]) => ({ category, spent, before: before.get(category) ?? 0 }));
  }, [t, cur, prev]);

  if (error) return <p className="error">{error}</p>;
  if (!s || !t) return <p className="muted">Loading…</p>;

  const months = t.months.map((m) => m.month);
  const hasFlows = t.months.some((m) => m.income || m.expenses);
  const flowSeries: Series[] = [
    { key: 'income', label: 'Income', color: 'var(--income)', values: t.months.map((m) => m.income) },
    { key: 'expenses', label: 'Spending', color: 'var(--spending)', values: t.months.map((m) => m.expenses) },
  ];
  const catSeries: Series[] = t.categories.map((c) => ({ key: c, label: c, color: colorFor(t.categories, c), values: t.months.map((m) => m.byCategory[c] ?? 0) }));
  const maxCat = Math.max(1, ...breakdown.map((b) => b.spent));
  const selectMonth = (i: number) => setSelected(months[i]);
  const pickRange = (r: string) => { setRange(r); localStorage.setItem('range', r); };
  const pickOwner = (o: string) => { setOwner(o); localStorage.setItem('owner', o); };
  const noData = s.netWorth === 0 && !hasFlows;
  // net worth is everything you own, so it ignores the personal/business filter but follows the range
  const nwShown = nw && (range === '0' ? nw : nw.slice(-Number(range)));
  // Net worth alone gets an axis fitted to it, since against what you own and owe it barely moves.
  // "Owned and owed" shows the two sides it is the gap between, on a zero-based axis.
  const nwSeries: LineSeries[] | null = !nwShown || nwShown.length < 2 ? null : nwView === 'net'
    ? [{ key: 'nw', label: 'Net worth', color: 'var(--series-1)', values: nwShown.map((p) => p.netWorth) }]
    : [
      { key: 'owned', label: 'Owned', color: 'var(--series-3)', values: nwShown.map((p) => p.cash + p.investments + p.assets) },
      { key: 'owed', label: 'Owed', color: 'var(--series-2)', values: nwShown.map((p) => -p.debt) },
    ];
  const nwChange = nwShown && nwShown.length > 1 ? nwShown.at(-1)!.netWorth - nwShown[0].netWorth : 0;
  const pickNwView = (v: string) => { setNwView(v); localStorage.setItem('nwView', v); };

  // Cash outlook: the last months of cash (both owners only, as history isn't split by owner), then the projection
  // from today's balance. Both lines share this month's point, so they join.
  const pastCash = fc && fc.owner === 'all' && nw ? nw.filter((p) => p.month < thisMonth).slice(-5) : [];
  const outlookMonths = fc ? [...pastCash.map((p) => p.month), ...fc.months.map((m) => m.month)] : [];
  const nowAt = pastCash.length;
  const outlook: LineSeries[] = !fc ? [] : [
    ...(pastCash.length ? [{ key: 'cash', label: 'Cash', color: 'var(--series-1)', values: [...pastCash.map((p) => p.cash), fc.cash, ...fc.months.slice(1).map(() => null)] }] : []),
    { key: 'projected', label: 'Projected', color: 'var(--series-1)', dashed: true, values: [...pastCash.map(() => null), fc.cash, ...fc.months.slice(1).map((m) => m.balance)] },
  ];
  const outlookEnd = fc?.months.at(-1);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <div className="sub">{cur ? <>Showing <b>{monthLabel(cur.month, true)}{soFar(cur.month)}</b>. Click a month in a chart to change it.</> : 'Your money at a glance.'}
            {t.owner !== 'all' && <> Charts show {t.owner} accounts only.</>}</div>
        </div>
        <div className="filters">
          <div className="segmented" role="group" aria-label="Whose money">
            {OWNERS.map(([v, label]) => <button key={v} className={t.owner === v ? 'on' : ''} onClick={() => pickOwner(v)}>{label}</button>)}
          </div>
          <div className="segmented" role="group" aria-label="Range">
            {RANGES.map(([v, label]) => <button key={v} className={range === v ? 'on' : ''} onClick={() => pickRange(v)}>{label}</button>)}
          </div>
        </div>
      </div>

      {noData && (
        <div className="card callout">
          Nothing here yet. Add your accounts on <b>Accounts</b>, recurring bills on <b>Bills</b>, and import a bank statement on <b>Import</b>.
        </div>
      )}

      <div className="kpis">
        <div className="card kpi">
          <h2>Net worth</h2>
          <div className="kpi-row"><div className="big">{fmtMoney(s.netWorth)}</div><Sparkline values={(nw ?? []).slice(-12).map((p) => p.netWorth)} /></div>
          <div className="sub">Cash {fmtMoney(s.cash)} · Investments {fmtMoney(s.investments)}{s.assets ? ` · Property ${fmtMoney(s.assets)}` : ''}{s.debt ? ` · Debt ${fmtMoney(s.debt)}` : ''}</div>
          {s.businessCash !== 0 && <div className="sub">Includes {fmtMoney(s.businessCash)} in business accounts</div>}
          {s.missingRates.length > 0 && <div className="sub bad">No exchange rate yet for {s.missingRates.join(', ')}, so those accounts count as 0. The app fetches NBP rates when it is online.</div>}
        </div>
        <Kpi title="Income" value={cur?.income} before={prev?.income} goodWhenUp />
        <Kpi title="Spending" value={cur?.expenses} before={prev?.expenses} goodWhenUp={false} />
        <div className="card kpi">
          <h2>Saved</h2>
          <div className="big">{cur ? fmtMoney(cur.net) : '–'}</div>
          <div className="sub">{cur?.savingsRate != null ? <>Savings rate <b>{fmtPct(cur.savingsRate)}</b></> : 'No income this month'}</div>
        </div>
      </div>

      {nwSeries && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Net worth over time</h2>
              <div className="sub">
                <b className={nwChange >= 0 ? 'good' : 'bad'}>{nwChange >= 0 ? '+' : '−'}{fmtMoney(Math.abs(nwChange))}</b> since {monthLabel(nwShown![0].month, true)}
              </div>
            </div>
            <div className="filters">
              {nwSeries.length > 1 && <Legend items={nwSeries.map((x) => ({ label: x.label, color: x.color }))} />}
              <div className="segmented" role="group" aria-label="Net worth view">
                {NW_VIEWS.map(([v, label]) => <button key={v} className={nwView === v ? 'on' : ''} onClick={() => pickNwView(v)}>{label}</button>)}
              </div>
            </div>
          </div>
          <LineChart months={nwShown!.map((p) => p.month)} series={nwSeries} format={fmtMoney} height={260} zeroBased={nwView !== 'net'}
            tooltipExtra={(i) => {
              const p = nwShown![i];
              const rows: [string, number][] = [['Cash', p.cash], ['Investments', p.investments], ['Property', p.assets], ['Debt', p.debt]];
              return <>
                {nwView !== 'net' && <div className="tt-row total"><span /><span>Net worth</span><b>{fmtMoney(p.netWorth)}</b></div>}
                {rows.filter(([, v]) => v).map(([label, v], k) => (
                  <div className={k === 0 ? 'tt-row total' : 'tt-row'} key={label}><span /><span>{label}</span><b>{fmtMoney(v)}</b></div>
                ))}
                {i > 0 && <div className="tt-row"><span /><span>Change on month</span><b>{fmtMoney(p.netWorth - nwShown![i - 1].netWorth)}</b></div>}
              </>;
            }} />
          <div className="sub">Month-end balances. Accounts with transactions are worked back from today's balance; property, investments and loans use the balance recorded for each month.</div>
        </div>
      )}

      {cur && (
        <div className="cols-2">
          <WhatChanged month={cur.month} label={monthLabel(cur.month, true) + soFar(cur.month)} />
          <StoodOut month={cur.month} owner={owner} label={monthLabel(cur.month, true) + soFar(cur.month)} />
        </div>
      )}

      {fc && (
        <div className="cols-2">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Cash outlook</h2>
                <div className="sub">
                  {outlookEnd && <><b className={outlookEnd.balance >= fc.cash ? 'good' : 'bad'}>{fmtMoney(outlookEnd.balance)}</b> by the end of {monthLabel(outlookEnd.month, true)} at a typical month</>}
                </div>
              </div>
              <Legend items={outlook.map((x) => ({ label: x.label, color: x.color, dashed: x.dashed }))} />
            </div>
            <LineChart months={outlookMonths} series={outlook} format={fmtMoney} height={220}
              tooltipExtra={(i) => i > nowAt && fc.months[i - nowAt]?.billCount > 0 && (
                <div className="tt-row"><span /><span>Bills due</span><b>{fmtMoney(fc.months[i - nowAt].bills)}</b></div>)} />
            <div className="sub">
              {fc.basis.length
                ? <>A typical month is the median of {monthLabel(fc.basis[0], true)} – {monthLabel(fc.basis.at(-1)!, true)}: {fmtMoney(fc.income)} in, {fmtMoney(fc.spending)} out. Transfers between your accounts are left out.</>
                : 'No completed months to project from yet.'}
              {fc.owner !== 'all' && <> Only {fc.owner} cash accounts; money moved between personal and business counts as neither.</>}
            </div>
          </div>
          <div className="card">
            <h2>Month by month</h2>
            <table className="compact">
              <thead><tr><th>Month</th><th className="num">In</th><th className="num">Out</th><th className="num">Bills due</th><th className="num">Cash at end</th></tr></thead>
              <tbody>{fc.months.map((m, i) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month, true)}{i === 0 ? ' (rest)' : ''}</td>
                  <td className="num">{fmtMoney(m.income)}</td>
                  <td className="num">{fmtMoney(m.spending)}</td>
                  <td className="num">{m.billCount ? fmtMoney(m.bills) : <span className="muted">–</span>}</td>
                  <td className={m.balance < 0 ? 'num bad' : 'num'}><b>{fmtMoney(m.balance)}</b></td>
                </tr>))}
              </tbody>
            </table>
            <div className="sub">Bills due are already part of a typical month's spending, so they aren't taken off twice.</div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Income and spending by month</h2>
          <Legend items={flowSeries.map((x) => ({ label: x.label, color: x.color }))} />
        </div>
        {hasFlows
          ? <BarChart months={months} series={flowSeries} format={fmtMoney} selected={sel} onSelect={selectMonth} height={260}
              tooltipExtra={(i) => <div className="tt-row total"><span /><span>Saved</span><b>{fmtMoney(t.months[i].net)}</b></div>} />
          : <Empty />}
      </div>

      <div className="cols-2">
        <div className="card">
          <div className="card-head">
            <h2>Saved each month</h2>
            <Legend items={[{ label: 'Saved', color: 'var(--income)' }, { label: 'Overspent', color: 'var(--spending)' }]} />
          </div>
          {hasFlows
            ? <BarChart months={months} series={[{ key: 'net', label: 'Saved', color: 'var(--income)', values: t.months.map((m) => m.net) }]}
                colorOf={(v) => (v >= 0 ? 'var(--income)' : 'var(--spending)')} format={fmtMoney} selected={sel} onSelect={selectMonth} height={200}
                tooltipExtra={(i) => t.months[i].savingsRate != null && <div className="tt-row total"><span /><span>Savings rate</span><b>{fmtPct(t.months[i].savingsRate!)}</b></div>} />
            : <Empty />}
        </div>
        <div className="card">
          <div className="card-head"><h2>Where the money went</h2></div>
          {catSeries.length
            ? <>
                <BarChart months={months} series={catSeries} stacked format={fmtMoney} selected={sel} onSelect={selectMonth} height={200} />
                <Legend items={catSeries.map((x) => ({ label: x.label, color: x.color }))} />
              </>
            : <Empty />}
        </div>
      </div>

      <div className="cols-3">
        <div className="card">
          <h2>Spending in {cur ? monthLabel(cur.month, true) + soFar(cur.month) : '…'}</h2>
          {breakdown.length === 0 ? <div className="muted">No spending recorded in this month.</div> : (
            <table className="cat-table"><tbody>
              {breakdown.slice(0, 10).map((b) => {
                const delta = b.spent - b.before;
                return (
                  <tr key={b.category}>
                    <td className="cat-name"><span className="swatch" style={{ background: colorFor(t.categories, b.category) }} />{b.category}</td>
                    <td className="cat-bar"><div className="bar"><div style={{ width: `${(b.spent / maxCat) * 100}%` }} /></div></td>
                    <td className="num">{fmtMoney(b.spent)}</td>
                    <td className="num delta">{prev && Math.abs(delta) >= 1
                      ? <span className={delta > 0 ? 'bad' : 'good'} title={`${fmtMoney(b.before)} in ${monthLabel(prev.month)}`}>{delta > 0 ? '▲' : '▼'} {fmtMoney(Math.abs(delta))}</span>
                      : <span className="muted">–</span>}</td>
                  </tr>);
              })}
            </tbody></table>)}
          {prev && breakdown.length > 0 && <div className="sub">Arrows compare with {monthLabel(prev.month, true)}.</div>}
        </div>

        <div className="card">
          <div className="card-head"><h2>Upcoming bills</h2><span className="muted small">{fmtMoney(s.bills.dueNext30Days)} in 30 days</span></div>
          {s.bills.overdueCount > 0 && <div className="callout bad-callout">⚠ {s.bills.overdueCount} overdue, {fmtMoney(s.bills.overdueTotal)}</div>}
          {s.bills.next.length === 0 ? <div className="muted">No bills set up.</div> : (
            <ul className="bill-list">
              {s.bills.next.map((b, i) => (
                <li key={`${b.id}-${i}`}>
                  <div className="date-chip"><b>{Number(b.date.slice(8, 10))}</b><span>{monthLabel(b.date.slice(0, 7))}</span></div>
                  <div className="bill-name">{b.name}{b.status !== 'upcoming' && <span className={`pill ${b.status}`}>{b.status === 'overdue' ? 'overdue' : 'soon'}</span>}
                    <div className="sub">{fmtDate(b.date)}</div></div>
                  <div className="num">{fmtMoney(b.amount)}</div>
                </li>))}
            </ul>)}
        </div>

        <div className="card">
          <h2>Financial independence</h2>
          <div className="big">{fmtPct(s.fire.percentToFi)}</div>
          <div className="progress"><div style={{ width: `${Math.min(100, s.fire.percentToFi * 100)}%` }} /></div>
          <div className="sub">of {fmtMoney(s.fire.fiNumber)}, based on {fmtMoney(s.avgMonthlyExpenses)}/month spending</div>
          <table className="compact"><tbody>
            <tr><td>Lean FIRE (80%)</td><td className="num">{fmtMoney(s.fire.leanFi)}</td></tr>
            <tr><td>FIRE</td><td className="num">{fmtMoney(s.fire.fiNumber)}</td></tr>
            <tr><td>Fat FIRE (2×)</td><td className="num">{fmtMoney(s.fire.fatFi)}</td></tr>
            <tr><td>Coast FI today</td><td className="num">{fmtMoney(s.fire.coastFi)} {s.fire.coastReached && <span className="good">✓</span>}</td></tr>
            <tr><td>Investments cover per year</td><td className="num">{fmtMoney(s.fire.investedCoversYearly)}</td></tr>
          </tbody></table>
          <div className="sub">Assumed return {fmtPct(s.fire.returnRate)}, change it in Settings</div>
        </div>
      </div>

      <FirePathCard fire={s.fire} invested={s.investments} savedMonths={t.months.filter((m) => m.month < thisMonth).slice(-12).map((m) => m.net)} />
    </>
  );
}

function Kpi({ title, value, before, goodWhenUp }: { title: string; value?: number; before?: number; goodWhenUp: boolean }) {
  const delta = value !== undefined && before ? (value - before) / before : null;
  const good = delta !== null && (delta >= 0) === goodWhenUp;
  return (
    <div className="card kpi">
      <h2>{title}</h2>
      <div className="big">{value !== undefined ? fmtMoney(value) : '–'}</div>
      <div className="sub">{delta === null ? 'No earlier month to compare'
        : <><span className={good ? 'good' : 'bad'}>{delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(delta))}</span> vs last month</>}</div>
    </div>
  );
}

interface Change {
  month: string; prev: string; total: number; income: number; expenses: number;
  accounts: { id: number; name: string; kind: string; currency: string; moved: number; fx: number; total: number }[];
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtMoney(Math.abs(v))}`;

/** A month's net worth change, account by account, with exchange-rate moves apart from money moved. */
function WhatChanged({ month, label }: { month: string; label: string }) {
  const { data: c } = useGet<Change>(`/networth-change?month=${month}`);
  if (!c || c.month !== month) return <div className="card"><h2>What changed in {label}</h2><div className="muted">Loading…</div></div>;
  const fx = c.accounts.reduce((t, a) => t + a.fx, 0);
  const saved = c.income - c.expenses;
  const shown = c.accounts.slice(0, 8);
  const rest = c.accounts.slice(8).reduce((t, a) => t + a.moved, 0);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>What changed in {label}</h2>
          <div className="sub">Net worth <b className={c.total >= 0 ? 'good' : 'bad'}>{signed(c.total)}</b> on {monthLabel(c.prev, true)}</div>
        </div>
      </div>
      <table className="compact"><tbody>
        <tr><td>Income less spending</td><td className="num"><b>{signed(saved)}</b></td></tr>
        {Math.abs(fx) >= 1 && <tr><td>Exchange rates</td><td className="num">{signed(fx)}</td></tr>}
      </tbody></table>
      {shown.length === 0 ? <div className="muted">No balances changed.</div> : (
        <table className="compact change-table">
          <thead><tr><th>Account</th><th className="num">Balance moved</th><th className="num">Rate</th></tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id}>
                <td>{a.name}{a.currency !== 'PLN' && <span className="muted small"> {a.currency}</span>}</td>
                <td className={`num ${a.moved >= 0 ? 'good' : 'bad'}`}>{Math.abs(a.moved) >= 1 ? signed(a.moved) : <span className="muted">–</span>}</td>
                <td className="num muted">{Math.abs(a.fx) >= 1 ? signed(a.fx) : '–'}</td>
              </tr>))}
            {Math.abs(rest) >= 1 && <tr><td className="muted">{c.accounts.length - shown.length} more</td><td className="num">{signed(rest)}</td><td /></tr>}
          </tbody>
        </table>)}
      <div className="sub">Balance moved is the change in each balance, in złoty at the month-end rate. Rate is what the
        exchange rate did to the balance already there. Income less spending leaves out transfers between your accounts.</div>
    </div>
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
  if (!d || d.month !== month) return <div className="card"><h2>What stood out in {label}</h2><div className="muted">Loading…</div></div>;
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

const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : 0; };

/** Investments grown year by year at the assumed return, with a monthly amount added, against the FI number. */
function FirePathCard({ fire, invested, savedMonths }: { fire: Fire; invested: number; savedMonths: number[] }) {
  const usual = Math.max(0, Math.round(median(savedMonths) / 100) * 100);
  const [typed, setTyped] = useState(() => localStorage.getItem('fireMonthly') ?? '');
  const monthly = typed.trim() === '' ? usual : Math.max(0, Number(typed.replace(/\s/g, '').replace(',', '.')) || 0);
  const pick = (v: string) => { setTyped(v); localStorage.setItem('fireMonthly', v); };

  // long enough to show reaching FI, or 30 years when it isn't reached
  const reach = projectFire(invested, monthly, fire.returnRate, fire.fiNumber, 40).fiMonths;
  const years = Math.min(40, Math.max(15, fire.retirementAge - fire.currentAge + 5, reach === null ? 30 : Math.ceil(reach / 12) + 5));
  const path = projectFire(invested, monthly, fire.returnRate, fire.fiNumber, years);
  const ages = path.values.map((_, i) => fire.currentAge + i);
  const series: LineSeries[] = [
    { key: 'invested', label: 'Investments', color: 'var(--series-1)', values: path.values },
    { key: 'fi', label: 'FI number', color: 'var(--text-2)', values: path.values.map(() => fire.fiNumber), dashed: true },
  ];
  const fiAge = reach === null ? null : fire.currentAge + reach / 12;
  const atRetirement = path.values[fire.retirementAge - fire.currentAge];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Path to financial independence</h2>
          <div className="sub">{fiAge === null
            ? <>Not reached within {years} years at this rate.</>
            : reach === 0 ? <>Your investments already cover the FI number.</>
            : <>FI at about <b>age {Math.floor(fiAge)}</b>, in {Math.floor(reach! / 12)} years {reach! % 12} months
              {fiAge > fire.retirementAge ? <>, <span className="bad">{(fiAge - fire.retirementAge).toFixed(1)} years after</span> your target of {fire.retirementAge}</> : <>, by your target of {fire.retirementAge}</>}.</>}</div>
        </div>
        <div className="filters">
          <Legend items={series.map((x) => ({ label: x.label, color: x.color, dashed: x.dashed }))} />
          <label className="field inline">Invest a month
            <input value={typed} placeholder={String(usual)} onChange={(e) => pick(e.target.value)} style={{ width: 90 }} aria-label="Invested each month, złoty" /></label>
        </div>
      </div>
      <LineChart months={ages.map(String)} series={series} format={fmtMoney} height={240} xLabel={(i, full) => (full ? `Age ${ages[i]}` : String(ages[i]))}
        tooltipExtra={(i) => i > 0 ? <div className="tt-row"><span /><span>Added by then</span><b>{fmtMoney(monthly * 12 * i)}</b></div> : null} />
      <div className="sub">
        {atRetirement !== undefined && <>At {fire.retirementAge}: {fmtMoney(atRetirement)}. </>}
        Starts from {fmtMoney(invested)} invested, adds {fmtMoney(monthly)} a month{typed.trim() === '' ? ' (your median saved over the last 12 months)' : ''} and
        grows at {fmtPct(fire.returnRate)} a year. The FI number is held at today's spending, so read it in today's money only if the return is after inflation.
      </div>
    </div>
  );
}

const Empty = () => <div className="empty">Import a bank statement to see this.</div>;
