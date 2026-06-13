import Dropdown, { type DropdownOption } from '@/components/Dropdown'
import type { ImportCategoryKind } from '../types'
import { ImportCategoryTypeToggle } from './ImportCategoryTypeToggle'

export function ImportValueMatchTable({
  sourceLabel,
  detailLabel,
  targetLabel,
  createValue,
  rows,
  options,
  disabled,
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
    onDetailKindChange?: (kind: ImportCategoryKind) => void
    value: string
    onChange: (value: string) => void
  }>
  options: DropdownOption[]
  disabled: boolean
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
                    <p className="truncate font-medium">{row.source}</p>
                    {creating && (
                      <span className="shrink-0 text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        New
                      </span>
                    )}
                  </div>
                </td>
                {detailLabel && (
                  <td className="px-4 py-2 align-middle">
                    <div className={row.detailAutoFilled ? 'import-auto-fill-field' : undefined}>
                      {row.onDetailKindChange ? (
                        <ImportCategoryTypeToggle
                          value={row.detailKind ?? ''}
                          onChange={row.onDetailKindChange}
                          disabled={disabled || row.detailDisabled}
                        />
                      ) : (
                        <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
                          {row.detail ?? ''}
                        </span>
                      )}
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
                    className={`app-input h-9 px-3 ${row.autoFilled ? 'import-auto-fill-field' : ''}`}
                    disabled={disabled}
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
