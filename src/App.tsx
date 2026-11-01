import { useState, type ReactNode } from 'react';
import { Dashboard } from './pages/Dashboard.tsx';
import { Bills } from './pages/Bills.tsx';
import { Transactions } from './pages/Transactions.tsx';
import { Review } from './pages/Review.tsx';
import { Accounts } from './pages/Accounts.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { Loans } from './pages/Loans.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

// 24px line icons, drawn with the current text colour
const icon = (d: ReactNode) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const TABS = {
  Dashboard: { page: Dashboard, icon: icon(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>) },
  Bills: { page: Bills, icon: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>) },
  Transactions: { page: Transactions, icon: icon(<path d="M4 7h13l-3-3M20 17H7l3 3" />) },
  Review: { page: Review, icon: icon(<><path d="M4 6h16M4 12h10M4 18h7" /><path d="M15 17l2 2 4-4" /></>) },
  Accounts: { page: Accounts, icon: icon(<><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" /></>) },
  Import: { page: ImportPage, icon: icon(<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>) },
  Loans: { page: Loans, icon: icon(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>) },
  Settings: { page: SettingsPage, icon: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>) },
} as const;
type Tab = keyof typeof TABS;

export function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('tab');
    return saved && saved in TABS ? (saved as Tab) : 'Dashboard';
  });
  const Page = TABS[tab].page;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="logo">zł</span>Finance Planner</div>
        <nav>
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => { setTab(t); localStorage.setItem('tab', t); }}>
              {TABS[t].icon}<span>{t}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">Stored on this PC only</div>
      </aside>
      <main className="main">
        {tab !== 'Dashboard' && <div className="page-head"><h1>{tab}</h1></div>}
        <Page />
      </main>
    </div>
  );
}
