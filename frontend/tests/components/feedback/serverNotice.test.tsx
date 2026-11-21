/**
 * Guards what a user reads when the page and the server differ in version or the server is in
 * maintenance: the update notice offers a Reload button, the maintenance notice has no button, and
 * a screen that failed to load during maintenance never says the server couldn't be reached
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildApiError, MAINTENANCE_MESSAGE } from '@/api/auth'
import Fallback from '@/components/errors/Fallback'
import LoadFailure from '@/components/errors/LoadFailure'
import { ServerNoticeView } from '@/components/feedback/ServerNotice'

const UPDATE_MESSAGE = 'A new version of Lumina Finance is available. Please save your work and reload to update.'

describe('the notice about the server', () => {
  it('offers a reload when the server runs another version', () => {
    const markup = renderToStaticMarkup(<ServerNoticeView notice="update" />)

    expect(markup).toContain(UPDATE_MESSAGE)
    expect(markup).toMatch(/<button[^>]*>Reload<\/button>/)
  })

  it('says the server is in maintenance, with nothing to press', () => {
    const markup = renderToStaticMarkup(<ServerNoticeView notice="maintenance" />)

    expect(markup).toContain(MAINTENANCE_MESSAGE)
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('Couldn&#x27;t reach the server')
  })

  it('shows nothing, in a region a screen reader is already watching, when there is nothing to say', () => {
    expect(renderToStaticMarkup(<ServerNoticeView notice={null} />)).toBe(
      '<div role="status" class="max-[1049px]:pr-14"></div>',
    )
  })
})

describe('a card that failed to load during maintenance', () => {
  it('says the server is in maintenance rather than that it could not be reached', () => {
    const error = buildApiError(503, { maintenance: true })

    const markup = renderToStaticMarkup(<LoadFailure error={error} subject="Accounts" />)

    expect(markup).toContain(MAINTENANCE_MESSAGE)
    expect(markup).not.toContain('reach the server')
  })
})

describe('the screen shown when opening the app fails during maintenance', () => {
  it('says the server is in maintenance, not that something is broken or unreachable', () => {
    const error = buildApiError(503, { maintenance: true })

    const markup = renderToStaticMarkup(<Fallback componentStack={null} error={error} variant="screen" />)

    expect(markup).toContain(MAINTENANCE_MESSAGE)
    expect(markup).not.toContain('reach the server')
    expect(markup).not.toContain('not in the')
  })
})
