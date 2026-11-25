type ApplyRulesButtonProps = {
  /** Set while this press runs. The link is held off and dims, and a screen reader hears it is busy */
  isApplying: boolean

  /** Set while the other press of the block runs. The link is held off and dims */
  isHeldOff: boolean
  onApply: () => void
}

const LABEL = 'Reapply updated rules'

/**
 * Puts the waiting items through the import rules as they stand now and saves what the rules give.
 * It is drawn as the retry of the block's failure notice is, as a link at the end of the tinted line,
 * so the line reads as one notice rather than holding a second button beside Approve all. It keeps its
 * label while busy, so its width never changes
 */
export function ApplyRulesButton({ isApplying, isHeldOff, onApply }: ApplyRulesButtonProps) {
  // The focus ring takes the selected navigation item's focus colour, since the usual one is under 3:1 on
  // the warning tint. On a phone the link starts a line of its own, and its 2px of room for that ring comes
  // off its left, so its label starts where the sentence above it does
  return (
    <button
      type="button"
      className="app-inline-link -ml-0.5 shrink-0 whitespace-nowrap font-medium sm:ml-0 underline underline-offset-2 transition-control focus-visible:outline-(--app-accent-nav-focus-border) disabled:cursor-default disabled:opacity-50"
      aria-busy={isApplying}
      disabled={isApplying || isHeldOff}
      onClick={onApply}
    >
      {LABEL}
    </button>
  )
}
