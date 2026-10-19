import { useEffect } from 'react'

// What a click can land on inside a label that carries an action of its own, such as a help button
const OWN_ACTION_SELECTOR = 'a[href], button, input, select, textarea, summary, [tabindex]'

/**
 * Brings the button a clicked label names into focus without pressing it
 *
 * A label presses the control it names. That suits a checkbox, but a dropdown or a picker whose head
 * is a button would open, when a label should only move focus there as it does for a text field. A
 * click on a help button or another control inside the label keeps its own action, and a disabled
 * button takes no focus, as it would natively. The focus ring is asked for explicitly, since a browser
 * otherwise leaves it off a button focused after a mouse click and the move would go unseen
 */
function focusLabelledButton(event: MouseEvent) {
  if (!(event.target instanceof Element)) return

  const label = event.target.closest('label')
  const control = label?.control
  if (!label || !(control instanceof HTMLButtonElement)) return

  const ownAction = event.target.closest(OWN_ACTION_SELECTOR)
  if (ownAction && label.contains(ownAction)) return

  event.preventDefault()
  control.focus({ focusVisible: true })
}

/**
 * Keeps every label in the app from pressing the button it names, for as long as the app is mounted
 *
 * It listens as the click travels down rather than back up, since a modal stops clicks inside it
 * from reaching the document on the way up
 */
export function useLabelFocus() {
  useEffect(() => {
    document.addEventListener('click', focusLabelledButton, true)
    return () => document.removeEventListener('click', focusLabelledButton, true)
  }, [])
}
