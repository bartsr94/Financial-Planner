import { useState } from 'react';
import { api, fmtDate, fmtMoney } from '../api.ts';
import { useGet } from '../hooks.ts';

interface Group { key: string; count: number; spent: number; received: number; accounts: string[]; first: string; last: string; example: string }

/** Uncategorised lines grouped by merchant. Filing a group saves a rule, so later imports file it too. */
export function Review() {
  const { data, error, reload } = useGet<{ lines: number; groupCount: number; groups: Group[] }>('/review');
  const { data: meta } = useGet<{ categories: string[] }>('/meta');
  const [note, setNote] = useState('');

  async function file(pattern: string, category: string) {
    const r = await api<{ categorised: number }>('/rules', 'POST', { pattern, category });
    setNote(`Filed ${r.categorised} line${r.categorised === 1 ? '' : 's'} under ${category}, and saved the rule for future imports.`);
    reload();
  }

  async function findTransfers() {
    const r = await api<{ categorised: number; transfers: number }>('/rules/apply', 'POST', {});
    setNote(`${r.transfers} move${r.transfers === 1 ? '' : 's'} between your own accounts filed as Transfer${r.categorised ? `, and ${r.categorised} line${r.categorised === 1 ? '' : 's'} filed by existing rules` : ''}.`);
    reload();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <div className="muted">Loading…</div>;
  const groupSpent = data.groups.reduce((s, g) => s + g.spent, 0);

  return (
    <>
      <div className="card review-head">
        <div>
          <div className="big">{data.lines.toLocaleString('en-GB')} uncategorised</div>
          <div className="sub">
            {data.groupCount.toLocaleString('en-GB')} merchants. Uncategorised lines count as spending in no category, so the
            dashboard can't say where the money went. Filing a merchant saves a rule; it never changes a category you set by hand.
          </div>
        </div>
        <button className="btn" onClick={findTransfers}>Find transfers between my accounts</button>
      </div>
      {note && <div className="notice">{note}</div>}

      {data.groups.length === 0 ? <div className="card muted">Nothing to review. Every line has a category.</div> : (
        <div className="card scroll">
          <div className="card-head">
            <h2>Biggest first</h2>
            <span className="sub">The top {data.groups.length} cover {fmtMoney(groupSpent)} of spending</span>
          </div>
          <table>
            <thead><tr><th>Merchant</th><th className="num">Lines</th><th className="num">Out</th><th className="num">In</th><th>File as</th></tr></thead>
            <tbody>{data.groups.map((g) => <GroupRow key={g.key} g={g} categories={meta?.categories ?? []} onFile={file} />)}</tbody>
          </table>
        </div>)}
    </>
  );
}

function GroupRow({ g, categories, onFile }: { g: Group; categories: string[]; onFile: (pattern: string, category: string) => void }) {
  const [pattern, setPattern] = useState(g.key);
  const [category, setCategory] = useState('');
  const span = g.first === g.last ? fmtDate(g.first) : `${fmtDate(g.first)} – ${fmtDate(g.last)}`;
  return (
    <tr>
      <td className="tx-desc">
        <input className="review-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Text a rule matches" title="A rule files every line containing this text" />
        <div className="sub" title={g.example}>{span} · {g.accounts.join(', ')}</div>
      </td>
      <td className="num">{g.count}</td>
      <td className="num">{g.spent ? fmtMoney(g.spent) : ''}</td>
      <td className="num good">{g.received ? fmtMoney(g.received) : ''}</td>
      <td>
        <div className="review-file">
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">—</option>{categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="btn small primary" disabled={!category || !pattern.trim()} onClick={() => onFile(pattern.trim(), category)}>File</button>
        </div>
      </td>
    </tr>
  );
}
