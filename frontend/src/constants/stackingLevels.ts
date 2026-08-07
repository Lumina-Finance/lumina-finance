/**
 * Every stacking level in the app that can reach the top of the page, in one ordered list, so an
 * overlay is placed by naming what it is rather than by copying a number out of a nearby file.
 *
 * A level belongs here when the element is portalled into the body, or is fixed with nothing above
 * it that establishes a stacking context. Anything ordering siblings inside a card, a table, a
 * sticky header or a segmented control keeps a plain Tailwind class instead, because its number
 * only ever competes with the other children of that container.
 *
 * Two containers scope whatever is opened inside them, so a level here does not reach past either:
 * a modal, whose backdrop is fixed and carries its own level, and the mobile filter sheet, which is
 * fixed at the sheet level. Page content is a stacking context too, through the isolation on
 * app-page-content, which is what keeps the numbers below meaningful against everything in a page.
 *
 * Markup reads these as Tailwind classes, z-modal and the rest, generated from this object by
 * toTailwindZIndexTheme in tailwind.config.js. Anything computing a style object or writing to an
 * element reads the number directly.
 */
export const STACKING_LEVELS = {
  /** An overlay covering the page content area while leaving the navigation visible */
  pageOverlay: 30,

  /** The desktop sidebar and the mobile navigation panel */
  navigation: 40,

  /** The button that opens the mobile navigation, which has to stay reachable over the panel */
  navigationToggle: 50,

  /** The full-screen loading screen, over the navigation and its button alike */
  loadingScreen: 55,

  /** A route that covers the whole viewport instead of sitting beside the navigation */
  focusedPage: 60,

  /** A dialog opened from a page */
  modal: 65,

  /** The transient save confirmation on the tax-advantaged category dialog */
  notice: 70,

  /** A small action menu portalled out of the row that owns it, so it is never clipped */
  menu: 80,

  /** The full-screen filter sheet on a phone */
  sheet: 90,

  /**
   * A dialog opened from another dialog. Above every full-screen cover, since a dialog reached from
   * inside one is the thing being answered
   */
  stackedModal: 100,

  /**
   * A layer opened from a control and positioned against it: the calendar, an open drop-down, the
   * category icon picker. Above every dialog, because one opened inside a dialog is portalled beside
   * it rather than into its panel, and at an equal level document order would decide
   */
  popover: 110,

  /**
   * A toast, above any popover, so a message that arrives while a drop-down happens to be open is
   * not hidden behind the list
   */
  toast: 115,

  /**
   * A tooltip following the pointer, above everything. A chart's tooltip inside a dialog is
   * portalled beside the dialog, so anything less left it painting underneath the panel it describes
   */
  tooltip: 120,
} as const

export type StackingLevel = keyof typeof STACKING_LEVELS

/**
 * The scale as Tailwind zIndex theme entries, so `popover` generates `z-popover`.
 *
 * The keys are kebab-cased here rather than left to Tailwind. Its compatibility layer for a
 * JavaScript config kebab-cases only the first segment of a key path, so `navigationToggle` would
 * otherwise reach the stylesheet as `z-navigationToggle` while the markup asks for
 * `z-navigation-toggle`, and a Tailwind class that matches nothing fails silently.
 */
export function toTailwindZIndexTheme(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(STACKING_LEVELS).map(([level, value]) => [
      level.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      String(value),
    ]),
  )
}
