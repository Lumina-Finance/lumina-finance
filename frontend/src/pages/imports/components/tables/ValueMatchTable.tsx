import { useId, type ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import IconTooltip from '@/components/tooltips/IconTooltip'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import {
  IMPORT_CATEGORY_KIND_OPTIONS,
  IMPORT_CATEGORY_NAME_MAX_LENGTH,
  IMPORT_EXCLUDED_ROW_BACKGROUND,
  IMPORT_EXCLUDED_ROW_FAINT_TEXT,
} from '@/pages/imports/constants'
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

    /** An explanation behind a question mark beside the source, for a row whose label needs one */
    sourceHelp?: { label: string; content: ReactNode }

    /** Leaves out the New badge, for a row sharing its answer with another row that already shows it */
    hideCreateBadge?: boolean
    autoFilled?: boolean

    /**
     * Shows the row as one the import leaves out and keeps listed, the way an ignored column is
     * shown: shaded, its source struck through and badged
     */
    excluded?: boolean
    detailAutoFilled?: boolean
    detail?: string
    detailKind?: ImportCategoryKind | ''
    detailDisabled?: boolean
    detailNode?: ReactNode
    onDetailKindChange?: (kind: ImportCategoryKind) => void
    value: string
    onChange: (value: string) => void

    /** Targets for this row alone, where it can only take some of the shared ones */
    options?: DropdownOption[]

    /**
     * The name a new target is created under, for a row whose own name is taken, edited where
     * the source's name would show
     */
    rename?: {
      label: string

      /** Why the row needs another name, behind a warning beside the field */
      help: string
      value: string

      /** Flags the field until the user answers, since the import chose the name for them */
      isProposed: boolean
      onChange: (value: string) => void
    }
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
  const labelNamespace = useId()
  const targetHeadingId = `${labelNamespace}-target`

  return (
    <div className="import-table-scroll">
      <table className="import-table w-full table-fixed text-left text-[0.9375rem]">
        <colgroup>
          <col className={detailLabel ? 'w-[34%]' : 'w-[45%]'} />
          {detailLabel && <col className="w-64" />}
          <col className={detailLabel ? undefined : 'w-[55%]'} />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-2.5 font-medium">{sourceLabel}</th>
            {detailLabel && <th className="w-64 px-4 py-2.5 font-medium">{detailLabel}</th>}
            <th id={targetHeadingId} className="py-2.5 pl-4 pr-0 font-medium">
              {targetLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const sourceLabelId = `${labelNamespace}-source-${index}`
            const creating = Boolean(createValue && row.value === createValue && !row.hideCreateBadge)

            // Below the desktop layout the table's scrolling box clips a tooltip leaving it, so one opens
            // toward the rows below or above
            const tooltipPlacement = index < rows.length / 2 ? 'bottom' : 'top'

            return (
              // The glow asks the user to check an answer, which means nothing while every answer is held,
              // as on a finished import's record or while the targets load
              <tr
                key={row.id}
                className={!disabled && (row.autoFilled || row.detailAutoFilled) ? 'import-auto-fill-row' : undefined}
                style={row.excluded ? { background: IMPORT_EXCLUDED_ROW_BACKGROUND } : undefined}
              >
                <td className="px-4 py-2 align-middle">
                  <div className="flex min-w-0 items-center gap-2">
                    {row.rename ? (
                      <>
                        {/* Names the row for its dropdown, which the field's text would rename as it is typed */}
                        <span id={sourceLabelId} className="sr-only">
                          {row.source}
                        </span>
                        <input
                          type="text"
                          className={`app-input h-[var(--app-dropdown-height-compact)] min-w-0 flex-1 ${row.rename.isProposed || !row.rename.value.trim() ? 'app-input-error' : ''}`}
                          aria-label={row.rename.label}
                          aria-invalid={!row.rename.value.trim()}
                          maxLength={IMPORT_CATEGORY_NAME_MAX_LENGTH}
                          value={row.rename.value}
                          onChange={(event) => row.rename?.onChange(event.target.value)}
                          disabled={disabled}
                        />
                        <span className="flex shrink-0">
                          <IconTooltip
                            label={`Why ${row.source} has a new name`}
                            level="important"
                            placement={tooltipPlacement}
                            widthClassName="w-64"
                          >
                            {row.rename.help}
                          </IconTooltip>
                        </span>
                      </>
                    ) : (
                      <p
                        id={sourceLabelId}
                        className={`truncate font-medium ${row.excluded ? 'line-through' : ''}`}
                        style={{ color: row.excluded ? 'var(--app-text-muted)' : undefined }}
                        title={row.source}
                      >
                        {row.source}
                      </p>
                    )}
                    {row.sourceHelp && (
                      <span className="flex shrink-0">
                        <IconTooltip
                          label={row.sourceHelp.label}
                          icon={CircleHelp}
                          placement={tooltipPlacement}
                          widthClassName="w-64"
                        >
                          {row.sourceHelp.content}
                        </IconTooltip>
                      </span>
                    )}
                    {creating && (
                      <span
                        className="shrink-0 text-[0.6875rem] font-semibold uppercase"
                        style={{ color: 'var(--app-accent)' }}
                      >
                        New
                      </span>
                    )}
                    {row.excluded && (
                      <span
                        className="shrink-0 text-[0.6875rem] font-semibold uppercase"
                        style={{ color: IMPORT_EXCLUDED_ROW_FAINT_TEXT }}
                      >
                        Ignored
                      </span>
                    )}
                  </div>
                </td>
                {detailLabel && (
                  <td className="px-4 py-2 align-middle">
                    {/* Carries its own corner, since the glow no longer sets one and the toggle
                        inside is not a pill */}
                    <div
                      className={!disabled && row.detailAutoFilled ? 'import-auto-fill-field rounded-lg' : undefined}
                    >
                      {row.detailNode ??
                        (row.onDetailKindChange ? (
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
                <td className="py-2 pl-4 pr-0 align-middle">
                  <Dropdown
                    labelledBy={`${targetHeadingId} ${sourceLabelId}`}
                    options={row.options ?? options}
                    value={row.value}
                    onChange={row.onChange}
                    searchable
                    blankWhenEmpty
                    size="compact"
                    className={!disabled && row.autoFilled ? 'import-auto-fill-field' : undefined}
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
