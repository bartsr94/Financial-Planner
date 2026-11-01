import { useState } from 'react';
import { api, fmtDate, fmtMoneyExact, type Account, type Tx } from '../api.ts';
import { useGet } from '../hooks.ts';

export function Transactions() {
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ account, category, q }).toString();
  const { data: txs, error, reload } = useGet<Tx[]>(`/transactions?${query}`);
  const { data: accounts } = useGet<Account[]>('/accounts');
  const { data: meta } = useGet<{ categories: string[] }>('/meta');
  const [ruleFor, setRuleFor] = useState<Tx | null>(null);

  async function setCat(tx: Tx, cat: string) {
    await api(`/transactions/${tx.id}`, 'PATCH', { category: cat });
    reload();
    // offer to remember this for future imports
    if (cat) setRuleFor({ ...tx, category: cat });
  }

  async function makeRule(pattern: string) {
    if (!ruleFor?.category || !pattern.trim()) return;
    const r = await api<{ categorised: number }>('/rules', 'POST', { pattern, category: ruleFor.category });
    setRuleFor(null);
    reload();
    alert(`Rule saved. ${r.categorised} other uncategorised transaction(s) updated.`);
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="row">
        <label className="field">Account
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All</option>{accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.owner === 'business' ? ' (business)' : ''}</option>)}
          </select></label>
        <label className="field">Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option><option value="__none">Uncategorised</option>
            {meta?.categories.map((c) => <option key={c}>{c}</option>)}
          </select></label>
        <label className="field">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="description…" /></label>
      </div>

      {ruleFor && (
        <RuleBox tx={ruleFor} onSave={makeRule} onCancel={() => setRuleFor(null)} />
      )}

      <div className="card scroll">
        {!txs ? <div className="muted">Loading…</div> : txs.length === 0 ? <div className="muted">No transactions. Import a statement first.</div> : (
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.date)}</td>
                  <td style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{t.description}</td>
                  <td>{t.account} {t.owner === 'business' && <span className="pill business">biz</span>}</td>
                  <td>
                    <select value={t.category ?? ''} onChange={(e) => setCat(t, e.target.value)}>
                      <option value="">—</option>{meta?.categories.map((c) => <option key={c}>{c}</option>)}
                    </select></td>
                  <td className={`num ${t.amount < 0 ? '' : 'good'}`}>{fmtMoneyExact(t.amount)}</td>
                </tr>))}
            </tbody>
          </table>)}
        {txs && txs.length === 1000 && <div className="sub">Showing the latest 1000. Narrow the filters to see more.</div>}
      </div>
    </>
  );
}

function RuleBox({ tx, onSave, onCancel }: { tx: Tx; onSave: (p: string) => void; onCancel: () => void }) {
  const [pattern, setPattern] = useState(tx.description.slice(0, 30));
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>Always file transactions containing this text under “{tx.category}”
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} /></label>
        <button className="btn primary" onClick={() => onSave(pattern)}>Save rule</button>
        <button className="btn" onClick={onCancel}>No thanks</button>
      </div>
    </div>
  );
}
