import { useEffect, useState } from 'react';
import { api, fmtDate, fmtMoneyIn, type Account, type Tx } from '../api.ts';
import { useGet } from '../hooks.ts';
import { merchantKey as merchantOf } from '../../shared/merchant.ts';

export function Transactions() {
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const filters = new URLSearchParams({ account, category, q }).toString();
  useEffect(() => { setPage(1); }, [filters]);
  useEffect(() => { window.scrollTo(0, 0); }, [page]);
  const { data, error, reload } = useGet<{ rows: Tx[]; total: number; size: number }>(`/transactions?${filters}&page=${page}&size=${PAGE_SIZE}`);
  const txs = data?.rows;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const { data: accounts } = useGet<Account[]>('/accounts');
  const { data: meta } = useGet<{ categories: string[] }>('/meta');
  const { data: rules, reload: reloadRules } = useGet<{ id: number; pattern: string; category: string }[]>('/rules');
  const [ruleFor, setRuleFor] = useState<Tx | null>(null);
  const [showRules, setShowRules] = useState(false);

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
    reload(); reloadRules();
    alert(`Rule saved. ${r.categorised} uncategorised transaction(s) filed.`);
  }

  async function applyAll() {
    const r = await api<{ categorised: number }>('/rules/apply', 'POST', {});
    reload();
    alert(`${r.categorised} uncategorised transaction(s) filed.`);
  }

  async function deleteRule(id: number) {
    await api(`/rules/${id}`, 'DELETE');
    reloadRules();
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
        <RuleBox key={ruleFor.id} tx={ruleFor} onSave={makeRule} onCancel={() => setRuleFor(null)} />
      )}

      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => setShowRules(!showRules)}>{showRules ? 'Hide' : 'Show'} rules ({rules?.length ?? 0})</button>
        <button className="btn" onClick={applyAll}>Apply rules to uncategorised</button>
      </div>
      {showRules && (
        <div className="card" style={{ marginBottom: 12 }}>
          {!rules?.length ? <div className="muted">No rules yet. Pick a category on a transaction to make one.</div> : (
            <table>
              <thead><tr><th>Text contains</th><th>Category</th><th></th></tr></thead>
              <tbody>{rules.map((r) => (
                <tr key={r.id}><td style={{ overflowWrap: 'anywhere' }}>{r.pattern}</td><td>{r.category}</td>
                  <td><button className="btn" onClick={() => deleteRule(r.id)}>✕</button></td></tr>))}</tbody>
            </table>)}
          <div className="sub">Matching ignores capitals and extra spaces. If several rules match, the longest text wins. Rules only fill in uncategorised transactions; they never change one you set by hand.</div>
        </div>)}

      <div className="card scroll">
        {!txs ? <div className="muted">Loading…</div> : txs.length === 0 ? <div className="muted">No transactions. Import a statement first.</div> : (
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.date)}</td>
                  <td className="tx-desc"><div className="tx-merchant">{merchantOf(t.description) || t.description}</div>
                    {merchantOf(t.description) && merchantOf(t.description) !== t.description && <div className="sub">{t.description.slice(merchantOf(t.description).length).trim()}</div>}</td>
                  <td className="tx-account">{t.account} {t.owner === 'business' && <span className="pill business">biz</span>}</td>
                  <td>
                    <select value={t.category ?? ''} onChange={(e) => setCat(t, e.target.value)}>
                      <option value="">—</option>{meta?.categories.map((c) => <option key={c}>{c}</option>)}
                    </select></td>
                  <td className={`num ${t.amount < 0 ? '' : 'good'}`}>{fmtMoneyIn(t.amount, t.currency)}</td>
                </tr>))}
            </tbody>
          </table>)}
      </div>
      {data && data.total > 0 && (
        <div className="pager">
          <span className="muted">{(page - 1) * data.size + 1}–{(page - 1) * data.size + data.rows.length} of {data.total}</span>
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(1)}>« First</button>
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Newer</button>
          <span>Page {page} of {pages}</span>
          <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older ›</button>
          <button className="btn small" disabled={page >= pages} onClick={() => setPage(pages)}>Last »</button>
        </div>)}
    </>
  );
}

const PAGE_SIZE = 100;

function RuleBox({ tx, onSave, onCancel }: { tx: Tx; onSave: (p: string) => void; onCancel: () => void }) {
  const [pattern, setPattern] = useState(merchantOf(tx.description));
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
