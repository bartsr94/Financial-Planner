import { useEffect, useState } from 'react';
import { useGet } from './hooks.ts';
import { monthLabel } from './charts.tsx';

// What the Overview and Spending pages share: whose money, the range, and the month being looked at.
// The month is kept for the browser session, so moving between the two pages keeps it.

export interface MonthTrend { month: string; income: number; expenses: number; net: number; savingsRate: number | null; byCategory: Record<string, number> }
export interface Trends {
  months: MonthTrend[]; categories: string[]; latestWithData: string | null; owner: string;
  rows: { month: string; category: string; income: number; expenses: number }[];
}

const RANGES = [['6', '6M'], ['12', '12M'], ['24', '2Y'], ['0', 'All']] as const;
const OWNERS = [['personal', 'Personal'], ['business', 'Business'], ['all', 'Both']] as const;

const today = new Date();
export const THIS_MONTH = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
export const soFar = (month: string) => (month === THIS_MONTH ? ' so far' : '');

export function useMonthView() {
  const [range, setRange] = useState(() => localStorage.getItem('range') ?? '12');
  const [owner, setOwner] = useState(() => localStorage.getItem('owner') ?? 'all');
  const { data: t, error } = useGet<Trends>(`/trends?months=${range}&owner=${owner}`);
  const [selected, setSelected] = useState<string | null>(() => sessionStorage.getItem('month'));

  // default to the last complete month: the current one is only partly in, and reads as a sudden drop
  useEffect(() => {
    if (!t || (selected && t.months.some((m) => m.month === selected))) return;
    const complete = t.months.filter((m) => m.month < THIS_MONTH && (!t.latestWithData || m.month <= t.latestWithData)).at(-1)?.month;
    setSelected(complete ?? t.latestWithData ?? t.months.at(-1)?.month ?? null);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = t?.months.findIndex((m) => m.month === selected) ?? -1;
  const months = t?.months.map((m) => m.month) ?? [];
  return {
    t, error, range, owner, sel, months,
    cur: t && sel >= 0 ? t.months[sel] : undefined,
    prev: t && sel > 0 ? t.months[sel - 1] : undefined,
    selectMonth: (i: number) => { setSelected(months[i]); sessionStorage.setItem('month', months[i]); },
    pickRange: (r: string) => { setRange(r); localStorage.setItem('range', r); },
    pickOwner: (o: string) => { setOwner(o); localStorage.setItem('owner', o); },
  };
}

type View = ReturnType<typeof useMonthView>;

/** The page title, the month being shown, and the whose-money and range filters. */
export function MonthHeader({ title, view }: { title: string; view: View }) {
  const { t, cur, owner, range, pickOwner, pickRange } = view;
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <div className="sub">{cur ? <>Showing <b>{monthLabel(cur.month, true)}{soFar(cur.month)}</b>. Click a month in a chart to change it.</> : 'Your money at a glance.'}
          {t && t.owner !== 'all' && <> Charts show {t.owner} accounts only.</>}</div>
      </div>
      <div className="filters">
        <div className="segmented" role="group" aria-label="Whose money">
          {OWNERS.map(([v, label]) => <button key={v} className={owner === v ? 'on' : ''} onClick={() => pickOwner(v)}>{label}</button>)}
        </div>
        <div className="segmented" role="group" aria-label="Range">
          {RANGES.map(([v, label]) => <button key={v} className={range === v ? 'on' : ''} onClick={() => pickRange(v)}>{label}</button>)}
        </div>
      </div>
    </div>
  );
}

// Categorical slots in fixed order (see styles.css); "Other" is always the neutral.
export const colorFor = (categories: string[], c: string) => {
  if (c === 'Uncategorised') return 'var(--series-uncat)';
  const named = categories.filter((x) => x !== 'Uncategorised' && x !== 'Other');
  return named.includes(c) ? `var(--series-${named.indexOf(c) + 1})` : 'var(--series-other)';
};

export const Empty = () => <div className="empty">Import a bank statement to see this.</div>;
