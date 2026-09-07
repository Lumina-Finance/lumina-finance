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
  onChange: (header: string, target: string) => void
  onDateFormatChange: (dateFormat: ImportDateFormat) => void
  onAmountFormatChange: (format: ImportAmountFormat) => void
}) {
  // The wrapper scrolls sideways only while the table is wider than the viewport. Past that it stops
  // clipping entirely, because overflow-x cannot be auto while overflow-y stays visible, and
  // clipping vertically cuts off a row's tooltip where it reaches past the edge of the table
  return (
    <div className="overflow-x-auto lg:overflow-visible" data-tooltip-bounds>
      <table className="w-full table-fixed min-w-[48rem] text-left text-[0.9375rem]">
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[30%]" />
          <col className="w-[44%]" />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-3 font-medium">Imported Column</th>
            <th className="px-4 py-3 font-medium">Examples From File</th>
            <th className="px-4 py-3 font-medium">Match To App Field</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((header) => {
            const selectedTarget = getTargetForHeader(columnMap, header)
            const samples = getColumnSamples(files, header)
            const isIgnored = selectedTarget === ''
            const validationError = validationErrors[header]
            const autoFilled = Boolean(selectedTarget && autoFilledHeaders.has(header))

            return (
              <tr
                key={header}
                className={autoFilled ? 'import-auto-fill-row' : undefined}
                style={{
                  background: isIgnored
                    ? 'color-mix(in srgb, var(--app-bg) 88%, var(--app-text) 12%)'
                    : undefined,
                }}
              >
                <td className="px-4 py-2.5 align-middle">
                  <div className="flex items-center gap-2">
                    <p className={`font-medium ${isIgnored ? 'line-through' : ''}`} style={{ color: isIgnored ? 'var(--app-text-muted)' : undefined }}>
                      {header}
                    </p>
                    {isIgnored && (
                      <span className="text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
                        Ignored
                      </span>
                    )}
                  </div>
                </td>
                <td className="max-w-[24rem] px-4 py-2.5 align-middle">
                  <p className="truncate text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                    {samples.length > 0 ? samples.join(', ') : 'No samples'}
                  </p>
                </td>
                <td className="px-4 py-2.5 align-middle">
                  <div className="flex min-w-0 items-start gap-2">
                    {/* Rounded like the control inside it, so the auto-fill glow traces it rather
                        than a rectangle around it */}
                    <div className={`min-w-0 flex-1 rounded-lg ${autoFilled ? 'import-auto-fill-field' : ''}`}>
                      <Dropdown
                        options={options}
                        value={selectedTarget}
                        onChange={(nextValue) => onChange(header, nextValue)}
                        searchable
                        size="compact"
                        hasError={Boolean(validationError)}
                      />
                    </div>
                    {selectedTarget === 'dt' && (
                      <ImportDateFormatControl
                        format={dateFormat}
                        automatic={dateFormatAutomatic}
                        scan={dateFormatScan}
                        onChange={onDateFormatChange}
                      />
                    )}
                    {(selectedTarget === 'amount' || selectedTarget === 'amount_out' || selectedTarget === 'amount_in') && (
                      <ImportAmountFormatControl
                        format={amountFormat}
                        automatic={amountFormatAutomatic}
                        scan={amountFormatScan}
                        onChange={onAmountFormatChange}
                      />
                    )}
                    <span className="flex h-9 w-4 shrink-0 items-center justify-center">
                      {validationError && (
                        <IconTooltip
                          label={validationError}
                          level="important"
                          placement="bottom"
                          widthClassName="w-64"
                        >
                          {validationError}
                        </IconTooltip>
                      )}
                    </span>
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
