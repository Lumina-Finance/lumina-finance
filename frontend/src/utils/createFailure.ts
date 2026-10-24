import { ApiError } from '@/api/auth'

type CreatedKind = 'account' | 'transaction'

type TransferLegFailure = {
  // What the leg was creating, such as "an expense transfer in Chequing"
  description: string
  reason: unknown
}

/** What a failed pair of transfer legs shows, with a title only when the user must add a leg by hand */
type TransferFailureNotice = { title: string; message: string }

const GENERIC_CREATE_FAILURE = 'Something went wrong. Please try again.'

function isTimeout(error: unknown) {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

/**
 * Reads what a failed create shows the user
 *
 * A create that timed out may still have been saved, since the server can finish after the browser
 * stops waiting, so its message sends the user to check before trying again rather than implying it failed
 */
export function getCreateFailureMessage(error: unknown, kind: CreatedKind) {
  if (isTimeout(error)) {
    return `The server took too long to answer. It may have been saved, so check your ${kind}s before trying again.`
  }
  return error instanceof ApiError ? error.message : GENERIC_CREATE_FAILURE
}

/**
 * Reads what a pair of transfer legs that failed shows the user
 *
 * When every leg failed, any one that timed out decides the message, since that one may have been
 * saved whatever the others say. When one failed and the other saved, a timeout sends the user to check
 * rather than to add the leg by hand, which would duplicate it if it was saved
 */
export function getTransferFailureNotice(failures: TransferLegFailure[], legCount: number): TransferFailureNotice {
  if (failures.length === legCount) {
    const reasons = failures.map((failure) => failure.reason)
    return { title: '', message: getCreateFailureMessage(reasons.find(isTimeout) ?? reasons[0], 'transaction') }
  }

  const [failure] = failures
  if (isTimeout(failure.reason)) return { title: '', message: getCreateFailureMessage(failure.reason, 'transaction') }
  return {
    title: 'One of the pair of transactions failed.',
    message: `There was a problem creating ${failure.description}. Please add that leg manually.`,
  }
}
