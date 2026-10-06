import { useId, useState, type KeyboardEvent } from 'react'
import type { CsvReading, ImportFileDraft } from '@/pages/imports/types'
import type { ImportDelimiter } from '@/pages/imports/utils'
import { ImportDelimiterControl } from './FormatControls'

/**
 * How the staged CSV file is read: its separator, the row its headings sit on and how many lines to
 * leave out at the end, with the first and last lines of the file showing which lines are skipped
 *
 * Shown for a refused file too, since most refusals of a bank export are fixed by one of these
 */
export function ImportReadingChoices({
  file,
  onDelimiterChange,
  onHeaderRowChange,
  onSkipLastRowsChange,
}: {
  file: ImportFileDraft
  onDelimiterChange: (delimiter: ImportDelimiter) => void
  onHeaderRowChange: (headerRow: number) => void
  onSkipLastRowsChange: (skipLastRows: number) => void
}) {
  const { delimiter, reading } = file
  const lineCount = reading ? Math.max(...reading.preview.map((line) => line.rowNumber)) : 0

  // A wide line that may start a summary is fixed from Skip last rows, so that field carries the error
  const isSkipSuggested = reading?.suggestedSkipLastRows !== undefined

  return (
    <div className="flex flex-col gap-4 px-3">
      {/* The separators across the full width, and the two row counts side by side under them, each
          label above its control */}
      <div className="flex flex-col gap-3">
        {delimiter && (
          <ImportDelimiterControl delimiter={delimiter} hasError={Boolean(file.error) && !isSkipSuggested} onChange={onDelimiterChange} />
        )}
        {reading && (
          <div className="grid grid-cols-2 gap-3">
            <ImportRowCountField
              reading={reading}
              label="Header row"
              value={reading.headerRow}
              min={1}
              max={Math.max(1, lineCount - reading.skipLastRows)}
              onCommit={onHeaderRowChange}
            />
            <ImportRowCountField
              reading={reading}
              label="Skip last rows"
              value={reading.skipLastRows}
              min={0}
              max={Math.max(0, lineCount - 1)}
              hasError={isSkipSuggested}
              onCommit={onSkipLastRowsChange}
            />
          </div>
        )}
      </div>
      {reading && <ImportReadingPreview reading={reading} delimiter={delimiter} />}
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
  value,
  min,
  max,
  hasError = false,
  onCommit,
}: {
  reading: CsvReading
  label: string
  value: number | null
  min: number
  max: number
  hasError?: boolean
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        aria-invalid={hasError || undefined}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') commit()
        }}
        className={`app-input app-input-no-spinner tabular-nums${hasError ? ' app-input-error' : ''}`}
      />
    </div>
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
              <span aria-hidden className="grid gap-3" style={{ gridTemplateColumns: columns, color: 'var(--app-text-muted)' }}>
                <span className="text-right">…</span>
              </span>
            )}
            <span
              className="grid items-center gap-3"
              style={{ gridTemplateColumns: columns, color: line.isSkipped ? 'var(--app-text-muted)' : 'var(--app-text)' }}
            >
              <span className="text-right tabular-nums">{line.rowNumber}</span>
              <span className={`truncate font-mono${line.isSkipped ? ' line-through' : ''}`}>{joinPreviewCells(line.cells, delimiter)}</span>
              <span className="text-xs font-semibold uppercase">{line.isSkipped ? 'Skipped' : ''}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
