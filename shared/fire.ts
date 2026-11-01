// Growing investments towards the FI number. Shared so the dashboard redraws as the monthly amount changes, and
// the server tests cover it. No Node or DOM imports.

export interface FirePath { values: number[]; fiMonths: number | null }

/**
 * Investments at the start of each year for `years` years: `invested` today plus `monthly` added at each month's end,
 * growing at `rate` a year compounded monthly. `fiMonths` is the first month the total reaches `fiNumber`, or null
 * when it doesn't within the years shown.
 */
export function projectFire(invested: number, monthly: number, rate: number, fiNumber: number, years: number): FirePath {
  const growth = Math.pow(1 + rate, 1 / 12);
  const values = [invested];
  let v = invested;
  let fiMonths: number | null = fiNumber > 0 && invested >= fiNumber ? 0 : null;
  for (let m = 1; m <= years * 12; m++) {
    v = v * growth + monthly;
    if (fiMonths === null && fiNumber > 0 && v >= fiNumber) fiMonths = m;
    if (m % 12 === 0) values.push(v);
  }
  return { values, fiMonths };
}
