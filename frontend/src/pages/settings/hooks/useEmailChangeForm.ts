import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ApiError } from '@/api/auth'
import { useRequestEmailChange } from '@/api/user'
import type { StepUpCredentials } from '@/components/two-factor/StepUpModal'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { useProviderReauth } from '@/pages/settings/hooks/useProviderReauth'
import { getEmailChangeSentMessage, isEmailDraftDirty } from '@/pages/settings/utils/emailChange'
import { getEmailAddressError } from '@/utils/emailAddress'

const FALLBACK_ERROR = 'Oops, something went wrong. Please try again.'

/**
 * Owns the Email field's draft, its confirmation request and the confirm-it's-you step before it
 *
 * An account with a password confirms with the step-up dialogue. A passwordless account re-confirms with
 * a linked provider. That leaves the app, so the address rides along and the request is sent on return.
 * The address on the account stays as it was until the emailed link is used, so a sent request only
 * clears the draft and says where the email went
 */
export function useEmailChangeForm({ savedEmail, hasPassword }: { savedEmail: string; hasPassword: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const requestEmailChange = useRequestEmailChange()
  const feedback = useActionFeedback()
  const reauth = useProviderReauth()

  // Null until the field is edited, so the field follows the saved address until then
  const [draft, setDraft] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  // The address a request went to, held until the Save button reaches its success state, so the notice
  // and the button's success appear together rather than the notice showing while Save still spins
  const sentAddressRef = useRef<string | null>(null)
  const [isStepUpOpen, setIsStepUpOpen] = useState(false)

  const value = draft ?? savedEmail
  const address = value.trim()
  const isDirty = isEmailDraftDirty(draft, savedEmail)
  const formatError = isDirty && touched ? getEmailAddressError(address) : undefined
  const canConfirm = hasPassword || reauth.linkedProviders.length > 0
  const isPending = feedback.isPending || requestEmailChange.isPending || reauth.busySlug !== null
  const canSave = isDirty && !isPending && !getEmailAddressError(address) && canConfirm

  // Mutate through a stable reference so the resume effect below does not rerun with the mutation's state
  const { mutateAsync: sendRequest } = requestEmailChange
  const { run: runWithFeedback, status: feedbackStatus } = feedback

  useEffect(() => {
    if (feedbackStatus !== 'success' || sentAddressRef.current === null) return
    setSentTo(sentAddressRef.current)
    sentAddressRef.current = null
  }, [feedbackStatus])

  // A passwordless reauth returns here with the address, then clears the state so a reload does not send
  // it again
  const resumeRef = useRef(false)
  useEffect(() => {
    if (resumeRef.current) return
    const resumeAddress = (location.state as { resumeChangeEmail?: unknown } | null)?.resumeChangeEmail
    if (typeof resumeAddress !== 'string') return
    resumeRef.current = true
    navigate(location.pathname, { replace: true, state: null })

    runWithFeedback(async () => {
      await sendRequest({ new_email: resumeAddress })
      setDraft(null)
      sentAddressRef.current = resumeAddress
    }).catch((error: Error) => {
      // The field shows the address that was refused, so the reason sits beside what it is about
      setDraft(resumeAddress)
      setTouched(true)
      setRequestError(error.message || FALLBACK_ERROR)
    })
  }, [location.state, location.pathname, navigate, runWithFeedback, sendRequest])

  /**
   * Applies an edit to the Email field, clearing the last request's reason and sent notice
   */
  function setEmail(next: string) {
    setDraft(next)
    setRequestError(null)
    setSentTo(null)
    sentAddressRef.current = null
  }

  /**
   * Marks the field as visited, so a badly formed address shows its problem once the user leaves it
   */
  function touch() {
    setTouched(true)
  }

  /**
   * Starts the change with the account's way of confirming it's the user: the step-up dialogue, or a
   * provider reauth for an account with no password
   */
  function save() {
    if (!canSave) return
    setRequestError(null)
    if (hasPassword) {
      setIsStepUpOpen(true)
    } else {
      reauth.start({ kind: 'change-email', email: address })
    }
  }

  /**
   * Sends the request with the credentials from the step-up dialogue
   *
   * A refusal of the address itself, such as the account's current one, closes the dialogue and lands on
   * the field. A failed step-up stays in the dialogue, where the user sees it and can retry
   */
  async function verifyStepUp(credentials: StepUpCredentials) {
    try {
      await feedback.run(async () => {
        await sendRequest({ new_email: address, step_up: credentials })
        setDraft(null)
        sentAddressRef.current = address
        setIsStepUpOpen(false)
      })
    } catch (error) {
      requestEmailChange.reset()
      if (error instanceof ApiError && error.status === 422) {
        setIsStepUpOpen(false)
        setTouched(true)
        setRequestError(error.message)
        return
      }
      throw error
    }
  }

  /**
   * Dismisses the step-up dialogue without sending anything
   */
  function closeStepUp() {
    setIsStepUpOpen(false)
  }

  /**
   * Puts the field back to the saved address and forgets the last request's reason
   */
  function discard() {
    setDraft(null)
    setTouched(false)
    setRequestError(null)
  }

  return {
    value,
    draft: address,
    error: requestError ?? formatError ?? null,
    sentMessage: sentTo === null ? null : getEmailChangeSentMessage(sentTo),
    isDirty,
    isPending,
    canSave,
    canConfirm,
    setEmail,
    touch,
    save,
    discard,
    status: reauth.busySlug !== null ? ('loading' as const) : feedback.status,
    stepUp: { isOpen: isStepUpOpen, verify: verifyStepUp, close: closeStepUp },
    reauth,
  }
}
