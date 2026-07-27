import type React from 'react'

/**
 * Labelled wrapper for one settings control, with room for an accessory beside the label and
 * a hint line beneath the control
 */
export default function SettingsField({
  label,
  labelAccessory,
  hint,
  children,
}: {
  label: string
  labelAccessory?: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  // Plain <div>, not <label>. A <label> wrapper re-dispatches clicks onto
  // the first labelable control inside it, which reopens a Dropdown that just
  // closed on option selection. The visual label is the span below
  return (
    <div className="space-y-1.5 block">
      <div className="flex items-center gap-2">
        <span className="app-label block">{label}</span>
        {labelAccessory}
      </div>
      {children}
      {hint && (
        <span className="block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}
