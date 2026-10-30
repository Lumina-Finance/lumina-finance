import type { ReactNode } from 'react'
import { Crossfade } from '@/components/loading/Crossfade'

/** The spinner, announced under `name` so a screen reader hears what is in progress */
export function NamedSpinner({ name }: { name: string }) {
  return <div className="app-spinner" role="img" aria-label={name} />
}

/**
 * A button's content that gives way to a named spinner while `pending`, crossfading both ways and
 * easing the button's width between the two. Put it directly inside the button. `className` is added
 * to the content, for example `gap-2` between an icon and a label
 */
export function PendingLabel({
  pending,
  name,
  className,
  children,
}: {
  pending: boolean
  name: string
  className?: string
  children: ReactNode
}) {
  return (
    <Crossfade swapKey={pending ? 'pending' : 'idle'} className={className}>
      {pending ? <NamedSpinner name={name} /> : children}
    </Crossfade>
  )
}
