import { useId } from 'react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { IMPORT_DATE_FORMAT_LABELS } from '@/pages/imports/constants'
import {
  IMPORT_DATE_FORMATS,
  getImportAmountFormatKey,
  type ImportAmountFormat,
  type ImportAmountFormatScan,
  type ImportDateChoiceScan,
  type ImportDateFormat,
} from '@/pages/imports/utils'

const UNREADABLE_FORMAT_BADGE = 'Does not fit'

const AMOUNT_PRESETS: Array<{ format: ImportAmountFormat; label: string }> = [
  { format: { decimalSeparator: '.', groupingSeparator: ',' }, label: '1,234.56' },
  { format: { decimalSeparator: ',', groupingSeparator: '.' }, label: '1.234,56' },
  { format: { decimalSeparator: '.', groupingSeparator: 'space' }, label: '1 234.56' },
  { format: { decimalSeparator: ',', groupingSeparator: 'space' }, label: '1 234,56' },
  { format: { decimalSeparator: '.', groupingSeparator: "'" }, label: "1'234.56" },
  { format: { decimalSeparator: ',', groupingSeparator: "'" }, label: "1'234,56" },
]

/** Picks the date order used by the mapped date column */
export function ImportDateFormatControl({
  format,
  automatic,
  scan,
  onChange,
}: {
  format: ImportDateFormat | null
  automatic: boolean
  scan: ImportDateChoiceScan
  onChange: (format: ImportDateFormat) => void
}) {
  const formatLabelId = useId()
  const options: DropdownOption[] = IMPORT_DATE_FORMATS.map((candidate) => ({
    value: candidate,
    label: `${IMPORT_DATE_FORMAT_LABELS[candidate].label} (${IMPORT_DATE_FORMAT_LABELS[candidate].example})`,
    badge: scan.rejectedBy[candidate] ? UNREADABLE_FORMAT_BADGE : undefined,
  }))
  const selectedValue = format ?? ''
  const selectedOption = automatic && format
    ? { value: selectedValue, label: `Detected: ${IMPORT_DATE_FORMAT_LABELS[format].label}` }
    : undefined

  return (
    <div className="flex min-w-0 flex-[1.4] flex-col gap-2">
      <p id={formatLabelId} className="sr-only">
        Date format
      </p>
      <Dropdown
        options={options}
        selectedOption={selectedOption}
        value={selectedValue}
        onChange={(value) => onChange(value as ImportDateFormat)}
        labelledBy={formatLabelId}
        placeholder="Choose the date format"
        size="compact"
      />
    </div>
  )
}

/** Picks one shared amount preset for all mapped amount columns */
export function ImportAmountFormatControl({
  format,
  automatic,
  scan,
  onChange,
}: {
  format: ImportAmountFormat | null
  automatic: boolean
  scan: ImportAmountFormatScan
  onChange: (format: ImportAmountFormat) => void
}) {
  const formatLabelId = useId()
  const options: DropdownOption[] = AMOUNT_PRESETS.map(({ format: candidate, label }) => ({
    value: getImportAmountFormatKey(candidate),
    label,
    badge: scan.rejectedBy[getImportAmountFormatKey(candidate)] ? UNREADABLE_FORMAT_BADGE : undefined,
  }))
  const selectedValue = format ? getImportAmountFormatKey(format) : ''
  const selectedOption = automatic && format
    ? { value: selectedValue, label: `Detected: ${getAmountFormatExample(format)}` }
    : undefined

  const handlePresetChange = (value: string) => {
    const next = AMOUNT_PRESETS.find(({ format: candidate }) => getImportAmountFormatKey(candidate) === value)
    if (next) onChange(next.format)
  }

  return (
    <div className="flex min-w-0 flex-[1.4] flex-col gap-2">
      <p id={formatLabelId} className="sr-only">
        Amount format
      </p>
      <Dropdown
        options={options}
        selectedOption={selectedOption}
        value={selectedValue}
        onChange={handlePresetChange}
        labelledBy={formatLabelId}
        placeholder="Choose the amount format"
        size="compact"
      />
    </div>
  )
}

function getAmountFormatExample(format: ImportAmountFormat) {
  const grouped = format.groupingSeparator === 'none'
    ? '1234'
    : format.groupingSeparator === 'space'
      ? '1 234'
      : `1${format.groupingSeparator}234`
  return `${grouped}${format.decimalSeparator}56`
}
