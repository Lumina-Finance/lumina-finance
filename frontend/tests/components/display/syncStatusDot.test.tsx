/**
 * Guards the sync status dot: each state takes its own colour token, an account that does not sync
 * gets a hollow dot, and the dot is hidden from assistive technology since the label beside it says
 * the state in words
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SyncStatusDot } from '@/components/display/SyncStatusDot'

describe('sync status dot', () => {
  it('fills the dot with the colour of its state', () => {
    expect(renderToStaticMarkup(<SyncStatusDot tone="working" pulse />)).toContain('background:var(--app-bank)')
    expect(renderToStaticMarkup(<SyncStatusDot tone="ok" />)).toContain('background:var(--app-positive)')
    expect(renderToStaticMarkup(<SyncStatusDot tone="review" />)).toContain('background:var(--app-warning-dot)')
    expect(renderToStaticMarkup(<SyncStatusDot tone="stopped" />)).toContain('background:var(--app-negative)')
  })

  it('draws an account that does not sync as a hollow ring', () => {
    const markup = renderToStaticMarkup(<SyncStatusDot tone="off" />)

    expect(markup).toContain('background:transparent')
    expect(markup).toContain('border:1.5px solid var(--app-text-subtle)')
    expect(markup).toContain('aria-hidden="true"')
  })
})
