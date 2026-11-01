import { useState } from 'react';
import { api } from '../api.ts';
import { useGet } from '../hooks.ts';
import { SkeletonPage } from '../Skeleton.tsx';

const FIELDS: { key: string; label: string; hint: string; percent?: boolean }[] = [
  { key: 'withdrawalRate', label: 'Safe withdrawal rate (%)', hint: 'The 4% rule is the default', percent: true },
  { key: 'stockAllocation', label: 'Stocks share of portfolio (%)', hint: 'Rest is treated as bonds', percent: true },
  { key: 'stockGrowth', label: 'Expected stock growth (% a year)', hint: 'Nominal', percent: true },
  { key: 'bondGrowth', label: 'Expected bond growth (% a year)', hint: 'Nominal', percent: true },
  { key: 'currentAge', label: 'Current age', hint: '' },
  { key: 'retirementAge', label: 'Target retirement age', hint: 'Used for Coast FI' },
];

export function SettingsPage() {
  const { data: s, error, reload } = useGet<Record<string, string>>('/settings');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <SkeletonPage cards={2} />;

  const shown = (f: (typeof FIELDS)[number]) => edits[f.key] ?? (f.percent ? String(+(Number(s[f.key]) * 100).toFixed(2)) : s[f.key]);

  async function save() {
    const body: Record<string, number> = {};
    for (const f of FIELDS) {
      if (edits[f.key] === undefined) continue;
      const n = Number(edits[f.key].replace(',', '.'));
      if (Number.isFinite(n)) body[f.key] = f.percent ? n / 100 : n;
    }
    await api('/settings', 'PUT', body);
    setEdits({}); setSaved(true); reload();
  }

  return (
    <div className="card">
      <h2>FIRE assumptions</h2>
      <div className="row" style={{ alignItems: 'start' }}>
        {FIELDS.map((f) => (
          <label className="field" key={f.key}>{f.label}
            <input value={shown(f)} onChange={(e) => { setSaved(false); setEdits({ ...edits, [f.key]: e.target.value }); }} style={{ width: 150 }} />
            <span>{f.hint}</span></label>))}
      </div>
      <button className="btn primary" onClick={save} disabled={Object.keys(edits).length === 0}>Save</button>
      {saved && <span className="ok" style={{ marginLeft: 10 }}>Saved</span>}
      <div className="sub" style={{ marginTop: 10 }}>Your FI number is your average monthly spending (from imported personal transactions) × 12 ÷ the withdrawal rate. Business accounts are excluded.</div>
    </div>
  );
}
