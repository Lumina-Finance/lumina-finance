/**
 * Toggle switch drawn over a visually hidden checkbox with the switch role, so the browser still
 * handles the keyboard and the label that wraps it, which every caller supplies as the row that toggles it
 *
 * The track has no border, so keyboard focus draws the shared ring around it, and the track takes a
 * stronger fill under the pointer and on keyboard focus (`.app-switch` in the stylesheet)
 */
export function Switch({
  id,
  checked,
  disabled,
  describedBy,
  onChange,
}: {
  id: string
  checked: boolean
  disabled?: boolean
  describedBy?: string
  onChange: (checked: boolean) => void
}) {
  return (
    <span className="app-switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
        className="app-switch-input sr-only"
      />
      <span className="app-switch-track" aria-hidden />
      <span className="app-switch-thumb" aria-hidden />
    </span>
  )
}
