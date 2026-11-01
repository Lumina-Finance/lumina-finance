import { useId } from 'react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { IMPORT_DATE_FORMAT_LABELS, IMPORT_DELIMITER_LABELS } from '@/pages/imports/constants'
import {
  IMPORT_DATE_FORMATS,
  IMPORT_DELIMITERS,
  getImportAmountFormatKey,
  type ImportDelimiter,
  type ImportAmountFormat,
  type ImportAmountFormatScan,
  type ImportDateChoiceScan,
  type ImportDateFormat,
} from '@/pages/imports/utils'
import { ImportSegmentedToggle } from './tables/SegmentedToggle'

const UNREADABLE_FORMAT_BADGE = 'Does not fit'

/** Fills the room its row gives it, which is the row's to size and to take a row icon's room from */
const FORMAT_CONTROL_CLASS_NAME = 'flex min-w-0 flex-1 flex-col gap-2'

const AMOUNT_PRESETS: Array<{ format: ImportAmountFormat; label: string }> = [
  { format: { decimalSeparator: '.', groupingSeparator: ',' }, label: '1,234.56' },
  { format: { decimalSeparator: ',', groupingSeparator: '.' }, label: '1.234,56' },
  { format: { decimalSeparator: '.', groupingSeparator: 'space' }, label: '1 234.56' },
  { format: { decimalSeparator: ',', groupingSeparator: 'space' }, label: '1 234,56' },
  { format: { decimalSeparator: '.', groupingSeparator: "'" }, label: "1'234.56" },
  { format: { decimalSeparator: ',', groupingSeparator: "'" }, label: "1'234,56" },
]

/**
 * Names a date format in the field and its list, with an example of how it reads. The ISO format
 * goes by its name alone, since its example is wider than the field is at a tablet or phone and the
 * field shows the whole of what was chosen
 */
function getDateFormatOptionLabel(format: ImportDateFormat) {
  const { label, example } = IMPORT_DATE_FORMAT_LABELS[format]
  return format === 'iso' ? label : `${label} (${example})`
}

/** Picks the date order used by the mapped date column */
export function ImportDateFormatControl({
  format,
  automatic,
  scan,
  disabled,
  hasError = false,
  placeholder = 'Choose the date format',
  onChange,
}: {
  format: ImportDateFormat | null
  automatic: boolean
  scan: ImportDateChoiceScan
  disabled: boolean

  /** Whether the user must still choose, which tints the field */
  hasError?: boolean

  /** What the field says while none is chosen, shortened where the field is narrow */
  placeholder?: string
  onChange: (format: ImportDateFormat) => void
}) {
  const formatLabelId = useId()
  const options: DropdownOption[] = IMPORT_DATE_FORMATS.map((candidate) => ({
    value: candidate,
    label: getDateFormatOptionLabel(candidate),
    badge: scan.rejectedBy[candidate] ? UNREADABLE_FORMAT_BADGE : undefined,
  }))
  const selectedValue = format ?? ''
  const selectedOption =
    automatic && format
      ? { value: selectedValue, label: `Detected: ${IMPORT_DATE_FORMAT_LABELS[format].label}` }
      : undefined

  return (
    <div className={FORMAT_CONTROL_CLASS_NAME}>
      <p id={formatLabelId} className="sr-only">
        Date format
      </p>
      <Dropdown
        options={options}
        selectedOption={selectedOption}
        value={selectedValue}
        onChange={(value) => onChange(value as ImportDateFormat)}
        labelledBy={formatLabelId}
        placeholder={placeholder}
        size="compact"
        hasError={hasError}
        disabled={disabled}
      />
    </div>
  )
}

/** Picks one shared amount preset for all mapped amount columns */
export function ImportAmountFormatControl({
  format,
  automatic,
  scan,
  disabled,
  hasError = false,
  placeholder = 'Choose the amount format',
  onChange,
}: {
  format: ImportAmountFormat | null
  automatic: boolean
  scan: ImportAmountFormatScan
  disabled: boolean

  /** Whether the user must still choose, which tints the field */
  hasError?: boolean

  /** What the field says while none is chosen, shortened where the field is narrow */
  placeholder?: string
  onChange: (format: ImportAmountFormat) => void
}) {
  const formatLabelId = useId()
  const options: DropdownOption[] = AMOUNT_PRESETS.map(({ format: candidate, label }) => ({
    value: getImportAmountFormatKey(candidate),
    label,
    badge: scan.rejectedBy[getImportAmountFormatKey(candidate)] ? UNREADABLE_FORMAT_BADGE : undefined,
  }))
  const selectedValue = format ? getImportAmountFormatKey(format) : ''
  const selectedOption =
    automatic && format ? { value: selectedValue, label: `Detected: ${getAmountFormatExample(format)}` } : undefined

  const handlePresetChange = (value: string) => {
    const next = AMOUNT_PRESETS.find(({ format: candidate }) => getImportAmountFormatKey(candidate) === value)
    if (next) onChange(next.format)
  }

  return (
    <div className={FORMAT_CONTROL_CLASS_NAME}>
      <p id={formatLabelId} className="sr-only">
        Amount format
      </p>
      <Dropdown
        options={options}
        selectedOption={selectedOption}
        value={selectedValue}
        onChange={handlePresetChange}
        labelledBy={formatLabelId}
        placeholder={placeholder}
        size="compact"
        hasError={hasError}
        disabled={disabled}
      />
    </div>
  )
}

function getAmountFormatExample(format: ImportAmountFormat) {
  const grouped =
    format.groupingSeparator === 'none'
      ? '1234'
      : format.groupingSeparator === 'space'
        ? '1 234'
        : `1${format.groupingSeparator}234`
  return `${grouped}${format.decimalSeparator}56`
}

/**
 * Picks the separator the staged CSV file is read with, showing the one the reader detected until the
 * user chooses another, which reads the file again
 *
 * It carries no visible name, since the setting's row names it, and it fills the width it is given.
 * It is drawn at the compact height, since a settings row is shorter than a field
 */
export function ImportDelimiterControl({
  delimiter,
  hasError,
  disabled,
  onChange,
}: {
  delimiter: ImportDelimiter

  /** Whether the file was refused, which a separator choice is often what fixes */
  hasError: boolean
  disabled: boolean
  onChange: (delimiter: ImportDelimiter) => void
}) {
  // Every choice is shown with the character it stands for, so it can be matched against the file
  const options = IMPORT_DELIMITERS.map((candidate) => ({
    value: candidate,
    label: IMPORT_DELIMITER_LABELS[candidate],
    symbol: candidate,
  }))

  return (
    <ImportSegmentedToggle
      options={options}
      value={delimiter}
      label="Separator"
      onChange={onChange}
      hasError={hasError}
      disabled={disabled}
      compact
    />
  )
}
