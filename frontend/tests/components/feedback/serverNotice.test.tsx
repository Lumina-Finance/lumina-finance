/**
 * Guards what a user reads when the page and the server differ in version or the server is in
 * maintenance: the update notice offers a Reload button, the maintenance notice has no button, and
 * a screen that failed to load during maintenance never says the server couldn't be reached
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApiError, MAINTENANCE_MESSAGE } from '@/api/auth'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { reportMaintenance } from '@/api/version'
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
    const markup = renderToStaticMarkup(<ServerNoticeView notice={null} />)

    expect(markup).toMatch(/^<div role="status"[^>]*><\/div>$/)
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

describe('a card that failed to load when the maintenance file says the server is in maintenance', () => {
  afterEach(() => {
    reportMaintenance(false)
  })

  it.each([
    ['a request the server never answered', () => new TypeError(SERVER_UNREACHABLE_MESSAGE)],
    ['a gateway error page', () => buildApiError(504, null)],
  ])('says the server is in maintenance after %s', (_label, makeError) => {
    reportMaintenance(true)

    const markup = renderToStaticMarkup(<LoadFailure error={makeError()} subject="Accounts" />)

    expect(markup).toContain(MAINTENANCE_MESSAGE)
    expect(markup).not.toContain('reach the server')
  })

  it('still says the server could not be reached when there is no maintenance', () => {
    const markup = renderToStaticMarkup(
      <LoadFailure error={new TypeError(SERVER_UNREACHABLE_MESSAGE)} subject="Accounts" />,
    )

    expect(markup).not.toContain(MAINTENANCE_MESSAGE)
    expect(markup).toContain('reach the server')
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

describe('the screen shown when the server answers nothing during a maintenance', () => {
  afterEach(() => {
    reportMaintenance(false)
  })

  it('says the server is in maintenance when the maintenance file says so, not that it is unreachable', () => {
    reportMaintenance(true)
    const error = new TypeError(SERVER_UNREACHABLE_MESSAGE)

    const markup = renderToStaticMarkup(<Fallback componentStack={null} error={error} variant="screen" />)

    expect(markup).toContain(MAINTENANCE_MESSAGE)
    expect(markup).not.toContain('reach the server')
    expect(markup).not.toContain('not in the')
  })

  it.each([
    ['a gateway error page', () => buildApiError(502, null)],
    ['a request that ran out of time', () => new DOMException('Too slow', 'TimeoutError')],
  ])('says the server is in maintenance after %s when the maintenance file says so', (_label, makeError) => {
    reportMaintenance(true)

    const markup = renderToStaticMarkup(<Fallback componentStack={null} error={makeError()} variant="screen" />)

    expect(markup).toContain(MAINTENANCE_MESSAGE)
    expect(markup).not.toContain('not in the')
  })

  it('says something broke when the app itself answered with an error during a maintenance', () => {
    reportMaintenance(true)

    const markup = renderToStaticMarkup(
      <Fallback
        componentStack={null}
        error={buildApiError(502, { detail: 'Provider unreachable' })}
        variant="screen"
      />,
    )

    expect(markup).not.toContain(MAINTENANCE_MESSAGE)
  })

  it('keeps saying something broke when the screen failed for another reason', () => {
    reportMaintenance(true)

    const markup = renderToStaticMarkup(
      <Fallback componentStack={null} error={new TypeError('x is undefined')} variant="screen" />,
    )

    expect(markup).not.toContain(MAINTENANCE_MESSAGE)
    expect(markup).toContain('not in the')
  })
})
