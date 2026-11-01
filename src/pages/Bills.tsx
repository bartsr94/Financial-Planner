import { useState } from 'react';
import { api, fmtDate, fmtMoneyExact, type Bill } from '../api.ts';
import { useGet } from '../hooks.ts';
import { SkeletonPage } from '../Skeleton.tsx';

interface Meta { categories: string[]; today: string }
interface CalItem { billId: number; name: string; amount: number; date: string }
interface Payment { id: number; name: string; due_date: string; paid_date: string; amount: number }
interface Suggestion { key: string; frequency: string; amount: number; amountVaries: boolean; nextDue: string; last: string; count: number; category: string | null; monthly: number }

const FREQ = ['weekly', 'monthly', 'quarterly', 'yearly', 'once'];
// "ORANGE DOLADOWANIA.ORANGE.PL" → "Orange Doladowania.orange.pl", a starting name the user can edit
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
const blank = (today: string) => ({ name: '', amount: '', amount_varies: false, frequency: 'monthly', next_due: today, category: 'Housing', match_pattern: '', notes: '' });

export function Bills() {
  const { data: bills, error, reload } = useGet<Bill[]>('/bills');
  const { data: meta } = useGet<Meta>('/meta');
  const { data: cal, reload: reloadCal } = useGet<CalItem[]>('/bills/calendar');
  const { data: paid, reload: reloadPaid } = useGet<Payment[]>('/bills/payments');
  const { data: suggested, reload: reloadSuggested } = useGet<Suggestion[]>('/bills/suggestions');
  const [form, setForm] = useState<ReturnType<typeof blank> & { id?: number } | null>(null);
  const [msg, setMsg] = useState('');

  const refresh = () => { reload(); reloadCal(); reloadPaid(); reloadSuggested(); };

  function adopt(r: Suggestion) {
    setMsg('');
    setForm({
      name: titleCase(r.key), amount: String(r.amount), amount_varies: r.amountVaries, frequency: r.frequency,
      next_due: r.nextDue, category: r.category ?? 'Misc', match_pattern: r.key, notes: '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function dismiss(r: Suggestion) {
    await api('/bills/suggestions/dismiss', 'POST', { key: r.key });
    reloadSuggested();
  }
  const set = (patch: Partial<NonNullable<typeof form>>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function save() {
    if (!form) return;
    const body = { ...form, amount: Number(String(form.amount).replace(',', '.')) || 0 };
    try {
      if (form.id) await api(`/bills/${form.id}`, 'PUT', body); else await api('/bills', 'POST', body);
      setForm(null); setMsg(''); refresh();
    } catch (e) { setMsg((e as Error).message); }
  }

  async function pay(b: Bill) {
    let amount = b.amount;
    if (b.amount_varies) {
      const typed = window.prompt(`Amount paid for ${b.name}?`, String(b.amount));
      if (typed === null) return;
      amount = Number(typed.replace(',', '.'));
      if (!Number.isFinite(amount)) return;
    }
    await api(`/bills/${b.id}/pay`, 'POST', { amount });
    refresh();
  }

  if (error) return <p className="error">{error}</p>;
  if (!bills || !meta) return <SkeletonPage cards={2} />;

  return (
    <>
      <div className="row">
        <button className="btn primary" onClick={() => setForm(blank(meta.today))}>+ Add bill</button>
      </div>

      {form && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row">
            <label className="field">Name<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Electricity" /></label>
            <label className="field">Amount (PLN)<input value={form.amount} onChange={(e) => set({ amount: e.target.value })} style={{ width: 100 }} /></label>
            <label className="field">Next due<input type="date" value={form.next_due} onChange={(e) => set({ next_due: e.target.value })} /></label>
            <label className="field">Repeats
              <select value={form.frequency} onChange={(e) => set({ frequency: e.target.value })}>{FREQ.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label className="field">Category
              <select value={form.category} onChange={(e) => set({ category: e.target.value })}>{meta.categories.map((c) => <option key={c}>{c}</option>)}</select></label>
          </div>
          <div className="row">
            <label className="field">Bank text to match (optional)
              <input value={form.match_pattern} onChange={(e) => set({ match_pattern: e.target.value })} placeholder="e.g. TAURON" style={{ width: 220 }} /></label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.amount_varies} onChange={(e) => set({ amount_varies: e.target.checked })} /> Amount varies (utilities)</label>
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn" onClick={() => { setForm(null); setMsg(''); }}>Cancel</button>
          </div>
          <div className="sub">When an imported bank payment contains the match text, the bill is marked paid and moves to its next due date.</div>
          {msg && <div className="error">{msg}</div>}
        </div>
      )}

      <div className="card scroll" style={{ marginBottom: 12 }}>
        <h2>Bills</h2>
        {bills.length === 0 ? <div className="muted">No bills yet. Add utilities, mortgage, insurance, subscriptions.</div> : (
          <table>
            <thead><tr><th>Bill</th><th>Due</th><th>Repeats</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td>{b.name} {b.status !== 'upcoming' && <span className={`pill ${b.status}`}>{b.status === 'overdue' ? 'overdue' : 'due soon'}</span>}
                    <div className="sub">{b.category}{b.match_pattern ? ` · matches “${b.match_pattern}”` : ''}</div></td>
                  <td>{fmtDate(b.next_due)}</td>
                  <td>{b.frequency}</td>
                  <td className="num">{b.amount_varies ? '≈ ' : ''}{fmtMoneyExact(b.amount)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small primary" onClick={() => pay(b)}>Mark paid</button>{' '}
                    <button className="btn small" onClick={() => setForm({ ...b, amount: String(b.amount), amount_varies: !!b.amount_varies, match_pattern: b.match_pattern ?? '' })}>Edit</button>{' '}
                    <button className="btn small" onClick={() => { if (confirm(`Delete ${b.name}?`)) api(`/bills/${b.id}`, 'DELETE').then(refresh); }}>✕</button>
                  </td>
                </tr>))}
            </tbody>
          </table>)}
      </div>

      {suggested && suggested.length > 0 && (
        <div className="card scroll" style={{ marginBottom: 12 }}>
          <div className="card-head">
            <h2>Looks recurring</h2>
            <span className="sub">The same payee and amount on a steady schedule, found in your statements</span>
          </div>
          <table>
            <thead><tr><th>Payee</th><th>Repeats</th><th>Last paid</th><th>Next expected</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {suggested.map((r) => (
                <tr key={`${r.key}|${r.amount}`}>
                  <td className="tx-desc">{r.key}<div className="sub">{r.count} payments{r.category ? ` · ${r.category}` : ''}</div></td>
                  <td>{r.frequency}</td>
                  <td className="nowrap">{fmtDate(r.last)}</td>
                  <td className="nowrap">{fmtDate(r.nextDue)}</td>
                  <td className="num">{r.amountVaries ? '≈ ' : ''}{fmtMoneyExact(r.amount)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small primary" onClick={() => adopt(r)}>Add as bill</button>{' '}
                    <button className="btn small" onClick={() => dismiss(r)}>Not a bill</button>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>)}

      <div className="grid">
        <div className="card"><h2>Next 60 days</h2>
          {!cal || cal.length === 0 ? <div className="muted">Nothing scheduled.</div> : (
            <table><tbody>{cal.map((c, i) => (
              <tr key={i}><td>{fmtDate(c.date)}</td><td>{c.name}</td><td className="num">{fmtMoneyExact(c.amount)}</td></tr>))}</tbody></table>)}
        </div>
        <div className="card"><h2>Recently paid</h2>
          {!paid || paid.length === 0 ? <div className="muted">No payments recorded yet.</div> : (
            <table><tbody>{paid.slice(0, 15).map((p) => (
              <tr key={p.id}><td>{fmtDate(p.paid_date)}</td><td>{p.name}</td><td className="num">{fmtMoneyExact(p.amount)}</td></tr>))}</tbody></table>)}
        </div>
      </div>
    </>
  );
}
