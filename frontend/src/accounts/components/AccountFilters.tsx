import { Plus } from 'lucide-react'
import type { AccountKind, AccountType } from '@/api/accounts'
import FilterChip from '@/components/FilterChip'
import FilterOptionList, { type OptionItem } from '@/components/FilterOptionList'
import type { AccountFilterValues } from '@/accounts/types/accounts'

export default function AccountFilters({
  filters,
  setFilter,
  institutionOptions,
  accountKindOptions,
  accountTypeOptions,
  onAddAccount,
}: {
  filters: AccountFilterValues
  setFilter: (patch: Partial<AccountFilterValues>) => void
  institutionOptions: OptionItem[]
  accountKindOptions: OptionItem[]
  accountTypeOptions: OptionItem[]
  onAddAccount: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <FilterChip
        label="Institution"
        selectedLabel={institutionOptions.find((option) => option.value === filters.institution_id)?.label ?? null}
        onClear={() => setFilter({ institution_id: undefined })}
      >
        {(close) => (
          <FilterOptionList
            options={institutionOptions}
            selectedValue={filters.institution_id}
            onSelect={(value) => { setFilter({ institution_id: value }); close() }}
            searchPlaceholder="Search institutions..."
          />
        )}
      </FilterChip>

      <FilterChip
        label="Category"
        selectedLabel={accountKindOptions.find((option) => option.value === filters.account_kind)?.label ?? null}
        onClear={() => setFilter({ account_kind: undefined })}
      >
        {(close) => (
          <FilterOptionList
            options={accountKindOptions}
            selectedValue={filters.account_kind}
            onSelect={(value) => { setFilter({ account_kind: value as AccountKind }); close() }}
            searchPlaceholder="Search categories..."
          />
        )}
      </FilterChip>

      <FilterChip
        label="Type"
        selectedLabel={accountTypeOptions.find((option) => option.value === filters.account_type)?.label ?? null}
        onClear={() => setFilter({ account_type: undefined })}
      >
        {(close) => (
          <FilterOptionList
            options={accountTypeOptions}
            selectedValue={filters.account_type}
            onSelect={(value) => { setFilter({ account_type: value as AccountType }); close() }}
            searchPlaceholder="Search types..."
          />
        )}
      </FilterChip>

      <button
        type="button"
        className="app-primary-button ml-auto"
        onClick={onAddAccount}
      >
        <Plus size={18} aria-hidden />
        Add Account
      </button>
    </div>
  )
}
