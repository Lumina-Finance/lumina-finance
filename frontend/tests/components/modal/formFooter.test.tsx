/**
 * Guards that a modal form's Cancel stays blocked while its submission is in flight unless the form
 * says otherwise, since most forms rely on that default
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModalFormFooter } from '@/components/modal/FormFooter'

describe('modal form footer', () => {
  it('blocks cancelling while the submission is in flight', () => {
    const markup = renderToStaticMarkup(
      <ModalFormFooter submitLabel="Save" submitDisabled submitWidthClassName="w-32" onCancel={() => {}} />,
    )
    expect(markup.match(/<button[^>]*>Cancel<\/button>/)?.[0]).toContain('disabled')
  })
})
