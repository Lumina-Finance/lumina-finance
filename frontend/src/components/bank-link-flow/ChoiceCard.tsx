import type { KeyboardEvent, ReactNode } from 'react'
import { Check, Lock } from 'lucide-react'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

// How much of a locked card shows through
const LOCKED_OPACITY = 0.55

// Arrow keys that move to the next choice in the group, and those that move back
const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight'])
const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft'])

/**
 * Moves to the group's next or previous choice and chooses it, as arrow keys do between native radio
 * buttons, wrapping round at either end and stepping over choices that can't be taken
 */
function moveWithArrows(event: KeyboardEvent<HTMLButtonElement>) {
  const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0
  const group = event.currentTarget.closest('[role="radiogroup"]')
  if (step === 0 || !group) return

  const radios = [
    ...group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled):not([aria-disabled="true"])'),
  ]
  const index = radios.indexOf(event.currentTarget)
  const next = radios[(index + step + radios.length) % radios.length]
  event.preventDefault()
  next.focus()
  next.click()
}

type ChoiceCardProps = {
  selected: boolean
  disabled?: boolean

  /**
   * Why the choice can't be taken, which locks the card. The reason shows in the app's tooltip on hover,
   * keyboard focus and a tap, and the card stays reachable, marked `aria-disabled`, so choosing it does nothing
   */
  unavailableReason?: string | null
  onSelect: () => void
  children: ReactNode

  /** A field of the choice's own, inside the card's frame but outside its button */
  extra?: ReactNode

  /** Takes focus as its dialogue opens, in place of the dialogue's first field */
  initialFocus?: boolean

  /** Lets a refused press bring focus to the choice */
  id?: string
}

/**
 * A selectable card in the bank link flow's lists, shown as unavailable when it cannot be chosen
 *
 * Anything passed as extra sits beneath the choice on phones and beside it from sm up
 */
export function ChoiceCard({
  selected,
  disabled,
  unavailableReason,
  onSelect,
  children,
  extra,
  initialFocus = false,
  id,
}: ChoiceCardProps) {
  // A card held off by its own request is marked by its plain fill and faded radio. One that can't be
  // chosen at all is locked: faded as a whole, a lock in place of the radio and no fill of its own
  const locked = Boolean(unavailableReason)
  // A held-off card takes the shared input fill and border, as the balance panel does, since the soft
  // surface fill is all but invisible against the dialogue in dark
  const held = disabled && !locked
  const frameStyle = {
    borderColor: selected ? 'var(--app-accent)' : held ? 'var(--app-input-border)' : 'var(--app-border)',
    background: selected ? 'var(--app-accent-soft)' : held ? 'var(--app-input-bg)' : 'transparent',
    opacity: locked ? LOCKED_OPACITY : undefined,
  }
  // An unselected card that can be chosen fills on hover, and on keyboard focus through the hover variant
  // The fill is important because the frame's resting fill is set inline. A selected card already rests
  // in the accent look, so the pointer and keyboard focus strengthen its border instead, as the selected
  // menu item's do. The card's own button carries the focus when an extra field sits beside it
  const hoverClass = selected
    ? 'hover:border-[var(--app-accent-nav-focus-border)]! has-[button:focus-visible]:border-[var(--app-accent-nav-focus-border)]!'
    : disabled || locked
      ? ''
      : 'hover:bg-[var(--app-hover-soft)]!'
  const frameClass = `rounded-xl border transition-control motion-reduce:transition-none ${hoverClass}`

  const choice = (
    <DisabledReasonButton
      id={id}
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      disabledReason={unavailableReason}
      hangReasonFromControl
      data-modal-field-tab-stop={initialFocus ? 'true' : undefined}
      data-modal-initial-focus={initialFocus ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={moveWithArrows}
      className={`flex w-full items-start gap-3 p-3.5 text-left disabled:cursor-not-allowed aria-disabled:cursor-not-allowed ${extra === undefined ? frameClass : 'rounded-xl sm:min-w-0 sm:flex-1'}`}
      style={extra === undefined ? frameStyle : undefined}
    >
      {locked ? (
        // Where the radio sits and as big as it, since a locked card can't be chosen
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--app-text-muted)' }} />
      ) : (
        <span
          className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all motion-reduce:transition-none"
          style={{
            borderColor: selected ? 'var(--app-accent)' : 'var(--app-border-strong)',
            background: selected ? 'var(--app-accent)' : 'transparent',
            opacity: disabled ? 0.45 : 1,
          }}
        >
          {/* Always drawn, and grown in or out by the choice, so the mark never pops */}
          <Check
            size={10}
            strokeWidth={3}
            color="var(--app-button-primary-text)"
            aria-hidden
            className={`transition-all motion-reduce:transition-none ${selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}
          />
        </span>
      )}
      <span className="min-w-0 flex-1">{children}</span>
    </DisabledReasonButton>
  )

  if (extra === undefined) return choice

  return (
    // Held at the top, so the choice stays put while the extra grows beneath, as with an error under a field
    <div className={`sm:flex sm:items-start ${frameClass}`} style={frameStyle}>
      {choice}
      {extra}
    </div>
  )
}
