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

  it('fades between the labels a primary button can show and eases its width, rather than snapping', () => {
    const markup = renderToStaticMarkup(
      <ModalFormFooter
        submitLabel="Disconnect"
        submitLabels={['Unlink', 'Disconnect']}
        submitDisabled={false}
        submitWidthClassName="w-full sm:w-auto"
        onCancel={() => {}}
      />,
    )

    expect(markup).toMatch(/opacity:0[^>]*>Unlink<\/span>/)
    expect(markup).toMatch(/opacity:1[^>]*>Disconnect<\/span>/)
    expect(markup).toContain('sm:w-(--fit-width)')
  })

  it('keeps a button with one label to its plain label and width', () => {
    const markup = renderToStaticMarkup(
      <ModalFormFooter submitLabel="Save" submitDisabled={false} submitWidthClassName="w-32" onCancel={() => {}} />,
    )

    expect(markup).toContain('>Save</button>')
    expect(markup).not.toContain('--fit-width')
  })
})
