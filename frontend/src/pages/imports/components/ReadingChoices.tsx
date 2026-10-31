import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { CsvReading, ImportDateRange, ImportFileDraft } from '@/pages/imports/types'
import type { ImportDelimiter } from '@/pages/imports/utils'
import { ImportDateRangeFields } from './DateRangeFields'
import { ImportDelimiterControl } from './FormatControls'

/**
 * How the staged CSV file is read, as a list of settings at the section's full width: one row each
 * for the separator, the row the headings sit on, how many lines to leave out at the end and the
 * dates to import, a hairline between rows, with the setting's name on the left and a compact
 * control on the right. The first and last lines of the file, showing which lines are skipped, sit
 * under the list and are pinned to the bottom of the section's free room, just above its counts, so
 * a short section lets them follow the list instead
 *
 * It grows to fill the section's free room so the lines can be pinned there. Shown for a refused
 * file too, since most refusals of a bank export are fixed by one of these
 *
 * @param disabled - Shows the choices the file was read with without letting them change, for a file
 *   a finished import was read from
 */
export function ImportReadingChoices({
  file,
  disabled,
  hasDateColumn,
  dateRange,
  isDateRangeCrossed,
  startSuggestion,
  onDelimiterChange,
  onHeaderRowChange,
  onSkipLastRowsChange,
  onDateRangeChange,
}: {
  file: ImportFileDraft
  disabled: boolean

  /** Whether a column is mapped as the date, which is when the dates to import show */
  hasDateColumn: boolean
  dateRange: ImportDateRange
  isDateRangeCrossed: boolean
  startSuggestion: string | null
  onDelimiterChange: (delimiter: ImportDelimiter) => void
  onHeaderRowChange: (headerRow: number) => void
  onSkipLastRowsChange: (skipLastRows: number) => void
  onDateRangeChange: (end: keyof ImportDateRange, value: string, isPartlyTyped: boolean) => void
}) {
  const { delimiter, reading } = file
  const lineCount = reading ? Math.max(...reading.preview.map((line) => line.rowNumber)) : 0

  // A wide line that may start a summary is fixed from Skip last rows, so that field carries the error
  const isSkipSuggested = reading?.suggestedSkipLastRows !== undefined

  return (
    <div className="flex flex-1 flex-col gap-4 pt-1">
      {/* The settings, one row each with a hairline between rows. Each row sits on its own hairline
          rather than a shared divider, since the dates row animates in with the room above it. A file
          read by a tool's own reader has no separator, so its list starts at the header row. The
          separator shows even when the file can't be read with it, so a wrong pick can be undone */}
      <div>
        {delimiter && (
          <ImportSettingRow label="Separator" isLabelDecorative>
            {/* The control is drawn at the compact height here, since a row is shorter than a field */}
            <div className="w-22">
              <ImportDelimiterControl
                delimiter={delimiter}
                hasError={Boolean(file.error) && !isSkipSuggested}
                disabled={disabled}
                onChange={onDelimiterChange}
              />
            </div>
          </ImportSettingRow>
        )}
        {reading && (
          <>
            <ImportRowCountField
              reading={reading}
              label="Header row"
              hasDivider={Boolean(delimiter)}
              value={reading.headerRow}
              min={1}
              max={Math.max(1, lineCount - reading.skipLastRows)}
              disabled={disabled}
              onCommit={onHeaderRowChange}
            />
            <ImportRowCountField
              reading={reading}
              label="Skip last rows"
              hasDivider
              value={reading.skipLastRows}
              min={0}
              max={Math.max(0, lineCount - 1)}
              hasError={isSkipSuggested}
              disabled={disabled}
              onCommit={onSkipLastRowsChange}
            />
          </>
        )}
        <ImportDateRangeFields
          isShown={hasDateColumn}
          dateRange={dateRange}
          isCrossed={isDateRangeCrossed}
          disabled={disabled}
          startSuggestion={startSuggestion}
          onChange={onDateRangeChange}
        />
      </div>
      {/* What the file holds, pinned to the bottom of the room the section has to spare and set apart
          from the settings by a hairline. With no room to spare it follows the settings, a step below */}
      {reading && (
        <div className="mt-auto border-t border-[var(--app-border)] pt-4">
          <ImportReadingPreview reading={reading} delimiter={delimiter} />
        </div>
      )}
    </div>
  )
}

/**
 * One row of the settings list: the setting's name in body text on the left and its compact control
 * on the right, 56px tall so the list breathes, with a hairline above it unless it is the first
 *
 * @param labelFor - The id of the control the name labels, which lets a press on the name reach it
 * @param isLabelDecorative - Hides the name from screen readers where the control already carries it
 *   as its own label
 */
function ImportSettingRow({
  label,
  labelFor,
  isLabelDecorative = false,
  hasDivider = false,
  children,
}: {
  label: string
  labelFor?: string
  isLabelDecorative?: boolean
  hasDivider?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`flex h-14 items-center justify-between gap-3${hasDivider ? ' border-t border-[var(--app-border)]' : ''}`}
    >
      {labelFor ? (
        <label htmlFor={labelFor} className="text-sm">
          {label}
        </label>
      ) : (
        <span aria-hidden={isLabelDecorative || undefined} className="text-sm">
          {label}
        </span>
      )}
      {children}
    </div>
  )
}

/**
 * A whole-number field that applies its value when the user leaves it or presses Enter, since each
 * change reads the file again, and goes back to the value in use when what was typed is empty or out
 * of range. A value of null is a header row the reader did not find, shown empty
 *
 * Each new reading puts back the value it used, which may differ from what was typed where the reader
 * held a choice to the file. That is done in place rather than by remounting, so focus stays put
 */
function ImportRowCountField({
  reading,
  label,
  hasDivider,
  value,
  min,
  max,
  hasError = false,
  disabled,
  onCommit,
}: {
  reading: CsvReading
  label: string
  hasDivider: boolean
  value: number | null
  min: number
  max: number
  hasError?: boolean
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const inputId = useId()
  const shownValue = value === null ? '' : String(value)
  const [text, setText] = useState(shownValue)
  const [textReading, setTextReading] = useState(reading)
  if (textReading !== reading) {
    setTextReading(reading)
    setText(shownValue)
  }

  const commit = () => {
    const next = Number(text)
    if (!text.trim() || !Number.isInteger(next) || next < min || next > max) {
      setText(shownValue)
      return
    }
    if (next !== value) onCommit(next)
  }

  return (
    <ImportSettingRow label={label} labelFor={inputId} hasDivider={hasDivider}>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        aria-invalid={hasError || undefined}
        disabled={disabled}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') commit()
        }}
        // Drawn compact, 56px wide and 32px tall, since the row names the field
        className={`app-input app-input-no-spinner h-8 w-14 px-2 text-center tabular-nums${hasError ? ' app-input-error' : ''}`}
      />
    </ImportSettingRow>
  )
}

// A file read by a tool's own reader has no separator, so its cells are shown apart by a wide gap
function joinPreviewCells(cells: string[], delimiter: ImportDelimiter | undefined) {
  return cells.join(delimiter ?? '    ')
}

/**
 * The first and last lines of the file as the reader split them. Lines read are in body text, and
 * skipped lines are in muted text and struck through, which keeps both readable in either theme
 */
function ImportReadingPreview({ reading, delimiter }: { reading: CsvReading; delimiter: ImportDelimiter | undefined }) {
  const lines = reading.preview
  // The number column is as wide as the longest number, so the lines start at the labels' edge
  const columns = `${String(Math.max(...lines.map((line) => line.rowNumber))).length}ch minmax(0,1fr) auto`

  return (
    <ol className="flex flex-col gap-1 overflow-hidden text-xs" aria-label="First and last lines of the file">
      {lines.map((line, index) => {
        const isGap = index > 0 && line.rowNumber !== lines[index - 1].rowNumber + 1
        return (
          <li key={line.rowNumber} className="flex flex-col gap-1">
            {isGap && (
              <span
                aria-hidden
                className="grid gap-3"
                style={{ gridTemplateColumns: columns, color: 'var(--app-text-muted)' }}
              >
                <span className="text-right">…</span>
              </span>
            )}
            <span
              className="grid items-center gap-3"
              style={{
                gridTemplateColumns: columns,
                color: line.isSkipped ? 'var(--app-text-muted)' : 'var(--app-text)',
              }}
            >
              <span className="text-right tabular-nums">{line.rowNumber}</span>
              <span className={`truncate font-mono${line.isSkipped ? ' line-through' : ''}`}>
                {joinPreviewCells(line.cells, delimiter)}
              </span>
              <span className="text-xs font-semibold uppercase">{line.isSkipped ? 'Skipped' : ''}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
