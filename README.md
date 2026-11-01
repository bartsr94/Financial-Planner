# Finance Planner

A local, private finance dashboard: net worth, FIRE progress, bills and due dates, mortgage, and
transactions. Everything is stored in a SQLite file on this PC (`data/planner.db`, git-ignored).

## Run it

Needs Node 24 or newer.

```bash
npm install
npm start        # builds the UI and serves it at http://localhost:3001
```

For development, `npm run dev` runs the API (port 3001) and Vite (hot reload) together.
`npm test` is not wired up; run `npx tsx --test server/logic.test.ts`. `npm run typecheck` checks types.

## What is in it

- **Dashboard**: month-on-month charts of income and spending, money saved each month, and
  spending by category over time. Pick a range (6M to all history) and Personal, Business or Both.
  Click a month to see its category breakdown against the month before. Also net worth, savings
  rate, FI progress and upcoming bills.
- **Bills**: due dates, repeats (weekly to yearly), mark paid, 60-day calendar. A bill can carry a
  match text (for example `TAURON`); an imported payment containing it marks the bill paid.
- **Transactions**: filter, recategorise, make a rule from a correction.
- **Accounts**: personal and business. Business accounts are kept out of net worth, spending and FI.
- **Import**: bank CSV statements (mBank, Pekao and others). Handles Polish amounts and dates,
  windows-1250 encoding, preamble lines and `#` headers. Re-importing the same period is safe.
- **Mortgage**: fixed-rate amortisation with an optional extra monthly payment.
- **Settings**: FIRE assumptions from the old spreadsheet.

## Bank connection (not built yet)

Plan: Enable Banking, which is free for linking your own personal accounts. Pekao and mBank
personal accounts connect through a redirect and approval in the bank's app. Consent lasts about
180 days and history is typically about 90 days. The mBank business account cannot use it; import
its CSV statements instead.

## Layout

- `server/`: Express API, SQLite (`node:sqlite`), pure logic in `logic.ts` (tested).
- `shared/parse.ts`: amount and date parsing used by both the browser and the server.
- `src/`: React UI.

## Source

https://github.com/bartsr94/Financial-Planner
