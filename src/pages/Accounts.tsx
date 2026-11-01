import { Fragment, useState } from 'react';
import { api, fmtMoney, fmtMoneyIn, type Account } from '../api.ts';
import { CURRENCIES } from '../../shared/parse.ts';
import { useGet } from '../hooks.ts';
import { BalanceHistory } from '../BalanceHistory.tsx';
import { Sparkline } from '../charts.tsx';
import { SkeletonPage } from '../Skeleton.tsx';

const KINDS: { value: Account['kind']; label: string }[] = [
  { value: 'cash', label: 'Cash / checking / savings' },
  { value: 'investment', label: 'Investment (eToro, IKE, IKZE…)' },
  { value: 'asset', label: 'Asset (property, vehicle)' },
  { value: 'debt', label: 'Debt (mortgage, loan) — enter as negative' },
];
const blank = { name: '', bank: '', kind: 'cash' as Account['kind'], owner: 'personal' as Account['owner'], currency: 'PLN', balance: '' };

export function Accounts() {
  const { data: accounts, error, reload } = useGet<Account[]>('/accounts');
  const [form, setForm] = useState<(typeof blank & { id?: number }) | null>(null);
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState<number | null>(null);
  const { data: trend } = useGet<{ id: number; balances: (number | null)[] }[]>('/account-history?months=12');
  const trendOf = (id: number) => (trend?.find((t) => t.id === id)?.balances ?? []).filter((b): b is number => b !== null);

  async function save() {
    if (!form) return;
    const body = { ...form, balance: Number(String(form.balance).replace(/\s/g, '').replace(',', '.')) || 0 };
    try {
      if (form.id) await api(`/accounts/${form.id}`, 'PUT', body); else await api('/accounts', 'POST', body);
      setForm(null); setMsg(''); reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  if (error) return <p className="error">{error}</p>;
  if (!accounts) return <SkeletonPage cards={2} />;

  const groups: ['personal' | 'business', string][] = [['personal', 'Personal'], ['business', 'Business']];

  return (
    <>
      <div className="row"><button className="btn primary" onClick={() => setForm(blank)}>+ Add account</button></div>
      {form && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row">
            <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mBank checking" /></label>
            <label className="field">Bank<input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} placeholder="mBank" style={{ width: 120 }} /></label>
            <label className="field">Type
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Account['kind'] })}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
            <label className="field">Owner
              <select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value as Account['owner'] })}>
                <option value="personal">Personal</option><option value="business">Business</option></select></label>
            <label className="field">Currency
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="field">Balance ({form.currency})<input value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} style={{ width: 120 }} /></label>
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn" onClick={() => setForm(null)}>Cancel</button>
          </div>
          {form.currency !== 'PLN' && <div className="sub">Keep one account per currency, as the bank does (e.g. "mBank firma EUR"). Totals convert it to złoty at the NBP rate.</div>}
          {msg && <div className="error">{msg}</div>}
        </div>)}

      <Exposure accounts={accounts} />

      {groups.map(([owner, title]) => {
        const list = accounts.filter((a) => a.owner === owner);
        if (list.length === 0) return null;
        const total = list.reduce((t, a) => t + (a.balance_pln ?? 0), 0);
        return (
          <div className="card scroll" key={owner} style={{ marginBottom: 12 }}>
            <div className="card-head"><h2>{title}</h2><span className="muted small">{fmtMoney(total)} in total</span></div>
            <table>
              <thead><tr><th>Account</th><th>Type</th><th>Last 12 months</th><th className="num">Balance</th><th /></tr></thead>
              <tbody>{list.map((a) => (
                <Fragment key={a.id}>
                <tr>
                  <td>{a.name}<div className="sub">{a.bank}</div></td>
                  <td>{a.kind}</td>
                  <td><Sparkline values={trendOf(a.id)} color={a.balance < 0 ? 'var(--bad)' : 'var(--series-1)'} /></td>
                  <td className={`num ${a.balance < 0 ? 'bad' : ''}`}>{fmtMoneyIn(a.balance, a.currency)}
                    {a.currency !== 'PLN' && <div className="sub">{a.balance_pln === null ? 'no exchange rate yet' : `≈ ${fmtMoney(a.balance_pln)}`}</div>}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small" onClick={() => setHistory(history === a.id ? null : a.id)}>History</button>{' '}
                    <button className="btn small" onClick={() => setForm({ ...a, balance: String(a.balance) })}>Edit</button>{' '}
                    <button className="btn small" onClick={() => { if (confirm(`Archive ${a.name}?`)) api(`/accounts/${a.id}`, 'DELETE').then(reload); }}>✕</button>
                  </td>
                </tr>
                {history === a.id && <tr><td colSpan={5}><BalanceHistory account={a} onChange={reload} /></td></tr>}
                </Fragment>))}</tbody>
            </table>
          </div>);
      })}
      {accounts.length === 0 && <div className="card muted">No accounts yet. Add your Pekao and mBank accounts, then investments and property.</div>}
      <div className="sub">Update a balance whenever you like; each update is stored for the current month. <b>History</b> records past months, for property, investments and loans whose history has no transactions behind it.</div>
    </>
  );
}

/** How much is held and owed in each currency, in złoty, so the exposure to each exchange rate is plain. */
function Exposure({ accounts }: { accounts: Account[] }) {
  const by = new Map<string, { held: number; owed: number; missing: boolean }>();
  for (const a of accounts) {
    const e = by.get(a.currency) ?? { held: 0, owed: 0, missing: false };
    if (a.balance_pln === null) e.missing = true;
    else if (a.balance_pln >= 0) e.held += a.balance_pln; else e.owed -= a.balance_pln;
    by.set(a.currency, e);
  }
  const rows = [...by].map(([currency, e]) => ({ currency, ...e, net: e.held - e.owed })).sort((a, b) => b.held - a.held);
  if (rows.length < 2) return null;
  const totalHeld = rows.reduce((t, r) => t + r.held, 0) || 1;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head"><h2>Money by currency</h2><span className="muted small">in złoty at today's rate</span></div>
      <table>
        <thead><tr><th>Currency</th><th>Share of what you hold</th><th className="num">Held</th><th className="num">Owed</th><th className="num">Net</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.currency}>
            <td><b>{r.currency}</b>{r.missing && <div className="sub">some balances have no rate yet</div>}</td>
            <td style={{ minWidth: 160 }}>
              <div className="share"><div className="share-fill" style={{ width: `${(r.held / totalHeld) * 100}%` }} /></div>
              <span className="muted small">{Math.round((r.held / totalHeld) * 100)}%</span>
            </td>
            <td className="num">{fmtMoney(r.held)}</td>
            <td className="num">{r.owed ? fmtMoney(r.owed) : '—'}</td>
            <td className={`num ${r.net < 0 ? 'bad' : ''}`}>{fmtMoney(r.net)}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}
