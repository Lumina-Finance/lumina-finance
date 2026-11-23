/**
 * Covers when a feature's page shows as it is and when the build's screen takes its place
 *
 * These tests catch a build with no screen asking the server or changing a page, the page of a
 * feature the user isn't granted drawn or its requests sent under the screen, a page covered for a
 * feature the user is granted, the page drawn before the answer arrives, and a failed answer leaving
 * the page blank
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureGrants } from '@/api/user'
import { FeatureCover } from '@/components/feature-cover/Cover'
import type { FeatureCoverScreenProps } from '@/slots/featureCover'

const state = vi.hoisted(() => ({
  screen: null as ((props: FeatureCoverScreenProps) => ReactNode) | null,
  answer: undefined as FeatureGrants | undefined,
  failed: false,

  // Whether each render's read was allowed to ask the server
  readsEnabled: [] as boolean[],
}))

vi.mock('@/slots/featureCover', () => ({
  get FeatureCoverScreen() {
    return state.screen
  },
}))
vi.mock('@/api/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/user')>()),
  useFeatureGrants: (enabled: boolean) => {
    state.readsEnabled.push(enabled)
    const data = enabled ? state.answer : undefined
    return { data, isPending: data === undefined && !state.failed }
  },
}))

function BuildScreen({ feature }: FeatureCoverScreenProps) {
  return <p>{`Build screen for ${feature}`}</p>
}

function renderInsights() {
  return renderToStaticMarkup(
    <FeatureCover feature="insights">
      <p>Insights figures</p>
    </FeatureCover>,
  )
}

beforeEach(() => {
  state.screen = null
  state.answer = undefined
  state.failed = false
  state.readsEnabled = []
})

describe('a build with no screen', () => {
  it('shows the page as it is and never asks the server, whatever it would answer', () => {
    state.answer = { features: ['bank_sync'] }

    expect(renderInsights()).toBe('<p>Insights figures</p>')
    expect(state.readsEnabled).toEqual([false])
  })
})

describe('a build with a screen', () => {
  beforeEach(() => {
    state.screen = BuildScreen
  })

  it('draws the screen in place of the page when the user isn’t granted the feature', () => {
    state.answer = { features: ['bank_sync'] }

    const html = renderInsights()

    expect(html).toContain('Build screen for insights')
    expect(html).not.toContain('Insights figures')
    expect(state.readsEnabled).toEqual([true])
  })

  it('shows the page as it is when the user is granted the feature', () => {
    state.answer = { features: ['bank_sync', 'insights'] }

    expect(renderInsights()).toBe('<p>Insights figures</p>')
  })

  it('draws neither the page nor the screen until the server answers', () => {
    expect(renderInsights()).toBe('')
  })

  it('shows the page as it is when the server cannot answer, so its own parts say what failed', () => {
    state.failed = true

    expect(renderInsights()).toBe('<p>Insights figures</p>')
  })

  it('gives the covering section the page section’s id, so a link to it still lands there', () => {
    state.answer = { features: ['insights'] }

    const html = renderToStaticMarkup(
      <FeatureCover feature="bank_sync" id="bank-connections">
        <p>Connections</p>
      </FeatureCover>,
    )

    expect(html).toBe('<section id="bank-connections"><p>Build screen for bank_sync</p></section>')
  })
})
