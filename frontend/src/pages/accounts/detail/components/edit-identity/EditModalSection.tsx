import type { ReactNode } from 'react'

type EditModalSectionProps = {
  number: string
  title: string
  children: ReactNode
}

/**
 * Keeps modal sections aligned to the numbered rail used by this edit workflow
 */
export function EditModalSection({
  number,
  title,
  children,
}: EditModalSectionProps) {
  return (
    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
      <div className="flex min-h-0 flex-col items-center">
        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
          {number}
        </span>
        <span className="mt-1 w-px flex-1" style={{ backgroundColor: 'var(--app-border-strong)' }} aria-hidden />
      </div>

      <div className="min-w-0 space-y-3">
        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
          {title}
        </p>
        {children}
      </div>
    </section>
  )
}
