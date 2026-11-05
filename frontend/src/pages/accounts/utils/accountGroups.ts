import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { TYPE_OPTIONS } from '@/pages/accounts/utils/filters'
import { humanizeAccountType } from '@/utils/formatAccountType'

export type AccountGrouping = 'institution' | 'type'

export const ACCOUNT_GROUPINGS: { id: AccountGrouping; label: string }[] = [
  { id: 'institution', label: 'Institution' },
  { id: 'type', label: 'Account type' },
]

export const DEFAULT_ACCOUNT_GROUPING: AccountGrouping = 'type'

// Accounts with no linked institution gather here, after every named institution
export const NO_INSTITUTION_ID = 'no-institution'

// A group holding both assets and debt, such as one institution's, has no single accent
export type AccountGroupAccent = 'positive' | 'negative' | 'neutral'

export type AccountGroup = {
  id: string
  title: string
  accent: AccountGroupAccent
  rows: AccountsOverview[]
  // Every account in the group, filtered out or not, as the logo stack and the subtotal read them all
  members: AccountsOverview[]
  // The sub-groups of a second grouping level, empty when the list is grouped one level deep
  children: AccountGroup[]
  subtotal: number
  emptyLabel: string
}

type GroupDefinition = {
  id: string
  title: string
  accent?: AccountGroupAccent
  emptyLabel?: string
}

// With no account at all there is nothing to group, so one placeholder group holds the page's
// loading and empty states
const PLACEHOLDER_GROUP: GroupDefinition = {
  id: 'accounts',
  title: 'Accounts',
  accent: 'neutral',
  emptyLabel: 'No accounts yet',
}

const FILTERED_EMPTY_LABEL = 'No matching accounts'

function getBalance(account: AccountsOverview) {
  return account.base_currency_current_balance ?? account.current_balance
}

function getAccentOf(rows: AccountsOverview[]): AccountGroupAccent {
  if (rows.every((account) => account.account_kind === 'asset')) return 'positive'
  if (rows.every((account) => account.account_kind !== 'asset')) return 'negative'
  return 'neutral'
}

function buildGroups(
  rows: AccountsOverview[],
  filteredRows: AccountsOverview[],
  definitions: GroupDefinition[],
  getGroupId: (account: AccountsOverview) => string,
  isAlwaysListed: boolean,
): AccountGroup[] {
  return definitions.flatMap((definition) => {
    const members = rows.filter((account) => getGroupId(account) === definition.id)
    if (members.length === 0 && !isAlwaysListed) return []

    const accent = definition.accent ?? getAccentOf(members)
    // Debt lists the largest balance owed first and everything else the largest balance first
    const direction = accent === 'negative' ? 1 : -1
    return [
      {
        id: definition.id,
        title: definition.title,
        accent,
        rows: filteredRows
          .filter((account) => getGroupId(account) === definition.id)
          .sort((a, b) => direction * (getBalance(a) - getBalance(b))),
        members,
        children: [],
        subtotal: members.reduce((sum, account) => sum + getBalance(account), 0),
        emptyLabel: definition.emptyLabel ?? FILTERED_EMPTY_LABEL,
      },
    ]
  })
}

/**
 * Lists the groups an account list falls into under the chosen grouping, in display order
 *
 * Each group's subtotal sums every account in it, filtered out or not, as the page's other totals
 * do, while its rows are only the ones the filters keep. Only groups that hold an account are
 * listed. With no account at all there is nothing to group, so a single placeholder group stands in
 * and the page keeps its loading and empty states
 */
export function getAccountGroups({
  rows,
  filteredRows,
  grouping,
  thenBy = null,
}: {
  rows: AccountsOverview[]
  filteredRows: AccountsOverview[]
  grouping: AccountGrouping
  // An optional second level that splits each group by another grouping, listing only what it holds
  thenBy?: AccountGrouping | null
}): AccountGroup[] {
  const groups = getTopLevelGroups({ rows, filteredRows, grouping })
  if (!thenBy || thenBy === grouping || rows.length === 0) return groups

  return groups.map((group) => ({
    ...group,
    children: getTopLevelGroups({ rows: group.members, filteredRows: group.rows, grouping: thenBy }).filter(
      (child) => child.members.length > 0,
    ),
  }))
}

function getTopLevelGroups({
  rows,
  filteredRows,
  grouping,
}: {
  rows: AccountsOverview[]
  filteredRows: AccountsOverview[]
  grouping: AccountGrouping
}): AccountGroup[] {
  if (rows.length === 0) return buildGroups(rows, filteredRows, [PLACEHOLDER_GROUP], () => PLACEHOLDER_GROUP.id, true)

  if (grouping === 'type') {
    const definitions = TYPE_OPTIONS.map((option) => ({ id: option.value, title: option.label }))
    return buildGroups(rows, filteredRows, definitions, (account) => account.account_type, false)
  }

  const institutions = new Map<string, string>()
  for (const account of rows) {
    if (account.institution) institutions.set(account.institution.id, account.institution.name)
  }
  const definitions: GroupDefinition[] = [...institutions]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title))
  definitions.push({ id: NO_INSTITUTION_ID, title: 'No institution' })
  return buildGroups(rows, filteredRows, definitions, (account) => account.institution?.id ?? NO_INSTITUTION_ID, false)
}

/**
 * Names the grouping in one line, such as "Institution, then Account type"
 */
export function getGroupingSummary(grouping: AccountGrouping, thenBy: AccountGrouping | null): string {
  const getLabel = (id: AccountGrouping) => ACCOUNT_GROUPINGS.find((option) => option.id === id)?.label ?? id
  return thenBy ? `${getLabel(grouping)}, then ${getLabel(thenBy)}` : getLabel(grouping)
}

/**
 * Tells whether a group shows its accounts. Every group starts closed except the top level while
 * groups are kept expanded, and a group the user flipped by hand is the opposite of that start
 */
export function isGroupOpen({
  key,
  isTopLevel,
  keepExpanded,
  toggledKeys,
}: {
  key: string
  isTopLevel: boolean
  keepExpanded: boolean
  toggledKeys: ReadonlySet<string>
}): boolean {
  return (keepExpanded && isTopLevel) !== toggledKeys.has(key)
}

/**
 * Returns the second line of an account in a group, leaving out what the grouping already says
 */
export function getAccountRowMeta(account: AccountsOverview, levels: AccountGrouping[]): string | undefined {
  const isTypeKnown = levels.includes('type')
  const isInstitutionKnown = levels.includes('institution')
  if (isTypeKnown && isInstitutionKnown) return ''
  if (isInstitutionKnown) return humanizeAccountType(account.account_type)
  if (isTypeKnown) return account.institution?.name ?? 'No institution'
  return undefined
}

/**
 * Lists the tax-advantaged category names the accounts of a group are linked to, once each, in the
 * order the group lists its rows: largest balance first, or largest owed for debt. A group account
 * shows no tag on its row, so it adds none here
 */
export function getGroupPlanNames(
  group: AccountGroup,
  taxAdvantagedCategoryById: Map<string, TaxAdvantagedCategory>,
): string[] {
  const direction = group.accent === 'negative' ? 1 : -1
  const names = [...group.members]
    .sort((a, b) => direction * (getBalance(a) - getBalance(b)))
    .flatMap((account) => {
      if (account.group_id !== null || !account.tax_advantaged_category_id) return []
      const plan = taxAdvantagedCategoryById.get(account.tax_advantaged_category_id)
      return plan ? [plan.name] : []
    })
  return [...new Set(names)]
}

// How many account dots the line under an institution's name shows
const DOT_LIMIT = 5

/**
 * Returns one dot per account in a group, up to the limit, marking an account with a negative balance
 */
export function getGroupDots(members: AccountsOverview[]): { id: string; isNegative: boolean }[] {
  return members.slice(0, DOT_LIMIT).map((account) => ({ id: account.id, isNegative: account.current_balance < 0 }))
}
