import type React from 'react'
import { Check } from 'lucide-react'

// The tick and the dash are always drawn and ease in and out with the fill, stacked in the box so it keeps its size
const markClassName = 'absolute transition-[opacity,scale] motion-reduce:transition-none'
const shownClassName = 'scale-100 opacity-100'
const hiddenClassName = 'scale-50 opacity-0'

/**
 * Checkbox button, supporting a mixed state for a selection that is only partly checked
 *
 * A button rather than an input, so it can carry the app's own styling. That is also why it cannot
 * sit inside another button, which is what a row offering both a checkbox and a click of its own
 * has to be built around
 */
export function Checkbox({
  checked,
  disabled,
  indeterminate = false,
  label,
  uncheckedBackground = 'var(--app-input-bg)',
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  indeterminate?: boolean
  label: string

  // What an empty box is filled with. The default reads against the page, and a caller putting a box
  // on a surface of that same colour passes something else so the box does not disappear into it
  uncheckedBackground?: string

  // Takes the click so a caller can read a held modifier key from it, which a range selection needs
  onChange: (event: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      className="relative flex h-5 w-5 items-center justify-center rounded-lg transition-[background-color,border-color,opacity] motion-reduce:transition-none app-field-focus-visible"
      style={{
        background: checked || indeterminate ? 'var(--app-accent)' : uncheckedBackground,
        border: `1px solid ${checked || indeterminate ? 'var(--app-accent)' : 'var(--app-border-strong)'}`,
        color: 'var(--app-button-primary-text)',
        opacity: disabled ? 0.38 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={onChange}
      disabled={disabled}
    >
      <Check
        className={`${markClassName} ${checked ? shownClassName : hiddenClassName}`}
        size={13}
        strokeWidth={3}
        aria-hidden
      />
      <span
        className={`${markClassName} h-0.5 w-2.5 rounded-full ${!checked && indeterminate ? shownClassName : hiddenClassName}`}
        style={{ background: 'currentColor' }}
        aria-hidden
      />
    </button>
  )
}
