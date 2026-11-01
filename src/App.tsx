import { useState } from 'react';
import { Dashboard } from './pages/Dashboard.tsx';
import { Bills } from './pages/Bills.tsx';
import { Transactions } from './pages/Transactions.tsx';
import { Accounts } from './pages/Accounts.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { Mortgage } from './pages/Mortgage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

const TABS = {
  Dashboard, Bills, Transactions, Accounts, Import: ImportPage, Mortgage, Settings: SettingsPage,
} as const;
type Tab = keyof typeof TABS;

export function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('tab');
    return saved && saved in TABS ? (saved as Tab) : 'Dashboard';
  });
  const Page = TABS[tab];
  return (
    <div className="app">
      <header className="top">
        <h1>Finance Planner</h1>
        <nav>
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => { setTab(t); localStorage.setItem('tab', t); }}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      <Page />
    </div>
  );
}
