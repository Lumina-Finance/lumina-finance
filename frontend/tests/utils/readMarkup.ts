/**
 * Reads rendered markup the way a screen reader reads an element a description names. The tests that
 * use it render a component to a string and no stylesheet runs, so a width is stood in for by the
 * Tailwind classes that show or hide an element from it
 */

export type MarkupElement = { attributes: string; children: (MarkupElement | string)[] }

const VOID_TAGS = new Set(['input', 'img', 'br', 'hr'])
const DISPLAY_UTILITIES = new Set(['block', 'inline', 'inline-block', 'inline-flex', 'flex', 'grid', 'contents'])

export function parseMarkup(markup: string): MarkupElement {
  const root: MarkupElement = { attributes: '', children: [] }
  const stack = [root]
  for (const token of markup.replaceAll('<!-- -->', '').matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g)) {
    const [, closing, tag, attributes, text] = token
    const parent = stack[stack.length - 1]
    if (text !== undefined) {
      parent.children.push(text)
    } else if (closing) {
      stack.pop()
    } else {
      const element: MarkupElement = { attributes, children: [] }
      parent.children.push(element)
      if (!attributes.endsWith('/') && !VOID_TAGS.has(tag)) stack.push(element)
    }
  }
  return root
}

export function findById(element: MarkupElement, id: string): MarkupElement | null {
  if (element.attributes.match(/\bid="([^"]*)"/)?.[1] === id) return element
  for (const child of element.children) {
    if (typeof child === 'string') continue
    const found = findById(child, id)
    if (found) return found
  }
  return null
}

/**
 * Whether an element is drawn at a width. A `hidden` class hides it, and a variant class such as
 * `min-[750px]:block` shows it, or `min-[750px]:hidden` hides it again, once the width reaches what
 * `thresholdOf` gives for the variant. It gives null for a variant that stands for something else
 *
 * @param attributes - The element's attribute text, read for `class` and `aria-hidden`
 * @param width - The width tested, in the unit `thresholdOf` answers in
 * @param thresholdOf - The width a variant such as `min-[750px]` starts at
 */
export function isDrawn(attributes: string, width: number, thresholdOf: (variant: string) => number | null): boolean {
  if (attributes.includes('aria-hidden')) return false
  let isHidden = false
  const classes = (attributes.match(/class="([^"]*)"/)?.[1] ?? '').split(' ')
  // The classes without a variant first, then the variants that apply, so a variant wins as in CSS
  for (const withVariants of [false, true]) {
    for (const name of classes) {
      const split = name.lastIndexOf(':')
      const variant = split === -1 ? null : name.slice(0, split)
      const utility = name.slice(split + 1)
      const applies = variant === null ? !withVariants : withVariants && width >= (thresholdOf(variant) ?? Infinity)
      if (!applies) continue
      if (utility === 'hidden') isHidden = true
      else if (DISPLAY_UTILITIES.has(utility)) isHidden = false
    }
  }
  return !isHidden
}

/**
 * What a screen reader reads for an element: its own label where it has one, else the text of the
 * descendants it draws. Like a browser, it leaves out descendants that are hidden, but reads an
 * element a description names directly even if that element is hidden itself
 *
 * @param isDrawnAtWidth - Whether an element's attribute text stands for a drawn element at the width tested
 */
export function readElement(
  element: MarkupElement,
  isDrawnAtWidth: (attributes: string) => boolean,
  isReferenced = false,
): string {
  const label = element.attributes.match(/aria-label="([^"]*)"/)?.[1]
  if (label !== undefined) return label
  if (!isReferenced && !isDrawnAtWidth(element.attributes)) return ''
  return element.children
    .map((child) => (typeof child === 'string' ? child : ` ${readElement(child, isDrawnAtWidth)} `))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
