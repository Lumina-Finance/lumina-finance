import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser'
import { getPasskeyRegistrationMessage, getPasskeySignInMessage, isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors'

/**
 * Runs one passkey prompt for a native app and returns what the app reads back from the page's
 * address: the credential, or the message the web would show for the failure and whether the user
 * dismissed the prompt
 */
export async function runNativePasskeyCeremony(ceremony: string | null, options: string | null): Promise<Record<string, string>> {
  const failureMessage = ceremony === 'create' ? getPasskeyRegistrationMessage : getPasskeySignInMessage
  let optionsJSON
  try {
    optionsJSON = JSON.parse(options ?? '')
  } catch {
    return { error: failureMessage(undefined) }
  }

  try {
    const credential = ceremony === 'create'
      ? await startRegistration({ optionsJSON })
      : await startAuthentication({ optionsJSON })
    return { credential: JSON.stringify(credential) }
  } catch (error) {
    return { error: failureMessage(error), ...(isDismissed(error) ? { cancelled: 'true' } : {}) }
  }
}

/**
 * Safari reports a prompt the user closed as declined rather than aborted, and in the app's sheet
 * closing it means going back, so the app treats both as a dismissal and leaves its screen as it was
 */
function isDismissed(error: unknown): boolean {
  return isPasskeyCeremonyCancelled(error)
    || (error instanceof WebAuthnError && error.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY')
}
