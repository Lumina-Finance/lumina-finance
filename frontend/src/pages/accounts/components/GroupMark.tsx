import type { ComponentType } from 'react'
import {
  Banknote,
  Car,
  ChartLine,
  CreditCard,
  DollarSign,
  House,
  Landmark,
  Lock,
  PiggyBank,
  Wallet,
} from 'lucide-react'
import { InstitutionMark } from '@/pages/accounts/components/InstitutionMark'
import { NO_INSTITUTION_ID, type AccountGroup, type AccountGrouping } from '@/pages/accounts/utils/accountGroups'

type IconProps = { size?: number }

// A house with a dollar sign inside, for a home equity line of credit
function HouseDollarIcon({ size = 18 }: IconProps) {
  return (
    <span className="relative flex items-center justify-center">
      <House size={size} aria-hidden />
      <DollarSign size={Math.round(size / 2)} className="absolute top-[55%] -translate-y-1/2" aria-hidden />
    </span>
  )
}

// Keyed by account type, as the group id is the account type when the list is grouped by type
const GROUP_ICONS: Record<string, ComponentType<IconProps>> = {
  checking: Landmark,
  savings: PiggyBank,
  term_deposit: Lock,
  cash: Banknote,
  investment: ChartLine,
  credit_card: CreditCard,
  line_of_credit: CreditCard,
  heloc: HouseDollarIcon,
  loan: Car,
  mortgage: House,
}

/**
 * Renders an account type's icon in a small round mark the size of a row's bank logo, for a row whose
 * group already names its bank
 */
export function AccountTypeMark({ accountType }: { accountType: string }) {
  const Icon = GROUP_ICONS[accountType] ?? Wallet
  return (
    <span
      data-account-type-mark={accountType}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{
        background: 'var(--app-accent-soft)',
        border: '1px solid var(--app-border)',
        color: 'var(--app-accent-on-page-tint)',
      }}
      aria-hidden
    >
      <Icon size={12} />
    </span>
  )
}

/**
 * Renders the round mark at the start of a group row, drawn smaller on a phone: the bank's logo when grouped by
 * institution, a dashed wallet circle for accounts with no institution, and an icon for the group
 * on the page's chip colour for every other grouping
 */
export function GroupMark({
  group,
  grouping,
  showLogos,
  isTopLevel,
}: {
  group: AccountGroup
  grouping: AccountGrouping
  showLogos: boolean
  // The top level draws its mark a little larger than a sub-group's
  isTopLevel: boolean
}) {
  const isInstitutionGroup = grouping === 'institution' && group.id !== NO_INSTITUTION_ID
  if (isInstitutionGroup && showLogos) {
    const institution = group.members[0]?.institution
    if (institution) return <InstitutionMark institution={institution} size={isTopLevel ? 'xlarge' : 'large'} />
  }

  // With logos off a bank takes a bank icon, and accounts with no bank keep their dashed wallet
  const isUnfiled = grouping === 'institution' && !isInstitutionGroup
  const Icon = isUnfiled ? Wallet : isInstitutionGroup ? Landmark : (GROUP_ICONS[group.id] ?? Wallet)

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full ${
        isTopLevel ? 'h-8 w-8 min-[750px]:h-[38px] min-[750px]:w-[38px]' : 'h-7 w-7 min-[750px]:h-9 min-[750px]:w-9'
      }`}
      style={{
        background: isUnfiled ? 'transparent' : 'var(--app-accent-soft)',
        border: isUnfiled ? '1px dashed var(--app-border-strong)' : '1px solid var(--app-border)',
        color: isUnfiled ? 'var(--app-text-muted)' : 'var(--app-accent-on-page-tint)',
      }}
      aria-hidden
    >
      <Icon size={isTopLevel ? 19 : 18} />
    </span>
  )
}
