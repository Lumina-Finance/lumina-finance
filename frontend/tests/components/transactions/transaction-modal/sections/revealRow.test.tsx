import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  COLLAPSIBLE_SECTION_EASE,
  COLLAPSIBLE_SECTION_TRANSITION_SECONDS,
} from '@/components/collapsible-section/motion'
import RevealRow from '@/components/transactions/transaction-modal/sections/RevealRow'

const motion = vi.hoisted(() => ({ props: null as Record<string, unknown> | null, reduced: false }))

vi.mock('motion/react', () => ({
  useReducedMotion: () => motion.reduced,
  motion: {
    div: ({ children, ...props }: { children: ReactNode }) => {
      motion.props = props
      return createElement('div', null, children)
    },
  },
}))

describe('a row joining or leaving a list of links', () => {
  it('grows from nothing and collapses back on the collapsible sections timing', () => {
    motion.reduced = false
    renderToStaticMarkup(<RevealRow>row</RevealRow>)

    expect(motion.props).toMatchObject({
      initial: { height: 0, opacity: 0 },
      animate: { height: 'auto', opacity: 1 },
      exit: { height: 0, opacity: 0 },
      transition: { duration: COLLAPSIBLE_SECTION_TRANSITION_SECONDS, ease: COLLAPSIBLE_SECTION_EASE },
    })
  })

  it('does not animate for a user who asks for reduced motion', () => {
    motion.reduced = true
    renderToStaticMarkup(<RevealRow>row</RevealRow>)

    expect(motion.props).toMatchObject({ transition: { duration: 0 } })
  })
})
