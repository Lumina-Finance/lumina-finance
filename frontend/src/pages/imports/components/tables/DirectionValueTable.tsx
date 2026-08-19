import { IMPORT_DIRECTION_OPTIONS } from '@/pages/imports/constants'
import type { ImportAmountDirection } from '@/pages/imports/types'
import { ImportSegmentedToggle } from './SegmentedToggle'

/**
 * Table asking what each word in the file's Direction column means, one row per distinct word
 *
 * A word this app recognises arrives answered and glowing, the way a column the mapping table filled
 * in does, so a file written in DEBIT and CREDIT needs nothing from the user, and one written in any
 * other wording, in any language, needs a click for each word it uses
 */
export function ImportDirectionValueTable({
  values,
  answers,
  autoFilledValues,
  onChange,
}: {
  values: Array<{ key: string; label: string }>
  answers: Record<string, ImportAmountDirection>
  autoFilledValues: Set<string>
  onChange: (key: string, direction: ImportAmountDirection) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed min-w-[32rem] text-left text-[0.9375rem]">
        <colgroup>
          <col className="w-[45%]" />
          <col className="w-[55%]" />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-2.5 font-medium">Word In File</th>
            <th className="px-4 py-2.5 font-medium">What It Means</th>
          </tr>
        </thead>
        <tbody>
          {values.map((value) => {
            const autoFilled = autoFilledValues.has(value.key)

            return (
              <tr key={value.key} className={autoFilled ? 'import-auto-fill-row' : undefined}>
                <td className="px-4 py-2 align-middle">
                  <p className="truncate font-medium" title={value.label}>{value.label}</p>
                </td>
                <td className="px-4 py-2 align-middle">
                  {/* Carries its own corner, since the glow no longer sets one and the toggle inside
                      is not a pill */}
                  <div className={autoFilled ? 'import-auto-fill-field rounded-lg' : undefined}>
                    <ImportSegmentedToggle
                      options={IMPORT_DIRECTION_OPTIONS}
                      value={answers[value.key] ?? ''}
                      label={`What ${value.label} means`}
                      onChange={(direction) => onChange(value.key, direction)}
                    />
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
