import type { ReactNode } from 'react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { IMPORT_CATEGORY_KIND_OPTIONS } from '@/pages/imports/constants'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { ImportSegmentedToggle } from './SegmentedToggle'

/**
 * Table matching source values found in an import to an existing target or a new one, with an
 * optional detail column showing read-only text, a type toggle for a category being created, or
 * whatever control the step supplies, such as the name a new merchant is created under
 */
export function ImportValueMatchTable({
  sourceLabel,
  detailLabel,
  targetLabel,
  createValue,
  rows,
  options,
  disabled,
  searchValue,
  onSearchChange,
  filterOptions,
  isLoading,
  hasMore,
  onLoadMore,
}: {
  sourceLabel: string
  detailLabel?: string
  targetLabel: string
  createValue?: string
  rows: Array<{
    id: string
    source: string
    autoFilled?: boolean
    detailAutoFilled?: boolean
    detail?: string
    detailKind?: ImportCategoryKind | ''
    detailDisabled?: boolean
    detailNode?: ReactNode
    onDetailKindChange?: (kind: ImportCategoryKind) => void
    value: string
    onChange: (value: string) => void
  }>
  options: DropdownOption[]
  disabled: boolean

  /** Search text shared by every row's dropdown, for a target list the page does not hold whole */
  searchValue?: string
  onSearchChange?: (value: string) => void
  filterOptions?: boolean
  isLoading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed min-w-[48rem] text-left text-[0.9375rem]">
        <colgroup>
          <col className={detailLabel ? 'w-[34%]' : 'w-[45%]'} />
          {detailLabel && <col className="w-64" />}
          <col className={detailLabel ? undefined : 'w-[55%]'} />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-2.5 font-medium">{sourceLabel}</th>
            {detailLabel && <th className="w-64 px-4 py-2.5 font-medium">{detailLabel}</th>}
            <th className="px-4 py-2.5 font-medium">{targetLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const creating = Boolean(createValue && row.value === createValue)

            return (
              <tr key={row.id} className={row.autoFilled || row.detailAutoFilled ? 'import-auto-fill-row' : undefined}>
                <td className="px-4 py-2 align-middle">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-medium" title={row.source}>{row.source}</p>
                    {creating && (
                      <span className="shrink-0 text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        New
                      </span>
                    )}
                  </div>
                </td>
                {detailLabel && (
                  <td className="px-4 py-2 align-middle">
                    {/* Carries its own corner, since the glow no longer sets one and the toggle
                        inside is not a pill */}
                    <div className={row.detailAutoFilled ? 'import-auto-fill-field rounded-lg' : undefined}>
                      {row.detailNode ?? (row.onDetailKindChange ? (
                        <ImportSegmentedToggle
                          options={IMPORT_CATEGORY_KIND_OPTIONS}
                          value={row.detailKind ?? ''}
                          label="Category type"
                          onChange={row.onDetailKindChange}
                          disabled={disabled || row.detailDisabled}
                        />
                      ) : (
                        <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
                          {row.detail ?? ''}
                        </span>
                      ))}
                    </div>
                  </td>
                )}
                <td className="px-4 py-2 align-middle">
                  <Dropdown
                    options={options}
                    value={row.value}
                    onChange={row.onChange}
                    searchable
                    blankWhenEmpty
                    size="compact"
                    className={row.autoFilled ? 'import-auto-fill-field' : undefined}
                    disabled={disabled}
                    searchValue={searchValue}
                    onSearchChange={onSearchChange}
                    filterOptions={filterOptions}
                    isLoading={isLoading}
                    hasMore={hasMore}
                    onLoadMore={onLoadMore}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
