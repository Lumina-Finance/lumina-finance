import type { KeyboardEvent, ReactNode } from 'react'
import { Check } from 'lucide-react'

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

  const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')]
  const index = radios.indexOf(event.currentTarget)
  const next = radios[(index + step + radios.length) % radios.length]
  event.preventDefault()
  next.focus()
  next.click()
}

type ChoiceCardProps = {
  selected: boolean
  disabled?: boolean
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
  onSelect,
  children,
  extra,
  initialFocus = false,
  id,
}: ChoiceCardProps) {
  // An unavailable card is marked by its plain fill and faded radio rather than by fading the whole
  // card. Fading the card would take its text below readable contrast
  const frameStyle = {
    borderColor: selected ? 'var(--app-accent)' : 'var(--app-border)',
    background: selected ? 'var(--app-accent-soft)' : disabled ? 'var(--app-surface-soft)' : 'transparent',
  }
  // An unselected card that can be chosen fills on hover, and on keyboard focus through the hover variant
  // The fill is important because the frame's resting fill is set inline
  const hoverClass = selected || disabled ? '' : 'hover:bg-[var(--app-hover-soft)]!'
  const frameClass = `rounded-xl border transition-control motion-reduce:transition-none ${hoverClass}`

  const choice = (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      data-modal-field-tab-stop={initialFocus ? 'true' : undefined}
      data-modal-initial-focus={initialFocus ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={moveWithArrows}
      className={`flex w-full items-start gap-3 p-3.5 text-left disabled:cursor-not-allowed ${extra === undefined ? frameClass : 'rounded-xl sm:min-w-0 sm:flex-1'}`}
      style={extra === undefined ? frameStyle : undefined}
    >
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
      <span className="min-w-0 flex-1">{children}</span>
    </button>
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
