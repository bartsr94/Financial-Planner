import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, amortize, billStatus, fireSummary, monthlyPayment, nextOccurrence,
  dateChunks, matchRule, monthlyTrends, occurrencesBetween, parseAmount, parseCurrency, parseDate, paymentsMade, txHash,
  balanceHistory, loanOwed, loanTotals, monthEnd, monthsBetween, type LoanLine, findTransfers, type TransferLine, findRecurring, type RecurringLine, forecastCash, explainChange, unusualCategories, businessMonths, type BusinessRow, backupsToDelete,
} from './logic.ts';
import { parseLoanHistory } from '../shared/loan.ts';
import { projectFire } from '../shared/fire.ts';
import { payoff } from '../shared/loan.ts';
import { merchantKey } from '../shared/merchant.ts';

const close = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('addMonths clamps to month end and a 31st bill returns to the 31st', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(nextOccurrence('2026-02-28', 'monthly', 31), '2026-03-31');
});

test('a 31st bill keeps its day when the stored due date was clamped', () => {
  assert.deepEqual(occurrencesBetween('2026-02-28', 'monthly', '2026-02-01', '2026-04-30', 31), ['2026-02-28', '2026-03-31', '2026-04-30']);
});

test('recurring occurrences and one-off bills', () => {
  assert.deepEqual(occurrencesBetween('2026-11-10', 'monthly', '2026-11-01', '2027-01-31'), ['2026-11-10', '2026-12-10', '2027-01-10']);
  assert.deepEqual(occurrencesBetween('2026-11-10', 'once', '2026-11-01', '2027-01-31'), ['2026-11-10']);
  assert.deepEqual(occurrencesBetween('2026-10-10', 'once', '2026-11-01', '2027-01-31'), []);
  assert.equal(nextOccurrence('2026-11-10', 'once'), null);
  assert.equal(nextOccurrence('2026-11-10', 'weekly'), '2026-11-17');
});

test('bill status', () => {
  assert.equal(billStatus('2026-10-31', '2026-11-01'), 'overdue');
  assert.equal(billStatus('2026-11-01', '2026-11-01'), 'due-soon');
  assert.equal(billStatus('2026-11-08', '2026-11-01'), 'due-soon');
  assert.equal(billStatus('2026-11-09', '2026-11-01'), 'upcoming');
});

test('mortgage matches the Amortization sheet (200k price, 20k down, 3.5%, 30y)', () => {
  close(monthlyPayment(180000, 0.035, 30), 808.2804381, 1e-6);
  const plain = amortize({ principal: 180000, apr: 0.035, years: 30, extraMonthly: 0 });
  close(plain.rows[0].interestPaid, 525);
  close(plain.rows[0].principalPaid, 283.280438, 1e-5);
  close(plain.totalInterest, 110980.9577, 0.5);
  assert.equal(plain.payments, 360);
  close(plain.rows.at(-1)!.balanceEnd, 0);
  // extra payments shorten the loan and cut interest
  const extra = amortize({ principal: 180000, apr: 0.035, years: 30, extraMonthly: 500 });
  assert.ok(extra.payments < 360 && extra.totalInterest < plain.totalInterest);
  close(extra.rows.at(-1)!.balanceEnd, 0);
});

test('payments made counts the first payment date and each monthly date since', () => {
  assert.equal(paymentsMade('2026-01-15', '2026-01-14'), 0);
  assert.equal(paymentsMade('2026-01-15', '2026-01-15'), 1);
  assert.equal(paymentsMade('2026-01-15', '2026-02-14'), 1);
  assert.equal(paymentsMade('2026-01-15', '2026-02-15'), 2);
  assert.equal(paymentsMade('2025-05-28', '2026-11-01'), 18);
  assert.equal(paymentsMade('2030-01-01', '2026-01-01'), 0);
});

test('FIRE numbers match the Dashboard sheet (spend 18922, 4%, 6.8% return, age 32 -> 65)', () => {
  const f = fireSummary({
    yearlySpend: 18922, withdrawalRate: 0.04, netWorth: 448167, investments: 917167,
    stockAllocation: 0.95, stockGrowth: 0.07, bondGrowth: 0.03, currentAge: 32, retirementAge: 65,
  });
  close(f.fiNumber, 473050);
  close(f.returnRate, 0.068, 1e-9);
  close(f.coastFi, 53957.9, 1);
  close(f.investedCoversYearly, 36686.68);
  assert.equal(f.coastReached, true);
  assert.equal(fireSummary({ yearlySpend: 0, withdrawalRate: 0, netWorth: 0, investments: 0, stockAllocation: 1, stockGrowth: 0.07, bondGrowth: 0.03, currentAge: 30, retirementAge: 30 }).fiNumber, 0);
});

test('Polish amounts and dates', () => {
  assert.equal(parseAmount('-1 234,56'), -1234.56);
  assert.equal(parseAmount('1 234,56 PLN'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('−12,00'), -12);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('Kwota'), null);
  assert.equal(parseDate('2026-10-31'), '2026-10-31');
  assert.equal(parseDate('31-10-2026'), '2026-10-31');
  assert.equal(parseDate('31.10.2026'), '2026-10-31');
  assert.equal(parseDate('31.02.2026'), null);
  assert.equal(parseDate('Data'), null);
});

test('transaction hash is stable, and separates identical lines by occurrence', () => {
  const a = txHash('2026-10-01', -12.5, 'Coffee  Shop', 1);
  assert.equal(a, txHash('2026-10-01', -12.5, 'coffee shop', 1));
  assert.notEqual(a, txHash('2026-10-01', -12.5, 'coffee shop', 2));
  assert.notEqual(a, txHash('2026-10-02', -12.5, 'coffee shop', 1));
});

test('rules match Polish capitals and padded text, and the most specific rule wins', () => {
  const rules = [{ pattern: 'żabka', category: 'Groceries' }, { pattern: 'ZAKUP PRZY UŻYCIU', category: 'Misc' }, { pattern: 'żabka  zakup przy użyciu karty', category: 'Eating Out' }];
  assert.equal(matchRule(rules, 'Żabka  ZAKUP PRZY UŻYCIU KARTY W KRAJU')?.category, 'Eating Out');
  assert.equal(matchRule(rules, 'ŻABKA Z5555')?.category, 'Groceries');
  assert.equal(matchRule([{ pattern: 'UŻYCIU KARTY', category: 'X' }], 'zakup przy użyciu   karty')?.category, 'X');
  assert.equal(matchRule(rules, 'Biedronka'), undefined);
  assert.equal(matchRule([{ pattern: '  ', category: 'X' }], 'anything'), undefined);
});

test('monthly trends fill empty months, fold small categories into Other, and keep colours stable', () => {
  const rows = [
    { month: '2026-08', category: 'Groceries', income: 0, expenses: 500 },
    { month: '2026-08', category: 'Income', income: 8000, expenses: 0 },
    { month: '2026-10', category: 'Groceries', income: 0, expenses: 300 },
    { month: '2026-10', category: 'Fees', income: 0, expenses: 20 },
    { month: '2026-10', category: 'Gym', income: 0, expenses: 10 },
  ];
  const t = monthlyTrends(rows, '2026-08', '2026-11', 2);
  assert.deepEqual(t.categories, ['Groceries', 'Fees', 'Other']);
  assert.deepEqual(t.months.map((m) => m.month), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.equal(t.months[0].net, 7500);
  close(t.months[0].savingsRate!, 0.9375);
  assert.equal(t.months[1].savingsRate, null);
  assert.deepEqual(t.months[2].byCategory, { Groceries: 300, Fees: 20, Other: 10 });
  assert.deepEqual(monthlyTrends(rows, '2026-12', '2027-01').months.map((m) => m.month), ['2026-12', '2027-01']);
});

test('the currency after an amount, and NBP-sized date ranges', () => {
  assert.equal(parseCurrency('-385,48 PLN'), 'PLN');
  assert.equal(parseCurrency('1 200,00 eur '), 'EUR');
  assert.equal(parseCurrency('-12,00'), null);
  assert.equal(parseAmount('-1 200,50 EUR'), -1200.5);
  assert.deepEqual(dateChunks('2026-01-01', '2026-01-05', 2), [['2026-01-01', '2026-01-02'], ['2026-01-03', '2026-01-04'], ['2026-01-05', '2026-01-05']]);
  assert.deepEqual(dateChunks('2025-01-01', '2026-11-01'), [['2025-01-01', '2025-12-26'], ['2025-12-27', '2026-11-01']]);
  assert.deepEqual(dateChunks('2026-11-02', '2026-11-01'), []);
});

test('balance history works back from today through transactions, else carries snapshots forward', () => {
  const months = ['2026-01', '2026-02', '2026-03'];
  const tx = [{ date: '2026-02-10', amount: 100 }, { date: '2026-03-05', amount: -30 }];
  assert.deepEqual(balanceHistory(months, 570, tx, []), [null, 600, 570]);
  assert.deepEqual(balanceHistory(months, 570, tx, [{ month: '2026-01', balance: 480 }]), [480, 600, 570]);
  assert.deepEqual(balanceHistory(months, 9, [], [{ month: '2026-02', balance: 5 }, { month: '2026-01', balance: 3 }]), [3, 5, 5]);
  assert.deepEqual(balanceHistory(months, 9, [], []), [null, null, null]);
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(monthEnd('2028-02'), '2028-02-29');
});

test('loan owed per month and totals', () => {
  const lines: LoanLine[] = [
    { date: '2025-04-24', kind: 'drawdown', amount: 200000, balanceAfter: 200000 },
    { date: '2025-05-28', kind: 'interest', amount: 2326.9, balanceAfter: null },
    { date: '2025-05-28', kind: 'principal', amount: 844.69, balanceAfter: 199155.31 },
    { date: '2025-05-29', kind: 'principal', amount: 2100, balanceAfter: 197055.31 },
    { date: '2025-05-29', kind: 'interest', amount: 64.19, balanceAfter: null },
  ];
  assert.deepEqual(loanOwed(['2025-03', '2025-04', '2025-05', '2025-06'], lines), [null, 200000, 197055.31, 197055.31]);
  const t = loanTotals(lines, '2025-06-15');
  close(t.principalRepaid, 2944.69);
  close(t.interestPaid, 2391.09);
  assert.equal(t.borrowed, 200000);
  assert.equal(t.owed, 197055.31);
});

test('mBank loan history CSV', () => {
  const csv = [
    '"Historia kredytu z dnia: 01-11-2026";', '',
    '"#Data";"#Data księgowania";"#Opis";"#Kwota";"#Waluta";"#Kwota pozostała do spłaty";"#Waluta"',
    '"24-04-2025";"24-04-2025";"otwarcie kredytu - kapitał";"200000.00";"PLN";"200000.00";"PLN"',
    '"28-05-2025";"28-05-2025";"zmiana wysokości odsetek";"0.00";"";"0.00";""',
    '"28-05-2025";"28-05-2025";"spłata raty - odsetki";"2326.90";"PLN";"0.00";"PLN"',
    '"29-05-2025";"29-05-2025";"częś.spłata kredytu - kapitał";"2100.00";"PLN";"197055.31";"PLN"',
  ].join('\r\n');
  assert.deepEqual(parseLoanHistory(csv).map((e) => [e.date, e.kind, e.amount, e.balanceAfter]), [
    ['2025-04-24', 'drawdown', 200000, 200000],
    ['2025-05-28', 'interest', 2326.9, null],
    ['2025-05-29', 'principal', 2100, 197055.31],
  ]);
});

test('Pekao loan CSV splits each payment by the fall in capital owed', () => {
  const csv = [
    'Data księgowania;Typ operacji;Wartość;Kapitał do spłaty',
    '28.07.2025;LOAN PAYMENT - AUTO DEBIT;790,12 EUR;98 802,13',
    '30.06.2025;LOAN PAYMENT - AUTO DEBIT;790,12 EUR;99 027,68',
    '08.05.2025;LOAN ADVANCE;-99 556,35 EUR;99 556,35',
  ].join('\r\n');
  assert.deepEqual(parseLoanHistory(csv).map((e) => [e.date, e.kind, e.amount, e.balanceAfter]), [
    ['2025-05-08', 'drawdown', 99556.35, 99556.35],
    ['2025-06-30', 'principal', 528.67, 99027.68],
    ['2025-06-30', 'interest', 261.45, null],
    ['2025-07-28', 'principal', 225.55, 98802.13],
    ['2025-07-28', 'interest', 564.57, null],
  ]);
});

test('own transfers: the bank marker, and same-currency pairs across accounts', () => {
  const l = (id: number, accountId: number, date: string, amount: number, description = 'X', currency = 'PLN'): TransferLine => ({ id, accountId, date, amount, currency, description });
  const ids = findTransfers([
    l(1, 1, '2026-05-01', -500, 'JAN KOWALSKI, OSZCZĘDNOŚCI PRZELEW WŁASNY 12345678'),
    l(2, 1, '2026-05-02', -1200), l(3, 2, '2026-05-04', 1200), // a pair two days apart
    l(4, 1, '2026-05-02', -300), l(5, 1, '2026-05-02', 300),   // same account: a refund, not a transfer
    l(6, 1, '2026-05-10', -900), l(7, 2, '2026-05-20', 900),   // too far apart
    l(8, 1, '2026-05-10', -900, 'X', 'PLN'), l(9, 3, '2026-05-10', 900, 'Y', 'EUR'), // different currency
    l(10, 1, '2026-06-01', -3777, 'URZĄD SKARBOWY, VAT-7'), l(11, 2, '2026-06-01', 3777), // tax never pairs
  ]);
  assert.deepEqual(ids.sort((a, b) => a - b), [1, 2, 3]);
});

test('an incoming line pairs once, with the nearest outgoing line', () => {
  const l = (id: number, accountId: number, date: string, amount: number): TransferLine => ({ id, accountId, date, amount, currency: 'PLN', description: 'X' });
  assert.deepEqual(findTransfers([l(1, 1, '2026-05-01', -100), l(2, 1, '2026-05-03', -100), l(3, 2, '2026-05-03', 100)]).sort(), [1, 3]);
});

test('merchant key drops the bank boilerplate and stays a leading piece of the description', () => {
  assert.equal(merchantKey('ZIKO APTEKA KRAKOW ZAKUP PRZY UŻYCIU KARTY W KRAJU'), 'ZIKO APTEKA KRAKOW');
  assert.equal(merchantKey('LIDL KRAKOW · *********0090658'), 'LIDL KRAKOW');
  assert.equal(merchantKey('WALDEMAR WNĘK, CZYNSZ 61114020040000'), 'WALDEMAR WNĘK, CZYNSZ');
  assert.equal(merchantKey('Netflix'), 'Netflix');
});

test('a long merchant key ends at a whole word', () => {
  assert.equal(merchantKey('BARTOSZ RZĄSA, TRANSFER UL.DIETLA 80 M.40 31-073 KRAKÓW'), 'BARTOSZ RZĄSA, TRANSFER UL.DIETLA 80');
});

test('recurring payments: a monthly stream inside a merchant, a stopped one, an irregular one', () => {
  const l = (key: string, date: string, amount: number, category: string | null = null): RecurringLine => ({ key, date, amount, category });
  const lines = [
    // a 392 subscription, with occasional large tax payments through the same service
    ...['2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01', '2026-10-01'].map((d) => l('INFAKT', d, -392, 'Fees')),
    l('INFAKT', '2026-06-02', -6022), l('INFAKT', '2026-08-11', -6722),
    // stopped in June: the next payment is months overdue
    ...['2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10'].map((d) => l('GYM', d, -150)),
    // a shop visited at random
    ...['2026-09-01', '2026-09-03', '2026-09-20', '2026-10-02', '2026-10-30'].map((d) => l('LIDL', d, -80)),
  ];
  const r = findRecurring(lines, '2026-11-01');
  assert.equal(r.length, 1);
  assert.deepEqual({ key: r[0].key, frequency: r[0].frequency, amount: r[0].amount, nextDue: r[0].nextDue, category: r[0].category, varies: r[0].amountVaries },
    { key: 'INFAKT', frequency: 'monthly', amount: 392, nextDue: '2026-11-01', category: 'Fees', varies: false });
});

test('two payments to one merchant on a day count as one', () => {
  const l = (date: string, amount: number): RecurringLine => ({ key: 'ZUS', date, amount, category: null });
  const r = findRecurring(['2026-08-15', '2026-09-15', '2026-10-15'].flatMap((d) => [l(d, -400), l(d, -1000)]), '2026-11-01');
  assert.equal(r[0]?.amount, 1400);
});

test('cash forecast: median month, and only the rest of this month', () => {
  const history = [{ income: 10000, expenses: 8000 }, { income: 30000, expenses: 9000 }, { income: 12000, expenses: 7000 }];
  const f = forecastCash(50000, history, '2026-11-15', 2); // 15 of 30 days left
  assert.equal(f.income, 12000);
  assert.equal(f.spending, 8000);
  assert.deepEqual(f.months.map((m) => [m.month, m.balance]), [['2026-11', 52000], ['2026-12', 56000], ['2027-01', 60000]]);
});

test('net worth change: what moved, and what the exchange rate did', () => {
  // 1,000 EUR at 4.20 becomes 1,100 EUR at 4.30: 100 EUR moved (430 zł) and the old 1,000 gained 100 zł
  const c = explainChange(1000, 1100, 4.2, 4.3);
  assert.equal(Math.round(c.moved), 430);
  assert.equal(Math.round(c.fx), 100);
  assert.equal(Math.round(c.total), 530);
  assert.deepEqual(explainChange(null, 500, 0, 1), { moved: 500, fx: 0, total: 500 });
});

test('unusual categories: well above or below the median of the months before', () => {
  const rows = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].flatMap((m) => [
    { month: m, category: 'Eating Out', expenses: 1000 }, { month: m, category: 'Groceries', expenses: 2000 }, { month: m, category: 'Fees', expenses: 50 },
  ]);
  rows.push({ month: '2026-10', category: 'Eating Out', expenses: 2500 }, { month: '2026-10', category: 'Groceries', expenses: 2100 },
    { month: '2026-10', category: 'Fees', expenses: 200 });
  const u = unusualCategories(rows, '2026-10');
  // Groceries is only 5% up, Fees 150 zł up, and missing Fees would be a 0; Eating Out stands out
  assert.deepEqual(u.map((x) => [x.category, x.diff]), [['Eating Out', 1500]]);
});

test('FIRE path: monthly additions compound, and the month the FI number is reached', () => {
  // no growth: 10,000 plus 1,000 a month reaches 34,000 after two years, and 30,000 in month 20
  const flat = projectFire(10000, 1000, 0, 30000, 2);
  assert.deepEqual(flat.values, [10000, 22000, 34000]);
  assert.equal(flat.fiMonths, 20);
  // 12% a year compounded monthly grows 100,000 to 112,000 in a year, give or take rounding
  assert.equal(Math.round(projectFire(100000, 0, 0.12, 0, 1).values[1]), 112000);
  assert.equal(projectFire(1000, 0, 0.05, 1e9, 3).fiMonths, null);
  assert.equal(projectFire(5000, 0, 0.05, 4000, 1).fiMonths, 0);
});

test('mortgage payoff: overpaying shortens the loan and saves interest', () => {
  // 100,000 at 6% over 20 years: the same payment from the start repays it in 240 payments, with amortize's interest
  const pmt = monthlyPayment(100000, 0.06, 20);
  const plain = payoff(100000, 0.06, pmt);
  assert.equal(plain.payments, 240);
  assert.equal(Math.round(plain.interest), Math.round(amortize({ principal: 100000, apr: 0.06, years: 20, extraMonthly: 0 }).totalInterest));
  const more = payoff(100000, 0.06, pmt, 200);
  assert.ok(more.payments < 180 && more.interest < plain.interest * 0.75);
  assert.ok(payoff(100000, 0.06, pmt, 0, 20000).payments < 200);
  assert.deepEqual(payoff(0, 0.06, pmt), { payments: 0, interest: 0 });
});

test('business months: revenue less costs, taxes and what was paid out', () => {
  const rows: BusinessRow[] = [
    { month: '2026-09', bucket: 'revenue', category: 'Salary', amount: 30000 },
    { month: '2026-09', bucket: 'cost', category: 'Software', amount: -1000 },
    { month: '2026-09', bucket: 'tax', category: 'Taxes', amount: -6000 },
    // 10,000 to the owner, and 5,000 between two business accounts that cancels
    { month: '2026-09', bucket: 'transfer', category: 'Transfer', amount: -15000 },
    { month: '2026-09', bucket: 'transfer', category: 'Transfer', amount: 5000 },
  ];
  assert.deepEqual(businessMonths(rows, ['2026-09', '2026-10']), [
    { month: '2026-09', revenue: 30000, costs: 1000, taxes: 6000, paidOut: 10000, kept: 13000 },
    { month: '2026-10', revenue: 0, costs: 0, taxes: 0, paidOut: 0, kept: 0 },
  ]);
});

test('backupsToDelete keeps the newest automatic backups and ignores manual ones', () => {
  const names = ['auto-2026-10-30.db', 'planner-before-merge.db', 'auto-2026-11-01.db', 'auto-2026-10-31.db', 'auto-notes.txt'];
  assert.deepEqual(backupsToDelete(names, 2), ['auto-2026-10-30.db']);
  assert.deepEqual(backupsToDelete(names, 14), []);
});
