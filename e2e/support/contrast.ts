import type { Locator } from '@playwright/test'

export type FaintestText = { text: string; contrast: number }

/**
 * Finds the faintest visible text inside an element, itself included, and its contrast against what is
 * drawn behind it. Colours are the ones the browser resolved, read through a canvas so mixes and alpha
 * come out as plain channels, and the backdrop is every background painted under the text, from the page
 * up, laid over one another. Any fade on the text or around it mixes the text into that backdrop, so the
 * ratio is the one on screen, read once any colour still on its way somewhere has arrived. Text faded out
 * entirely is skipped, since there is nothing there to read, and so is an emoji icon, which paints its own
 * colours
 */
export async function faintestText(element: Locator): Promise<FaintestText> {
  return readContrast(element, false)
}

/**
 * The contrast of an element's own colour against what is drawn behind it, measured as `faintestText`
 * measures text, for a control that draws its colour as an icon rather than words
 */
export async function colourContrast(element: Locator): Promise<number> {
  return (await readContrast(element, true)).contrast
}

async function readContrast(element: Locator, isOwnColour: boolean): Promise<FaintestText> {
  return element.evaluate(async (root, isOwnColour) => {
    // Let every transition and animation that ends run to its end first, so a colour on its way to a state,
    // such as a field turning red, is read where it settles rather than where it started
    const ending = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)))

    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (colour: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = colour
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      return [r, g, b, a / 255]
    }
    const over = (top: number[], bottom: number[], alpha: number) => (
      [0, 1, 2].map((channel) => top[channel] * alpha + bottom[channel] * (1 - alpha))
    )
    const luminance = (colour: number[]) => {
      const [r, g, b] = colour.map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    const measure = (node: Element) => {
      let fade = 1
      for (let box: Element | null = node; box; box = box.parentElement) fade *= Number(getComputedStyle(box).opacity)
      // Text faded out entirely, such as a tooltip waiting for a hover, is not on screen to read
      if (fade < 0.01) return Infinity
      // What is painted under the middle of the text, which takes in a field drawn beside it rather than
      // around it, as the currency symbol inside a money field is. The text is made to take the pointer for
      // the moment, since the browser leaves a click-through element out of the stack it reports, and
      // anything stacked above the text is not behind it
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const box = node.getBoundingClientRect()
      const element = node as HTMLElement
      const pointerEvents = element.style.pointerEvents
      element.style.pointerEvents = 'auto'
      const stack = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      element.style.pointerEvents = pointerEvents
      const depth = stack.indexOf(node)
      if (depth < 0) throw new Error(`"${node.textContent}" is covered or off screen, so what is under it can't be read`)
      const under = stack.slice(depth).filter((layer) => layer === node || !node.contains(layer))
      // The stack leaves out boxes the browser doesn't hit, such as a table row, so each element's own
      // parents up to the next element in the stack are laid in under it
      const painted: Element[] = []
      for (const layer of under) {
        painted.push(layer)
        for (let parent = layer.parentElement; parent && !under.includes(parent); parent = parent.parentElement) {
          if (!painted.includes(parent)) painted.push(parent)
        }
      }
      const layers = painted.map((layer) => rgba(getComputedStyle(layer).backgroundColor))
      let backdrop = rgba(getComputedStyle(document.documentElement).backgroundColor)
      if (backdrop[3] === 0) backdrop = [255, 255, 255, 1]
      for (const layer of layers.reverse()) backdrop = [...over(layer, backdrop, layer[3]), 1]
      const text = rgba(getComputedStyle(node).color)
      const onScreen = over(text, backdrop, text[3] * fade)
      const [lighter, darker] = [luminance(onScreen), luminance(backdrop)].sort((a, b) => b - a)
      return (lighter + 0.05) / (darker + 0.05)
    }

    if (isOwnColour) return { text: '', contrast: measure(root) }

    let faintest = { text: '', contrast: Infinity }
    for (const node of [root, ...root.querySelectorAll('*')]) {
      const ownText = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent!.trim())
        .join(' ')
        .trim()
      const box = node.getBoundingClientRect()
      if (!ownText || box.width === 0 || box.height === 0 || getComputedStyle(node).visibility === 'hidden') continue
      // An icon drawn as an emoji paints its own colours and carries no words to read
      if (/^\p{Extended_Pictographic}+$/u.test(ownText.replace(/\s|\uFE0F/g, ''))) continue
      const contrast = measure(node)
      if (contrast < faintest.contrast) faintest = { text: ownText, contrast }
    }
    return faintest
  }, isOwnColour)
}
