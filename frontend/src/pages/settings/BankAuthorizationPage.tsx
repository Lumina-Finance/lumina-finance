import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router'
import { AnimatePresence } from 'motion/react'
import { useFinishBankAuthorization } from '@/api/bank-sync'
import { returnToBankLink } from '@/components/bank-link-flow/bankConnectionsRequest'
import { BANK_CONNECTIONS_SETTINGS_PATH } from '@/components/bank-link-flow/constants'
import LoadingScreen from '@/components/loading/Screen'
import { useToast } from '@/hooks/useToast'
import {
  authorizationReturnTarget,
  describeAuthorizationFailure,
  describeAuthorizationReturn,
  INCOMPLETE_AUTHORIZATION_RETURN,
  readAuthorizationReturn,
} from '@/utils/bankSync'

/**
 * Where the user lands after signing in at their bank. It hands the bank's answer to the server, and the
 * server saves the connection. The page then returns to the account's link flow that started the sign-in,
 * or to Bank connections in Settings
 *
 * The sign-in is single use on the server, so the answer is sent once however many times the page mounts.
 * Only a return the server cannot finish, a sign-in it no longer knows or a lost answer, stays on this
 * page with a message, since it is over and starts again from Bank connections
 */
const BankAuthorizationPage = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const finish = useFinishBankAuthorization()
  const [failure, setFailure] = useState<string | null>(null)

  // The strict-mode double effect would otherwise spend the sign-in twice
  const startedRef = useRef(false)

  const returned = readAuthorizationReturn(searchParams)
  const message = failure ?? (returned ? null : INCOMPLETE_AUTHORIZATION_RETURN)

  useEffect(() => {
    if (startedRef.current || !returned) return
    startedRef.current = true

    finish.mutate(returned, {
      onSuccess: (result) => {
        const outcome = describeAuthorizationReturn(result)
        const target = authorizationReturnTarget(result)

        // Whatever the bank answered, the user goes back to where the sign-in started, with the message
        // as a toast: a bank that did not approve access is told so there and nothing was added. Every
        // way out replaces this page's history entry, since going Back to it would send the spent answer again
        if ('failure' in outcome) showToast({ status: 'error', text: outcome.failure })
        else showToast({ status: 'success', text: outcome.toast })
        if (target.to === 'link-flow')
          returnToBankLink(navigate, target.accountId, target.connectionId, { replace: true })
        else navigate(BANK_CONNECTIONS_SETTINGS_PATH, { replace: true })
      },
      onError: (cause) => setFailure(describeAuthorizationFailure(cause)),
    })
  }, [returned, finish, showToast, navigate])

  return (
    <div className="mx-auto w-full max-w-md pt-[10dvh]">
      {/* The bank's return is a fresh load, so this takes over from the app's own loading screen. It
          covers the whole window as that one does and as the sign-in callback page's does, so the
          spinner stays where it was and only the words change. It shows at full strength at once, over
          the app's loader as that one fades out, since fading in under it would show both messages
          on top of each other partway. It goes out at the body: inside the page, the transform on the
          page wrapper while it enters would place the fixed loader against the wrapper rather than the
          viewport, so it would start near the top and jump to the centre */}
      {createPortal(
        <AnimatePresence initial={false}>
          {!message && <LoadingScreen message="Finishing your bank sign-in" />}
        </AnimatePresence>,
        document.body,
      )}

      {message && (
        <div role="alert">
          <h1 className="font-serif text-3xl font-normal tracking-tight">Bank sign-in not finished</h1>
          <p className="mt-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {message}
          </p>
          <p className="mt-5 text-center text-sm">
            <button
              type="button"
              onClick={() => navigate(BANK_CONNECTIONS_SETTINGS_PATH, { replace: true })}
              className="app-inline-link font-medium underline underline-offset-2 transition-control"
              style={{ color: 'var(--app-accent)' }}
            >
              Back to bank connections
            </button>
          </p>
        </div>
      )}
    </div>
  )
}

export default BankAuthorizationPage
