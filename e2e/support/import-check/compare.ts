/**
 * What the Firefly III and Actual Budget import checks share in comparing what Lumina holds after
 * an import with what the other app says is true
 *
 * Imports nothing, so the contract tests can run the checks' comparisons without a browser
 */

export interface LuminaAccount {
  id: string
  name: string
  account_type: string
  currency: string
  current_balance: number
  is_archived: boolean
}

export interface LuminaTransaction {
  account_id: string
  dt: string

  /** In the account's currency, as the balance counts it */
  amount: number

  /** As recorded, in the transaction's own currency */
  original_amount: number
  currency: string
  merchant_name: string | null
  category_id: string
  notes: string | null
  tags: { name: string }[]
  counterparty_account_id: string | null
}

export interface LuminaBaseBudget {
  id: string
  name: string
  currency: string
  is_archived: boolean
  recurs: boolean
  category_ids: string[]
}

export interface LuminaBudgetPeriod {
  base_budget_id: string
  period_start: string
  period_end: string
  overall_limit: number
}

/** Everything the comparisons read back from Lumina's API */
export interface LuminaSnapshot {
  accounts: LuminaAccount[]
  transactions: LuminaTransaction[]
  categories: { id: string; name: string }[]
  baseBudgets: LuminaBaseBudget[]
  budgetPeriods: LuminaBudgetPeriod[]
}

/** What identifies a difference, and what an expected one has to match */
interface DifferenceKey {
  kind: string
  subject: string
  lumina: string
}

/**
 * One difference, with the other app's value under that app's name, which the checks' reports
 * and their workflow summaries read it by
 */
export type Difference<Source extends string> = DifferenceKey & Record<Source, string>

/** A known difference, which matches only while Lumina still holds the value it names */
export interface ExpectedDifference extends DifferenceKey {
  reason: string
}

/**
 * Splits the differences into those not on the expected list, and expected ones that no longer
 * occur, so a fixed gap has to be taken off the list
 */
export function checkExpected<D extends DifferenceKey>(differences: D[], expected: ExpectedDifference[]) {
  const matches = (difference: D, entry: ExpectedDifference) => (
    entry.kind === difference.kind && entry.subject === difference.subject && entry.lumina === difference.lumina
  )
  return {
    unexpected: differences.filter((difference) => !expected.some((entry) => matches(difference, entry))),
    stale: expected.filter((entry) => !differences.some((difference) => matches(difference, entry))),
  }
}

/** Keeps one difference per kind, subject and Lumina value, counting repeats */
export class DifferenceList<Source extends string> {
  private readonly source: Source
  private readonly entries = new Map<string, DifferenceKey & { other: string; count: number }>()

  /** @param source - The other app's name for its value in each difference, such as `firefly` */
  constructor(source: Source) {
    this.source = source
  }

  add(kind: string, subject: string, other: string, lumina: string) {
    const key = JSON.stringify([kind, subject, lumina])
    const entry = this.entries.get(key)
    if (entry) {
      entry.count += 1
    } else {
      this.entries.set(key, { kind, subject, other, lumina, count: 1 })
    }
  }

  list(): Difference<Source>[] {
    return [...this.entries.values()].map(({ kind, subject, other, lumina, count }) => ({
      kind,
      subject,
      [this.source]: count > 1 ? `${other} (${count} times)` : other,
      lumina,
    }) as Difference<Source>)
  }
}

/**
 * Makes a formatter for amounts Lumina holds in minor units, from the decimal places of each
 * currency the check's data uses. Lumina can hold an amount in a currency the data never uses,
 * which is itself a difference, so it is shown as it is stored rather than stopping the comparison
 *
 * The seeds keep their own copies, `formatStored` in `actual-check/manifest.ts` and
 * `formatMinorUnits` in `firefly-check/seed/record.ts`, since each seed container mounts only its
 * own check folder
 */
export function createMinorUnitsFormatter(exponents: Record<string, number>) {
  return (minorUnits: number, currency: string) => {
    const exponent = exponents[currency]
    if (exponent === undefined) return `${minorUnits} minor units of ${currency}`
    const units = BigInt(minorUnits)
    const sign = units < 0n ? '-' : ''
    const digits = (units < 0n ? -units : units).toString().padStart(exponent + 1, '0')
    return exponent === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`
  }
}
