import { HandCoins } from 'lucide-react'

interface RefundButtonProps {
  onClick: () => void
}

/**
 * Opens a refund of the expense on screen. It rests as an icon and grows into a labelled button under
 * the pointer and on keyboard focus, and rests grown on a touch screen
 */
export default function RefundButton({ onClick }: RefundButtonProps) {
  return (
    <button
      type="button"
      data-testid="transaction-refund"
      aria-label="Refund"
      onClick={onClick}
      className="app-expanding-button shrink-0"
    >
      <HandCoins size={16} aria-hidden />
      <span className="app-expanding-button-label" aria-hidden>
        <span>Refund</span>
      </span>
    </button>
  )
}
