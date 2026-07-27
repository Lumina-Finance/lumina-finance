import type { ReactNode } from 'react'

interface CreateModalSectionFrameProps {
  children: ReactNode
  step: string
  // Folds a heading into the rail above the children instead of leaving the caller to render its own
  title?: string
}

/**
 * Renders the numbered left rail used by create-modal form sections, with an optional heading above
 * the section content
 */
export default function CreateModalSectionFrame({ children, step, title }: CreateModalSectionFrameProps) {
  return (
    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
      <div className="flex min-h-0 flex-col items-center">
        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
          {step}
        </span>
        <span
          className="mt-1 w-px flex-1"
          style={{ backgroundColor: 'var(--app-border-strong)' }}
          aria-hidden
        />
      </div>

      {title ? (
        <div className="min-w-0 space-y-3">
          <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
            {title}
          </p>
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  )
}
