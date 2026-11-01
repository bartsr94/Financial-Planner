import { fmtDate, fmtMoney, fmtPct } from '../api.ts';
import { useGet } from '../hooks.ts';

interface Summary {
  netWorth: number; cash: number; investments: number; assets: number; debt: number; businessCash: number;
  months: { month: string; income: number; expenses: number }[];
  byCategory: { category: string; spent: number }[];
  avgMonthlyExpenses: number;
  fire: { fiNumber: number; leanFi: number; fatFi: number; coastFi: number; percentToFi: number; investedCoversYearly: number; coastReached: boolean; returnRate: number };
  bills: { dueNext30Days: number; overdueCount: number; overdueTotal: number; next: { id: number; name: string; amount: number; date: string; status: string }[] };
}

export function Dashboard() {
  const { data: s, error } = useGet<Summary>('/summary');
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">Loading…</p>;

  const lastMonths = s.months.slice(-6);
  const maxFlow = Math.max(1, ...lastMonths.flatMap((m) => [m.income, m.expenses]));
  const maxCat = Math.max(1, ...s.byCategory.map((c) => c.spent));
  const noData = s.netWorth === 0 && s.months.length === 0;

  return (
    <>
      {noData && (
        <div className="card" style={{ marginBottom: 12 }}>
          Nothing here yet. Add your accounts on the <b>Accounts</b> tab, your recurring bills on <b>Bills</b>, and import
          a bank statement on <b>Import</b>.
        </div>
      )}
      <div className="grid">
        <div className="card"><h2>Net worth</h2><div className="big">{fmtMoney(s.netWorth)}</div>
          <div className="sub">Cash {fmtMoney(s.cash)} · Investments {fmtMoney(s.investments)}</div>
          <div className="sub">Assets {fmtMoney(s.assets)} · Debt {fmtMoney(s.debt)}</div></div>
        <div className="card"><h2>Bills, next 30 days</h2><div className="big">{fmtMoney(s.bills.dueNext30Days)}</div>
          {s.bills.overdueCount > 0
            ? <div className="sub bad">{s.bills.overdueCount} overdue ({fmtMoney(s.bills.overdueTotal)})</div>
            : <div className="sub good">Nothing overdue</div>}</div>
        <div className="card"><h2>Progress to FI</h2><div className="big">{fmtPct(s.fire.percentToFi)}</div>
          <div className="bar" style={{ margin: '6px 0' }}><div style={{ width: `${Math.min(100, s.fire.percentToFi * 100)}%` }} /></div>
          <div className="sub">FI number {fmtMoney(s.fire.fiNumber)} · based on {fmtMoney(s.avgMonthlyExpenses)}/mo spending</div></div>
        <div className="card"><h2>Business cash</h2><div className="big">{fmtMoney(s.businessCash)}</div>
          <div className="sub">Kept out of net worth and spending</div></div>
      </div>

      <div className="grid">
        <div className="card"><h2>Upcoming bills</h2>
          {s.bills.next.length === 0 ? <div className="muted">No bills set up.</div> : (
            <table><tbody>
              {s.bills.next.map((b, i) => (
                <tr key={`${b.id}-${i}`}>
                  <td>{b.name} {b.status !== 'upcoming' && <span className={`pill ${b.status}`}>{b.status === 'overdue' ? 'overdue' : 'soon'}</span>}</td>
                  <td className="muted">{fmtDate(b.date)}</td><td className="num">{fmtMoney(b.amount)}</td>
                </tr>))}
            </tbody></table>)}
        </div>
        <div className="card"><h2>Income vs spending</h2>
          {lastMonths.length === 0 ? <div className="muted">Import a statement to see this.</div> : (
            <table><tbody>
              {lastMonths.map((m) => (
                <tr key={m.month}>
                  <td style={{ width: 70 }}>{m.month}</td>
                  <td>
                    <div className="bar" style={{ marginBottom: 3 }}><div style={{ width: `${(m.income / maxFlow) * 100}%`, background: 'var(--good)' }} /></div>
                    <div className="bar"><div style={{ width: `${(m.expenses / maxFlow) * 100}%`, background: 'var(--bad)' }} /></div>
                  </td>
                  <td className="num" style={{ width: 90 }}><span className="good">{fmtMoney(m.income)}</span><br /><span className="bad">{fmtMoney(m.expenses)}</span></td>
                </tr>))}
            </tbody></table>)}
        </div>
      </div>

      <div className="grid">
        <div className="card"><h2>Spending this month</h2>
          {s.byCategory.length === 0 ? <div className="muted">No spending recorded this month.</div> : (
            <table><tbody>
              {s.byCategory.slice(0, 10).map((c) => (
                <tr key={c.category}>
                  <td style={{ width: 130 }}>{c.category}</td>
                  <td><div className="bar"><div style={{ width: `${(c.spent / maxCat) * 100}%` }} /></div></td>
                  <td className="num" style={{ width: 90 }}>{fmtMoney(c.spent)}</td>
                </tr>))}
            </tbody></table>)}
        </div>
        <div className="card"><h2>FIRE targets</h2>
          <table><tbody>
            <tr><td>Lean FIRE (80%)</td><td className="num">{fmtMoney(s.fire.leanFi)}</td></tr>
            <tr><td>FIRE</td><td className="num">{fmtMoney(s.fire.fiNumber)}</td></tr>
            <tr><td>Fat FIRE (2×)</td><td className="num">{fmtMoney(s.fire.fatFi)}</td></tr>
            <tr><td>Coast FI today</td><td className="num">{fmtMoney(s.fire.coastFi)} {s.fire.coastReached && <span className="good">✓</span>}</td></tr>
            <tr><td>Investments cover per year</td><td className="num">{fmtMoney(s.fire.investedCoversYearly)}</td></tr>
          </tbody></table>
          <div className="sub">Assumed return {fmtPct(s.fire.returnRate)} · change in Settings</div>
        </div>
      </div>
    </>
  );
}
