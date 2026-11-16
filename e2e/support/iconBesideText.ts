import type { Locator } from '@playwright/test'

/** The room the app leaves between text and the drawing of an icon after it */
export const ICON_GAP_PX = 4

/** How far an icon's drawing may sit from where it belongs beside text, less than a pixel's quarter at 2x */
export const ICON_ALIGNMENT_TOLERANCE_PX = 0.15

/**
 * Where an icon's drawing sits against the line of text before it: how far the drawing's middle is
 * from the middle of the text's capitals, positive when lower, and the room between the text's last
 * letter and the drawing
 *
 * Both are measured from what is drawn, never from the boxes around it. The drawing is the icon's
 * shapes widened by half their stroke. The capitals stand the font's cap height on the text's baseline,
 * found by setting the same font beside a block that tall. Glyph sizes a canvas measures are whole
 * pixels in a headless browser, too coarse for this
 *
 * @param icon - An element holding the icon's svg, or the svg itself
 * @param text - The element whose first text is the line before the icon
 */
export async function measureIconBesideText(icon: Locator, text: Locator): Promise<{ offCentre: number; gap: number }> {
  return icon.evaluate((iconElement, textElement) => {
    const svg = iconElement instanceof SVGSVGElement ? iconElement : iconElement.querySelector('svg')!
    const shapes = [...svg.querySelectorAll('path, line, polyline, polygon, circle, ellipse, rect')].map((shape) =>
      shape.getBoundingClientRect(),
    )
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
    const halfStroke = (parseFloat(getComputedStyle(svg).strokeWidth) * scale) / 2
    const drawnTop = Math.min(...shapes.map((box) => box.top)) - halfStroke
    const drawnBottom = Math.max(...shapes.map((box) => box.bottom)) + halfStroke
    const drawnLeft = Math.min(...shapes.map((box) => box.left)) - halfStroke

    const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (/\S/.test(node.textContent ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    })
    const range = document.createRange()
    range.selectNodeContents(walker.nextNode()!)
    const letters = range.getBoundingClientRect()

    // A run of text in the same font and a block a cap high, both on one baseline, give how far the
    // capitals' middle sits below the top of the text's run
    const probe = document.createElement('div')
    probe.style.cssText = `position: absolute; visibility: hidden; white-space: nowrap; font: ${getComputedStyle(textElement).font}`
    const run = document.createElement('span')
    run.textContent = 'H'
    const capitals = document.createElement('span')
    capitals.style.cssText = 'display: inline-block; height: 1cap'
    probe.append(run, capitals)
    document.body.append(probe)
    const capitalsBox = capitals.getBoundingClientRect()
    const capitalsBelowRunTop = capitalsBox.top + capitalsBox.height / 2 - run.getBoundingClientRect().top
    probe.remove()

    return {
      offCentre: (drawnTop + drawnBottom) / 2 - (letters.top + capitalsBelowRunTop),
      gap: drawnLeft - letters.right,
    }
  }, (await text.elementHandle())!)
}
