import { Undo2 } from 'lucide-react'

/**
 * Tells the user before they save that an import can be undone, and what ends that, so a trial
 * import feels safe and they know to leave their data alone until they've decided
 */
export function ImportUndoNoticeCard() {
  return (
    <section
      className="rounded-lg px-4 py-3"
      style={{
        background: 'color-mix(in srgb, var(--app-positive) 12%, var(--app-bg))',
        border: '1px solid color-mix(in srgb, var(--app-positive) 35%, transparent)',
      }}
      aria-labelledby="import-undo-notice-title"
    >
      <div className="flex items-start gap-3">
        <Undo2
          size={16}
          strokeWidth={2.25}
          className="mt-0.5 shrink-0"
          style={{ color: 'var(--app-positive)' }}
          aria-hidden
        />
        <div className="min-w-0">
          <h2
            id="import-undo-notice-title"
            className="text-[0.9375rem] font-semibold leading-5"
            style={{ color: 'var(--app-text)' }}
          >
            You can undo it
          </h2>
          <p className="mt-1 text-sm leading-5 text-pretty" style={{ color: 'var(--app-text)' }}>
            As long as you don't make any other changes in the app, you can undo this import within 24 hours of
            saving it.
          </p>
        </div>
      </div>
    </section>
  )
}
