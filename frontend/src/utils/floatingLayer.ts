// Marks an element portalled out of the surface that opened it, so a surface dismissing on an
// outside press can tell its own floating layers apart from the page behind it
const FLOATING_LAYER_ATTRIBUTE = 'data-floating-layer'

// Spread onto the root of a portalled popover to claim it as a floating layer
export const FLOATING_LAYER_PROPS = { [FLOATING_LAYER_ATTRIBUTE]: '' }

/**
 * Reports whether an event landed inside a floating layer
 *
 * @param target - The node the event was aimed at, which is null for an event with no target
 */
export function isInsideFloatingLayer(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  return Boolean(target.closest(`[${FLOATING_LAYER_ATTRIBUTE}]`))
}

/**
 * Reports whether any floating layer is open, which decides who takes a key that is not aimed at an
 * element, since the topmost layer answers Escape wherever focus happens to sit
 */
export function isFloatingLayerOpen(): boolean {
  return document.querySelector(`[${FLOATING_LAYER_ATTRIBUTE}]`) !== null
}
