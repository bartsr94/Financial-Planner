import { useState } from 'react';
import { api, fmtMoneyExact, type Account } from '../api.ts';
import { useGet } from '../hooks.ts';

const KINDS: { value: Account['kind']; label: string }[] = [
  { value: 'cash', label: 'Cash / checking / savings' },
  { value: 'investment', label: 'Investment (eToro, IKE, IKZE…)' },
  { value: 'asset', label: 'Asset (property, vehicle)' },
  { value: 'debt', label: 'Debt (mortgage, loan) — enter as negative' },
];
const blank = { name: '', bank: '', kind: 'cash' as Account['kind'], owner: 'personal' as Account['owner'], balance: '' };

export function Accounts() {
  const { data: accounts, error, reload } = useGet<Account[]>('/accounts');
  const [form, setForm] = useState<(typeof blank & { id?: number }) | null>(null);
  const [msg, setMsg] = useState('');

  async function save() {
    if (!form) return;
    const body = { ...form, balance: Number(String(form.balance).replace(/\s/g, '').replace(',', '.')) || 0 };
    try {
      if (form.id) await api(`/accounts/${form.id}`, 'PUT', body); else await api('/accounts', 'POST', body);
      setForm(null); setMsg(''); reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  if (error) return <p className="error">{error}</p>;
  if (!accounts) return <p className="muted">Loading…</p>;

  const groups: ['personal' | 'business', string][] = [['personal', 'Personal'], ['business', 'Business (kept out of net worth)']];

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
            <label className="field">Balance (PLN)<input value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} style={{ width: 120 }} /></label>
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn" onClick={() => setForm(null)}>Cancel</button>
          </div>
          {msg && <div className="error">{msg}</div>}
        </div>)}

      {groups.map(([owner, title]) => {
        const list = accounts.filter((a) => a.owner === owner);
        if (list.length === 0) return null;
        return (
          <div className="card scroll" key={owner} style={{ marginBottom: 12 }}>
            <h2>{title}</h2>
            <table>
              <thead><tr><th>Account</th><th>Type</th><th className="num">Balance</th><th /></tr></thead>
              <tbody>{list.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}<div className="sub">{a.bank}</div></td>
                  <td>{a.kind}</td>
                  <td className={`num ${a.balance < 0 ? 'bad' : ''}`}>{fmtMoneyExact(a.balance)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small" onClick={() => setForm({ ...a, balance: String(a.balance) })}>Edit</button>{' '}
                    <button className="btn small" onClick={() => { if (confirm(`Archive ${a.name}?`)) api(`/accounts/${a.id}`, 'DELETE').then(reload); }}>✕</button>
                  </td>
                </tr>))}</tbody>
            </table>
          </div>);
      })}
      {accounts.length === 0 && <div className="card muted">No accounts yet. Add your Pekao and mBank accounts, then investments and property.</div>}
      <div className="sub">Update a balance whenever you like; each update is stored per month so your net-worth history builds up.</div>
    </>
  );
}
