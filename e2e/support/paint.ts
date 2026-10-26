import type { Locator } from '@playwright/test'

export type Rgb = [number, number, number]

/**
 * The colour on screen at an element's box once its transitions have ended: every background from the
 * page down to the element, laid over one another, so a translucent fill counts as the colour it makes
 *
 * @param element - Element to read
 * @returns Its red, green and blue channels
 */
export async function shownFill(element: Locator): Promise<Rgb> {
  return element.evaluate(async (node) => {
    const ending = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)))

    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const read = (colour: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = colour
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      return [red, green, blue, alpha / 255]
    }

    const layers: Element[] = []
    for (let layer: Element | null = node; layer; layer = layer.parentElement) layers.push(layer)
    let shown = [255, 255, 255]
    for (const layer of layers.reverse()) {
      const [red, green, blue, alpha] = read(getComputedStyle(layer).backgroundColor)
      shown = [red, green, blue].map((channel, index) => channel * alpha + shown[index] * (1 - alpha))
    }
    return shown as Rgb
  })
}

/** The WCAG contrast ratio between two opaque colours */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const luminance = (colour: Rgb) => {
    const [red, green, blue] = colour.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}
