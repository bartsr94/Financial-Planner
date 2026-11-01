import { useState } from 'react';
import { api, fmtMoneyIn } from './api.ts';
import { useGet } from './hooks.ts';
import { monthLabel } from './charts.tsx';

/**
 * The balance recorded for each month of one account, for accounts whose history has no transactions
 * behind it (property, a car, investments, a loan without a statement). Saving a month again replaces it.
 */
export function BalanceHistory({ account, onChange }: { account: { id: number; name: string; currency: string; kind: string }; onChange?: () => void }) {
  const { data: rows, error, reload } = useGet<{ month: string; balance: number }[]>(`/accounts/${account.id}/snapshots`);
  const [month, setMonth] = useState('');
  const [balance, setBalance] = useState('');
  const [msg, setMsg] = useState('');

  async function save() {
    const value = Number(balance.replace(/\s/g, '').replace(',', '.'));
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(value) || balance.trim() === '') { setMsg('Pick a month and enter a balance.'); return; }
    try {
      await api(`/accounts/${account.id}/snapshots`, 'PUT', { snapshots: [{ month, balance: value }] });
      setBalance(''); setMsg(''); reload(); onChange?.();
    } catch (e) { setMsg((e as Error).message); }
  }

  async function remove(m: string) {
    await api(`/accounts/${account.id}/snapshots/${m}`, 'DELETE');
    reload(); onChange?.();
  }

  return (
    <div className="history">
      <div className="row">
        <label className="field">Month<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <label className="field">Balance at month end ({account.currency}){account.kind === 'debt' && ', negative'}
          <input value={balance} onChange={(e) => setBalance(e.target.value)} style={{ width: 130 }} onKeyDown={(e) => e.key === 'Enter' && save()} /></label>
        <button className="btn primary" onClick={save}>Save month</button>
      </div>
      {msg && <div className="error">{msg}</div>}
      {error && <div className="error">{error}</div>}
      {rows && rows.length > 0 && (
        <table className="compact">
          <tbody>{[...rows].reverse().map((r) => (
            <tr key={r.month}>
              <td>{monthLabel(r.month, true)}</td>
              <td className={`num ${r.balance < 0 ? 'bad' : ''}`}>{fmtMoneyIn(r.balance, account.currency, false)}</td>
              <td className="num"><button className="btn small" onClick={() => { setMonth(r.month); setBalance(String(r.balance)); }}>Edit</button>{' '}
                <button className="btn small" aria-label={`Delete ${r.month}`} onClick={() => remove(r.month)}>✕</button></td>
            </tr>))}</tbody>
        </table>)}
      <div className="sub">Each month keeps its balance until a later month is recorded.</div>
    </div>
  );
}
