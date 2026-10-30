/**
 * Tests Commit import while a check the server runs before it holds it: the button stays reachable
 * but off, the reason is printed and described to a screen reader the way a build error is, a failed
 * check offers a retry, and the answers' own problem is said first
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportCommitFooter, type ImportCommitCheck } from '@/pages/imports/components'
import { OFX_HELD_CHECK_FAILED_MESSAGE, OFX_HELD_CHECK_RUNNING_MESSAGE } from '@/pages/imports/ofx/constants'

const RUNNING: ImportCommitCheck = { state: 'running', message: OFX_HELD_CHECK_RUNNING_MESSAGE, onRetry: () => {} }
const FAILED: ImportCommitCheck = { state: 'failed', message: OFX_HELD_CHECK_FAILED_MESSAGE, onRetry: () => {} }

function render(props: { check?: ImportCommitCheck | null; buildError?: string | null; canCommit?: boolean }) {
  return renderToStaticMarkup(
    <ImportCommitFooter
      importError={null}
      canCommit={props.canCommit ?? false}
      imported={false}
      onCommit={() => {}}
      className=""
      {...props}
    />,
  )
}

/** The button's markup, and the markup of the line that has the id the button is described by */
function readButton(markup: string) {
  const button = markup.match(/<button[^>]*>Commit import<\/button>/)?.[0] ?? ''
  const describedBy = button.match(/aria-describedby="([^"]+)"/)?.[1]
  const line = describedBy ? markup.match(new RegExp(`<p[^>]*id="${describedBy}"[^>]*>([^<]*)</p>`)) : null
  return { button, describedBy, lineText: line?.[1] }
}

describe('Commit import while the held-rows check runs', () => {
  it('is off but focusable, and a screen reader hears the line saying what it waits for', () => {
    const { button, describedBy, lineText } = readButton(render({ check: RUNNING }))

    expect(button).toContain('aria-disabled="true"')
    expect(button).not.toContain(' disabled')
    expect(describedBy).toBeDefined()
    expect(lineText).toBe(OFX_HELD_CHECK_RUNNING_MESSAGE)
  })

  it('is described by the failure when the check could not be answered, and offers another go', () => {
    const markup = render({ check: FAILED })
    const { button, lineText } = readButton(markup)

    expect(button).toContain('aria-disabled="true"')
    // The markup writes the apostrophe as an entity
    expect(lineText).toBe(OFX_HELD_CHECK_FAILED_MESSAGE.replace("'", '&#x27;'))
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Try again')
  })

  it('says what the answers still need first, and the check once they need nothing', () => {
    const withError = readButton(render({ check: RUNNING, buildError: 'Choose an account for the statement.' }))

    expect(withError.lineText).toBe('Choose an account for the statement.')
    expect(render({ check: RUNNING, buildError: 'Choose an account for the statement.' })).not.toContain(
      OFX_HELD_CHECK_RUNNING_MESSAGE,
    )
  })

  it('shows neither line and is a plain button once the check has answered', () => {
    const markup = render({ check: null, canCommit: true })

    expect(markup).not.toContain('aria-disabled')
    expect(markup).not.toContain(OFX_HELD_CHECK_RUNNING_MESSAGE)
    expect(markup).not.toContain('Try again')
  })
})

describe('Commit import after the server refused the import', () => {
  it("marks the server's English reason with its language only when it is told to", () => {
    const props = {
      importError: 'Account is archived',
      canCommit: true,
      imported: false,
      onCommit: () => {},
      className: '',
    }

    expect(renderToStaticMarkup(<ImportCommitFooter {...props} importErrorLang="en" />)).toContain(
      '<span lang="en">Account is archived</span>',
    )
    expect(renderToStaticMarkup(<ImportCommitFooter {...props} />)).not.toContain('lang=')
  })
})
