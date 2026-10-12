import type { Locator } from '@playwright/test'

export type FaintestText = { text: string; contrast: number }

/**
 * Finds the faintest visible text inside an element, itself included, and its contrast against what is
 * drawn behind it. Colours are the ones the browser resolved, read through a canvas so mixes and alpha
 * come out as plain channels, and the backdrop is every background from the page down to the text laid
 * over one another. Any fade on the text or around it mixes the text into that backdrop, so the ratio is
 * the one on screen. Text faded out entirely, or hidden from assistive technology as decoration such as an
 * emoji icon, is skipped, since there is nothing there to read
 */
export async function faintestText(element: Locator): Promise<FaintestText> {
  return element.evaluate((root) => {
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
      const layers: number[][] = []
      let fade = 1
      for (let box: Element | null = node; box; box = box.parentElement) {
        const style = getComputedStyle(box)
        fade *= Number(style.opacity)
        layers.push(rgba(style.backgroundColor))
      }
      // Text faded out entirely, such as a tooltip waiting for a hover, is not on screen to read
      if (fade < 0.01) return Infinity
      let backdrop = rgba(getComputedStyle(document.documentElement).backgroundColor)
      if (backdrop[3] === 0) backdrop = [255, 255, 255, 1]
      for (const layer of layers.reverse()) backdrop = [...over(layer, backdrop, layer[3]), 1]
      const text = rgba(getComputedStyle(node).color)
      const onScreen = over(text, backdrop, text[3] * fade)
      const [lighter, darker] = [luminance(onScreen), luminance(backdrop)].sort((a, b) => b - a)
      return (lighter + 0.05) / (darker + 0.05)
    }

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
      if (node.closest('[aria-hidden="true"]')) continue
      const contrast = measure(node)
      if (contrast < faintest.contrast) faintest = { text: ownText, contrast }
    }
    return faintest
  })
}
