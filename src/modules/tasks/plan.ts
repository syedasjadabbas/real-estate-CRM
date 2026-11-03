/**
 * FR-091 payment-plan arithmetic, shared by the builder (live preview) and the server (authoritative).
 * Pure functions in paisa so the client and server always agree to the rupee and paisa.
 *
 * Documented: total = area × price per sq ft; discount %; down payment %; N equal installments.
 * Not documented, so kept minimal: rounding puts any leftover paisa on the last installment, and
 * the schedule rows carry no due dates (decision 29 Oct 2026).
 */
export type ProposalSettings = {
  agentCap: number;
  managerCap: number | null;
  downPaymentPct: number;
  installmentCount: number;
  defaultPricePerSqft: number | null;
  roiPerSqft: number | null;
};

export type PlanFigures = {
  totalList: number | null;
  afterDiscount: number | null;
  downPayment: number | null;
  eachInstallment: number | null;
  roiAnnual: number | null;
};

export type PlanRow = { seq: number; label: string; description: string | null; progress: string | null; amount: number; dueOn: string | null };

/** Installments fall on the 10th of each month (questionnaire Q43). */
export const INSTALLMENT_DUE_DAY = 10;

/** The 10th of the month `offset` months after `firstMonth` ("YYYY-MM"). */
export function installmentDueOn(firstMonth: string, offset: number) {
  const [y, m] = firstMonth.split("-").map(Number);
  const total = y * 12 + (m - 1) + offset;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(INSTALLMENT_DUE_DAY).padStart(2, "0")}`;
}

const paisa = (n: number) => Math.round(n * 100);
const rupees = (p: number) => p / 100;

/** Price per sq ft for a unit: its list price ÷ area, or the default setting when it has no list price. */
export function unitPricePerSqft(unit: { areaSqft: number; basePrice: number }, defaultPricePerSqft: number | null) {
  if (unit.basePrice > 0 && unit.areaSqft > 0) return rupees(Math.round(paisa(unit.basePrice) / unit.areaSqft));
  return defaultPricePerSqft;
}

export function computeFigures(input: {
  areaSqft: number | null;
  pricePerSqft: number | null;
  discountPct: number;
  downPaymentPct: number;
  installmentCount: number;
  roiPerSqft: number | null;
}): PlanFigures {
  const { areaSqft, pricePerSqft } = input;
  const roiAnnual = areaSqft && input.roiPerSqft ? rupees(paisa(areaSqft * input.roiPerSqft)) : null;
  if (!areaSqft || !pricePerSqft) return { totalList: null, afterDiscount: null, downPayment: null, eachInstallment: null, roiAnnual };
  const total = paisa(areaSqft * pricePerSqft);
  const after = Math.round((total * (100 - input.discountPct)) / 100);
  const down = Math.round((after * input.downPaymentPct) / 100);
  const each = input.installmentCount > 0 ? Math.floor((after - down) / input.installmentCount) : 0;
  return { totalList: rupees(total), afterDiscount: rupees(after), downPayment: rupees(down), eachInstallment: rupees(each), roiAnnual };
}

/** Rebuilds the schedule: a down-payment row, then N recurring rows; the last row absorbs rounding. */
/**
 * Down payment plus N installments; the rounding remainder goes on the last one (Q37). With a first
 * installment month, installment i is due on the 10th of month i (Q43); the down payment has no
 * date until the client decides when it is due (C-27).
 */
export function buildRows(figures: PlanFigures, installmentCount: number, recurringLabel: string, firstInstallmentMonth: string | null = null): PlanRow[] {
  if (figures.afterDiscount === null || figures.downPayment === null) return [];
  const after = paisa(figures.afterDiscount);
  const down = paisa(figures.downPayment);
  const each = paisa(figures.eachInstallment ?? 0);
  const rows: PlanRow[] = [{ seq: 1, label: "Down payment", description: null, progress: null, amount: rupees(down), dueOn: null }];
  for (let i = 1; i <= installmentCount; i++) {
    const amount = i === installmentCount ? after - down - each * (installmentCount - 1) : each;
    const dueOn = firstInstallmentMonth ? installmentDueOn(firstInstallmentMonth, i - 1) : null;
    rows.push({ seq: i + 1, label: `Installment ${i}`, description: recurringLabel || null, progress: null, amount: rupees(amount), dueOn });
  }
  return rows;
}

export function rowsTotal(rows: { amount: number }[]) {
  return rupees(rows.reduce((sum, r) => sum + paisa(r.amount), 0));
}
