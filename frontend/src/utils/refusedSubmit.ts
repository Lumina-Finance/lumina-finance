/** What is wrong with a dialog's fields, by field. A field with nothing wrong has no entry */
export type FieldProblems<F extends string> = Partial<Record<F, string>>

export type FirstProblem<F extends string> = { field: F; message: string }

/**
 * The first problem in the order the dialog shows its fields, which is the one a refused press brings
 * into view and the one the button's reason states
 *
 * @param problems - Every problem the form has right now
 * @param order - The fields in the order the dialog draws them
 */
export function getFirstProblem<F extends string>(
  problems: FieldProblems<F>,
  order: readonly F[],
): FirstProblem<F> | null {
  for (const field of order) {
    const message = problems[field]
    if (message) return { field, message }
  }
  return null
}

/**
 * The problems a dialog draws. A refused press marks every field that has one, and until then only the
 * fields the person has already left are marked, so a form never shouts about what they have yet to reach
 *
 * @param problems - Every problem the form has right now
 * @param refused - Whether the action button was pressed while the form had a problem
 * @param touched - The fields the person has left
 */
export function getShownProblems<F extends string>(
  problems: FieldProblems<F>,
  refused: boolean,
  touched: ReadonlySet<F>,
): FieldProblems<F> {
  if (refused) return problems

  const shown: FieldProblems<F> = {}
  for (const field of touched) {
    const message = problems[field]
    if (message) shown[field] = message
  }
  return shown
}
