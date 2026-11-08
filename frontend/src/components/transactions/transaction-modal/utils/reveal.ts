/**
 * Scrolls a line to the middle of the form once it has opened, if anything hides part of it, such
 * as the modal's footer under an action at the foot of a short screen. Focus stays where it is
 */
export function revealIfHidden(line: HTMLElement | null, prefersReducedMotion: boolean) {
  if (!line) return
  const box = line.getBoundingClientRect()
  const shown = [box.top + 1, box.bottom - 1].every((y) => line.contains(document.elementFromPoint(box.left + 1, y)))
  if (!shown) line.scrollIntoView({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' })
}
