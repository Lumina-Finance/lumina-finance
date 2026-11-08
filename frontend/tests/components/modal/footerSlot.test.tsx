/**
 * Guards that a panel's footer is drawn as it always was unless the panel asks for messages to keep
 * clear of it, so only the bank panels with a footer of their own change how it is wrapped
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModalFooterSlot } from '@/components/modal/FooterSlot'

describe('modal footer slot', () => {
  it('draws the footer bare by default', () => {
    const markup = renderToStaticMarkup(
      <ModalFooterSlot keepsToastClear={false}>
        <footer>Actions</footer>
      </ModalFooterSlot>,
    )

    expect(markup).toBe('<footer>Actions</footer>')
  })

  it('wraps the footer in the box a message keeps clear of when asked', () => {
    const markup = renderToStaticMarkup(
      <ModalFooterSlot keepsToastClear>
        <footer>Actions</footer>
      </ModalFooterSlot>,
    )

    expect(markup).toBe('<div class="shrink-0"><footer>Actions</footer></div>')
  })
})
