import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BookmarkPlus, X } from 'lucide-react'
import type { SavedInsightsRange } from '@/api/insights'
import { getRelativeRangeLabel } from '../utils/range'

const SAVED_RANGE_NAME_MAX_LENGTH = 64

// Matches the range pill's settle so a saved row eases in and collapses out in the same feel
const savedRangeSpring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

type SavedRangesProps = {
  savedRanges: SavedInsightsRange[]
  onSaveCurrentRange: (name: string) => Promise<void>
  onApplySavedRange: (range: SavedInsightsRange) => void
  onDeleteSavedRange: (rangeId: string) => void
}

/**
 * Lets a user name and save the active relative window, then reapply or delete saved ranges
 */
export function SavedRanges({
  savedRanges,
  onSaveCurrentRange,
  onApplySavedRange,
  onDeleteSavedRange,
}: SavedRangesProps) {
  const [name, setName] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const shouldReduceMotion = useReducedMotion()

  const trimmedName = name.trim()
  const rowTransition = shouldReduceMotion ? { duration: 0 } : savedRangeSpring

  /**
   * Saves the active relative window under the entered name, surfacing duplicate names
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (trimmedName === '' || isSaving) return

    setIsSaving(true)
    setSaveError(null)
    try {
      await onSaveCurrentRange(trimmedName)
      setName('')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save this range')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--app-border)' }}>
      <form onSubmit={handleSubmit} className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            className={`app-input w-full text-sm ${saveError ? 'app-input-error' : ''}`}
            placeholder="Name this range"
            aria-label="Saved range name"
            maxLength={SAVED_RANGE_NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setSaveError(null)
            }}
          />
          {saveError && (
            <p className="mt-1 text-xs" style={{ color: 'var(--app-negative)' }}>
              {saveError}
            </p>
          )}
        </div>
        <button
          type="submit"
          className="app-secondary-button flex shrink-0 items-center gap-1.5 text-sm"
          disabled={trimmedName === '' || isSaving}
        >
          <BookmarkPlus size={15} aria-hidden />
          Save
        </button>
      </form>

      <ul className={savedRanges.length > 0 ? 'mt-2' : ''}>
        <AnimatePresence initial={false}>
          {savedRanges.map((range) => (
              <motion.li
                key={range.id}
                initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={rowTransition}
                style={{ overflow: 'hidden' }}
              >
                <div className="flex items-center gap-1 pb-1">
                  <button
                    type="button"
                    className="app-card flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm"
                    onClick={() => onApplySavedRange(range)}
                    title={`Apply ${range.name}`}
                  >
                    <span className="min-w-0 truncate font-medium">{range.name}</span>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                      {getRelativeRangeLabel(range.amount, range.unit, range.qualifier)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="app-icon-button h-8 w-8 shrink-0"
                    onClick={() => onDeleteSavedRange(range.id)}
                    title={`Delete ${range.name}`}
                    aria-label={`Delete ${range.name}`}
                  >
                    <X size={15} aria-hidden />
                  </button>
                </div>
              </motion.li>
            ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}
