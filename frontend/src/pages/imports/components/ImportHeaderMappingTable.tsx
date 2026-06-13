import { TriangleAlert } from 'lucide-react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import type { ColumnMap, ColumnValidationErrors, ImportFileDraft } from '../types'
import { getColumnSamples, getTargetForHeader } from '../utils'

export function ImportHeaderMappingTable({
  headers,
  files,
  options,
  autoFilledHeaders,
  columnMap,
  validationErrors,
  onChange,
}: {
  headers: string[]
  files: ImportFileDraft[]
  options: DropdownOption[]
  autoFilledHeaders: Set<string>
  columnMap: ColumnMap
  validationErrors: ColumnValidationErrors
  onChange: (header: string, target: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed min-w-[48rem] text-left text-[0.9375rem]">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[38%]" />
          <col className="w-[32%]" />
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
                  <div className="flex items-center gap-2">
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      {validationError && (
                        <span className="group relative inline-flex">
                          <TriangleAlert
                            size={15}
                            strokeWidth={2.75}
                            aria-label={validationError}
                            className="cursor-help"
                            style={{ color: 'var(--app-negative)' }}
                          />
                          <span className="app-tooltip-panel app-hover-tooltip w-64">
                            {validationError}
                          </span>
                        </span>
                      )}
                    </span>
                    <div className={`min-w-0 flex-1 ${autoFilled ? 'import-auto-fill-field' : ''}`}>
                      <Dropdown
                        options={options}
                        value={selectedTarget}
                        onChange={(nextValue) => onChange(header, nextValue)}
                        searchable
                        className={`app-input ${validationError ? 'app-input-error' : ''}`}
                      />
                    </div>
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
