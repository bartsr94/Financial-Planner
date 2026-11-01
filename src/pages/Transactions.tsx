import { useEffect, useState } from 'react';
import { api, fmtDate, fmtMoney, fmtMoneyIn, type Account, type Tx } from '../api.ts';
import { SkeletonRows } from '../Skeleton.tsx';
import { useGet } from '../hooks.ts';
import { merchantKey as merchantOf } from '../../shared/merchant.ts';

// The filters live in the address, so a refresh keeps them and other pages can link to a filtered list.
const FILTERS = ['account', 'category', 'q', 'from', 'to'] as const;
type Filters = Record<(typeof FILTERS)[number], string>;
const fromUrl = (): Filters => {
  const u = new URLSearchParams(location.search);
  return Object.fromEntries(FILTERS.map((k) => [k, u.get(k) ?? ''])) as Filters;
};

export function Transactions() {
  const [f, setF] = useState(fromUrl);
  const set = (k: keyof Filters, v: string) => setF((x) => ({ ...x, [k]: v }));
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState('');
  const filters = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  useEffect(() => {
    setPage(1);
    history.replaceState(null, '', `${location.pathname}${filters ? `?${filters}` : ''}`);
  }, [filters]);
  useEffect(() => { window.scrollTo(0, 0); setPicked(new Set()); }, [page, filters]);
  const { data, error, reload } = useGet<{ rows: Tx[]; total: number; size: number; moneyIn: number; moneyOut: number }>(`/transactions?${filters}&page=${page}&size=${PAGE_SIZE}`);
  const txs = data?.rows;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const { data: accounts } = useGet<Account[]>('/accounts');
  const { data: meta } = useGet<{ categories: string[] }>('/meta');
  const { data: rules, reload: reloadRules } = useGet<{ id: number; pattern: string; category: string }[]>('/rules');
  const [ruleFor, setRuleFor] = useState<Tx | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [note, setNote] = useState('');

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

  async function fileMany() {
    const r = await api<{ updated: number }>('/transactions/categorise', 'POST', { ids: [...picked], category: bulkCat });
    setNote(`${r.updated} line${r.updated === 1 ? '' : 's'} ${bulkCat ? `filed under ${bulkCat}` : 'set to uncategorised'}.`);
    setPicked(new Set()); setBulkCat('');
    reload();
  }

  const toggle = (id: number) => setPicked((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = !!txs?.length && txs.every((t) => picked.has(t.id));
  const filtered = FILTERS.some((k) => f[k]);

  async function deleteRule(id: number) {
    await api(`/rules/${id}`, 'DELETE');
    reloadRules();
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="row">
        <label className="field">Account
          <select value={f.account} onChange={(e) => set('account', e.target.value)}>
            <option value="">All</option>
            <option value="personal">All personal</option><option value="business">All business</option>
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.owner === 'business' ? ' (business)' : ''}</option>)}
          </select></label>
        <label className="field">Category
          <select value={f.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All</option><option value="__none">Uncategorised</option>
            {meta?.categories.map((c) => <option key={c}>{c}</option>)}
          </select></label>
        <label className="field">From<input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="field">To<input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set('to', e.target.value)} /></label>
        <label className="field">Search<input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="description…" /></label>
        {filtered && <button className="btn" onClick={() => setF(Object.fromEntries(FILTERS.map((k) => [k, ''])) as Filters)}>Clear filters</button>}
      </div>

      {data && data.total > 0 && (
        <div className="tx-totals">
          <span><b>{data.total.toLocaleString('en-GB')}</b> line{data.total === 1 ? '' : 's'}</span>
          <span>In <b className="good">{fmtMoney(data.moneyIn)}</b></span>
          <span>Out <b>{fmtMoney(data.moneyOut)}</b></span>
          <span>Net <b className={data.moneyIn - data.moneyOut >= 0 ? 'good' : 'bad'}>{fmtMoney(data.moneyIn - data.moneyOut)}</b></span>
          <span className="muted small">in złoty at each day's rate</span>
        </div>)}
      {note && <div className="notice">{note}</div>}

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

      {picked.size > 0 && (
        <div className="bulk-bar">
          <b>{picked.size} selected</b>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} aria-label="Category for the selected lines">
            <option value="">Uncategorised</option>{meta?.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="btn small primary" onClick={fileMany}>File {picked.size === 1 ? 'it' : 'them'}</button>
          <button className="btn small" onClick={() => setPicked(new Set())}>Clear</button>
        </div>)}

      <div className="card scroll">
        {!txs ? <SkeletonRows rows={12} /> : txs.length === 0 ? <div className="muted">No transactions. Import a statement first.</div> : (
          <table>
            <thead><tr><th className="pick"><input type="checkbox" checked={allPicked} aria-label="Select every line on this page"
              onChange={() => setPicked(allPicked ? new Set() : new Set(txs.map((t) => t.id)))} /></th><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className={picked.has(t.id) ? 'picked' : ''}>
                  <td className="pick"><input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.description}`} /></td>
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
