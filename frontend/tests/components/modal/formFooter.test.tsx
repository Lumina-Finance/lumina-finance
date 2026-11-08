/**
 * Guards that a modal form's Cancel stays blocked while its submission is in flight unless the form
 * says otherwise, since most forms rely on that default
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ModalFormFooter } from '@/components/modal/FormFooter'

// The crossfade needs a browser to mount, so the button's content is drawn without its animated layers. The
// key it is given is kept, since a label change crossfades and eases the width only when that key changes
const { swapKeys } = vi.hoisted(() => ({ swapKeys: [] as string[] }))
vi.mock('@/components/loading/Crossfade', () => ({
  Crossfade: ({ swapKey, children }: { swapKey: string; children: unknown }) => {
    swapKeys.push(swapKey)
    return children
  },
}))

describe('modal form footer', () => {
  it('blocks cancelling while the submission is in flight', () => {
    const markup = renderToStaticMarkup(
      <ModalFormFooter submitLabel="Save" submitDisabled submitWidthClassName="w-32" onCancel={() => {}} />,
    )
    expect(markup.match(/<button[^>]*>Cancel<\/button>/)?.[0]).toContain('disabled')
  })

  it('fits a button to its current label, crossfading and easing its width when the label changes', () => {
    const draw = (submitLabel: string) => {
      swapKeys.length = 0
      const markup = renderToStaticMarkup(
        <ModalFormFooter
          submitLabel={submitLabel}
          fadesLabelChanges
          submitDisabled={false}
          submitWidthClassName="w-full sm:w-auto"
          onCancel={() => {}}
        />,
      )
      return { markup, swapKey: swapKeys[0] }
    }

    const unlink = draw('Unlink')
    const disconnect = draw('Disconnect')

    // A new label is a new key, which is what crossfades the labels and eases the button between their widths
    expect(unlink.swapKey).not.toBe(disconnect.swapKey)
    // The button holds only the label it shows, and takes its width from it rather than from another label
    expect(unlink.markup).toContain('>Unlink</button>')
    expect(unlink.markup).not.toContain('Disconnect')
    expect(unlink.markup).toContain('sm:w-auto')
    expect(unlink.markup).not.toContain('--fit-width')
  })

  it('keeps a button with one label to its plain label and width', () => {
    swapKeys.length = 0
    const markup = renderToStaticMarkup(
      <ModalFormFooter submitLabel="Save" submitDisabled={false} submitWidthClassName="w-32" onCancel={() => {}} />,
    )

    expect(markup).toContain('>Save</button>')
    expect(markup).toContain('w-32')
    expect(markup).not.toContain('--fit-width')
  })

  it('leaves a footer that does not ask to fade its label changes snapping between labels, as it always did', () => {
    const keyFor = (submitLabel: string) => {
      swapKeys.length = 0
      renderToStaticMarkup(
        <ModalFormFooter
          submitLabel={submitLabel}
          submitDisabled={false}
          submitWidthClassName="w-32"
          onCancel={() => {}}
        />,
      )
      return swapKeys[0]
    }

    expect(keyFor('Save')).toBe(keyFor('Create'))
  })

  it('lets the buttons give way to a long error unless the form asks to hold their width', () => {
    const buttonTags = (holdsButtonWidth?: boolean) =>
      renderToStaticMarkup(
        <ModalFormFooter
          submitLabel="Save"
          submitDisabled={false}
          submitWidthClassName="w-32"
          error="Something went wrong"
          holdsButtonWidth={holdsButtonWidth}
          onCancel={() => {}}
        />,
      ).match(/<button[^>]*>/g)

    expect(buttonTags()).toHaveLength(2)
    expect(buttonTags()?.some((tag) => tag.includes('shrink-0'))).toBe(false)
    expect(buttonTags(true)?.every((tag) => tag.includes('shrink-0'))).toBe(true)
  })
})
