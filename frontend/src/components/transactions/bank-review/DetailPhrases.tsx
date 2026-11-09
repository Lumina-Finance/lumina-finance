import { Fragment } from 'react'

/**
 * Renders the line under a bank row's description as its phrases joined by middle dots
 *
 * Each phrase is kept whole with its trailing dot, so a narrow row wraps between phrases rather than
 * leaving one word of a phrase alone on the next line. A phrase wider than the row still wraps inside
 * itself
 *
 * @param phrases - The phrases in order, where an empty one is left out
 */
export function DetailPhrases({ phrases }: { phrases: (string | false | null | undefined)[] }) {
  const shown = phrases.filter((phrase): phrase is string => Boolean(phrase))
  return shown.map((phrase, index) => (
    // Two phrases can read the same, such as an account named Pending, so the place keys each
    <Fragment key={index}>
      {index > 0 && ' '}
      <span className="inline-block max-w-full">{index < shown.length - 1 ? `${phrase} ·` : phrase}</span>
    </Fragment>
  ))
}
