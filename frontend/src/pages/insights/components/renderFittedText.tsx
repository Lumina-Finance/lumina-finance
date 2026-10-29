/**
 * Renders a fitted amount's text: the full amount, or its compact form with the full amount left to
 * screen readers
 */
export function renderFittedText(compact: boolean, compactText: string, fullText: string) {
  if (!compact) return fullText
  return (
    <>
      <span aria-hidden="true">{compactText}</span>
      <span className="sr-only">{fullText}</span>
    </>
  )
}
