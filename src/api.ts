export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
const moneyExact = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
export const fmtMoney = (n: number) => money.format(n);
export const fmtMoneyExact = (n: number) => moneyExact.format(n);
export const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface Account { id: number; name: string; bank: string; kind: 'cash' | 'investment' | 'asset' | 'debt'; owner: 'personal' | 'business'; balance: number; source: string }
export interface Bill { id: number; name: string; amount: number; amount_varies: number; frequency: string; next_due: string; category: string; match_pattern: string | null; notes: string; status: 'overdue' | 'due-soon' | 'upcoming' }
export interface Tx { id: number; account_id: number; account: string; owner: string; date: string; amount: number; description: string; category: string | null }
