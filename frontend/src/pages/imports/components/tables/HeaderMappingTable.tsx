import { useId, useState } from 'react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { ImportAmountFormatControl, ImportDateFormatControl } from '@/pages/imports/components/FormatControls'
import type { ColumnMap, ColumnValidationErrors, ImportFileDraft } from '@/pages/imports/types'
import {
  type ImportDateFormat,
  type ImportDateChoiceScan,
  type ImportAmountFormat,
  type ImportAmountFormatScan,
  getColumnSamples,
  getTargetForHeader,
} from '@/pages/imports/utils'
import { IMPORT_EXCLUDED_ROW_BACKGROUND, IMPORT_EXCLUDED_ROW_FAINT_TEXT } from '@/pages/imports/constants'

type RowIcon = { label: string; level: 'important' | 'info'; text: string }

const TIMESTAMP_HELP: RowIcon = {
  label: 'How timestamp dates are imported',
  level: 'info',
  text: 'Timestamps with a timezone are converted to the timezone in your profile before the date is imported. Dates and timestamps without a timezone keep their calendar date.',
}

/**
 * The room after a row's dropdown for its icon, which only a row showing one makes. The dropdown gives
 * up the width as the icon fades in, and takes it back as the icon leaves, which keeps showing what it
 * last showed until the room has closed. Closed, the icon can't be reached
 */
function RowIconSlot({ icon }: { icon: RowIcon | null }) {
  const [lastIcon, setLastIcon] = useState(icon)
  if (icon && (icon.label !== lastIcon?.label || icon.text !== lastIcon.text)) setLastIcon(icon)
  const shown = icon ?? lastIcon

  return (
    <span className={`import-row-icon-slot ${icon ? 'import-row-icon-slot-open' : ''}`} aria-hidden={!icon} inert={!icon}>
      <span className="flex h-9 w-6 items-center justify-end">
        {shown && (
          <IconTooltip label={shown.label} level={shown.level} placement="bottom" widthClassName="w-64">
            {shown.text}
          </IconTooltip>
        )}
      </span>
    </span>
  )
}

/**
 * Table mapping each column header found in the uploaded files to an app field, showing sample
 * values from the file and any validation error beside the dropdown
 *
 * A header left unmapped is shown struck through and shaded as ignored rather than removed from the
 * list, so the user can still see and reconsider every column that came from the file
 */
export function ImportHeaderMappingTable({
  headers,
  files,
  options,
  autoFilledHeaders,
  columnMap,
  validationErrors,
  dateFormat,
  dateFormatAutomatic,
  dateFormatScan,
  amountFormat,
  amountFormatAutomatic,
  amountFormatScan,
  disabled,
  onChange,
  onDateFormatChange,
  onAmountFormatChange,
}: {
  headers: string[]
  files: ImportFileDraft[]
  options: DropdownOption[]
  autoFilledHeaders: Set<string>
  columnMap: ColumnMap
  validationErrors: ColumnValidationErrors
  dateFormat: ImportDateFormat | null
  dateFormatAutomatic: boolean
  dateFormatScan: ImportDateChoiceScan
  amountFormat: ImportAmountFormat | null
  amountFormatAutomatic: boolean
  amountFormatScan: ImportAmountFormatScan

  /** Shows each column's answer without letting it change, for a file a finished import was read from */
  disabled: boolean
  onChange: (header: string, target: string) => void
  onDateFormatChange: (dateFormat: ImportDateFormat) => void
  onAmountFormatChange: (format: ImportAmountFormat) => void
}) {
  const labelNamespace = useId()
  const targetHeadingId = `${labelNamespace}-target`

  /** The icon a row shows after its controls: its error, else how timestamp dates are imported */
  const getRowIcon = (header: string): RowIcon | null => {
    const error = validationErrors[header]
    if (error) return { label: error, level: 'important', text: error }
    return getTargetForHeader(columnMap, header) === 'dt' && dateFormat === 'iso' ? TIMESTAMP_HELP : null
  }

  return (
    <div className="import-table-scroll" data-tooltip-bounds>
      <table className="import-table w-full table-fixed text-left text-[0.9375rem]">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[24%]" />
          <col className="w-[52%]" />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-3 font-medium">Imported Column</th>
            <th className="px-4 py-3 font-medium">Examples From File</th>
            <th id={targetHeadingId} className="py-3 pl-4 pr-0 font-medium">Match To App Field</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((header, index) => {
            const sourceLabelId = `${labelNamespace}-source-${index}`
            const selectedTarget = getTargetForHeader(columnMap, header)
            const samples = getColumnSamples(files, header)
            const isIgnored = selectedTarget === ''
            const validationError = validationErrors[header]
            const rowIcon = getRowIcon(header)
            const autoFilled = Boolean(selectedTarget && autoFilledHeaders.has(header))

            return (
              <tr
                key={header}
                className={autoFilled ? 'import-auto-fill-row' : undefined}
                style={{
                  background: isIgnored ? IMPORT_EXCLUDED_ROW_BACKGROUND : undefined,
                }}
              >
                <td className="px-4 py-2.5 align-middle">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* One line however long the heading is, so every row keeps one height. The full
                        heading is on hover */}
                    <p id={sourceLabelId} title={header} className={`min-w-0 truncate font-medium leading-5 ${isIgnored ? 'line-through' : ''}`} style={{ color: isIgnored ? 'var(--app-text-muted)' : undefined }}>
                      {header}
                    </p>
                    {isIgnored && (
                      <span className="shrink-0 text-[0.6875rem] font-semibold uppercase" style={{ color: IMPORT_EXCLUDED_ROW_FAINT_TEXT }}>
                        Ignored
                      </span>
                    )}
                  </div>
                </td>
                <td className="max-w-[24rem] px-4 py-2.5 align-middle">
                  <p className="truncate text-sm" style={{ color: isIgnored ? IMPORT_EXCLUDED_ROW_FAINT_TEXT : 'var(--app-text-subtle)' }}>
                    {samples.length > 0 ? samples.join(', ') : 'No samples'}
                  </p>
                </td>
                <td className="py-2.5 pl-4 pr-0 align-middle">
                  <div className="flex min-w-0 items-start">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      {/* Rounded like the control inside it, so the auto-fill glow traces it rather
                          than a rectangle around it */}
                      <div className={`min-w-0 flex-1 rounded-lg ${autoFilled ? 'import-auto-fill-field' : ''}`}>
                        <Dropdown
                          labelledBy={`${targetHeadingId} ${sourceLabelId}`}
                          options={options}
                          value={selectedTarget}
                          onChange={(nextValue) => onChange(header, nextValue)}
                          searchable
                          size="compact"
                          hasError={Boolean(validationError)}
                          disabled={disabled}
                        />
                      </div>
                      {selectedTarget === 'dt' && (
                        <ImportDateFormatControl
                          format={dateFormat}
                          automatic={dateFormatAutomatic}
                          scan={dateFormatScan}
                          disabled={disabled}
                          onChange={onDateFormatChange}
                        />
                      )}
                      {(selectedTarget === 'amount' || selectedTarget === 'amount_out' || selectedTarget === 'amount_in') && (
                        <ImportAmountFormatControl
                          format={amountFormat}
                          automatic={amountFormatAutomatic}
                          scan={amountFormatScan}
                          disabled={disabled}
                          onChange={onAmountFormatChange}
                        />
                      )}
                    </div>
                    <RowIconSlot icon={rowIcon} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
