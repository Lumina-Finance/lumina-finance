import { useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { animate } from 'motion/react'
import type { AuthResponse, MfaRequiredResponse } from '@/api/auth'
import { useVerifyPasskeyMfa } from '@/api/passkeys'
import { OTP_LENGTH } from '@/components/OtpInput'
import { useAuth } from '@/hooks/useAuth'
import { getPasskeySignInMessage, isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors'
import { delayToMinimum } from '@/utils/timing'
import { FADE_OUT_MS, getAuthErrorMessage } from '@/pages/auth/utils/authForm'

interface UseMfaChallengeParams {
  containerRef: RefObject<HTMLDivElement | null>

  // Read once by the page on mount, so a challenge opened after a lost-factor sign-out steers
  // straight to the recovery-code input
  recoveryMode: boolean
  setError: (message: string) => void
}

/**
 * Coordinates the second-factor challenge step of login: the passkey, authenticator-code, and
 * recovery-code paths, and the switches between them
 */
export function useMfaChallenge({ containerRef, recoveryMode, setError }: UseMfaChallengeParams) {
  const { verifyMfa, setSession } = useAuth()
  const passkeyMfa = useVerifyPasskeyMfa()
  const navigate = useNavigate()
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaUseRecoveryCode, setMfaUseRecoveryCode] = useState(false)
  const [mfaRecoveryOnly, setMfaRecoveryOnly] = useState(false)
  const [mfaTotpEnabled, setMfaTotpEnabled] = useState(false)
  const [mfaPasskeyAvailable, setMfaPasskeyAvailable] = useState(false)
  const [mfaUsePasskey, setMfaUsePasskey] = useState(false)
  const [mfaSubmitting, setMfaSubmitting] = useState(false)

  const mfaActive = mfaToken !== null

  /**
   * Opens the challenge from a login response, preferring the passkey when one is available and
   * dropping straight to the recovery-code input when recovery mode was requested or no usable
   * factor remains
   */
  const beginChallenge = (result: MfaRequiredResponse) => {
    setMfaToken(result.mfa_token)
    setMfaTotpEnabled(result.totp_enabled)
    setMfaPasskeyAvailable(result.passkey_available)
    setMfaUsePasskey(result.passkey_available)
    setMfaRecoveryOnly(result.recovery_only)
    setMfaUseRecoveryCode(result.recovery_only)

    // A user who signed out to recover a lost factor lands on the recovery-code input directly,
    // though the other factor prompts stay available in case they still have one
    if (recoveryMode) {
      setMfaUsePasskey(false)
      setMfaUseRecoveryCode(true)
    }
  }

  /**
   * Clears every second-factor field, returning the form to the password step
   */
  const resetMfaState = () => {
    setMfaToken(null)
    setMfaCode('')
    setMfaUseRecoveryCode(false)
    setMfaRecoveryOnly(false)
    setMfaUsePasskey(false)
    setMfaTotpEnabled(false)
    setMfaPasskeyAvailable(false)
  }

  /**
   * Exchanges the entered code for a session, returning to the login form when it is rejected
   */
  const handleMfaSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    // A recovery code is a free-form string while an authenticator code is a fixed-length number
    const code = mfaUseRecoveryCode ? mfaCode.trim() : mfaCode
    const codeReady = mfaUseRecoveryCode ? code.length > 0 : code.length >= OTP_LENGTH
    if (!mfaToken || !codeReady) return

    setMfaSubmitting(true)
    const start = Date.now()
    let res: AuthResponse
    try {
      res = await verifyMfa({ mfa_token: mfaToken, code })
    } catch (err) {
      // The challenge is single-use, so a rejected code sends the user back to log in afresh
      await delayToMinimum(start)
      setMfaSubmitting(false)
      resetMfaState()
      setError(getAuthErrorMessage(err))
      return
    }

    await delayToMinimum(start)
    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    setSession(res)
    navigate('/', { replace: true })
  }

  /**
   * Verifies the second factor with a passkey, committing the session when it succeeds
   *
   * A cancelled prompt leaves the challenge unspent so the user can retry or switch to a code, while a
   * rejected assertion spends it and drops back to the login form
   */
  const handlePasskeyMfa = async () => {
    if (!mfaToken) return

    setError('')
    let res: AuthResponse
    try {
      res = await passkeyMfa.mutateAsync(mfaToken)
    } catch (err) {
      if (isPasskeyCeremonyCancelled(err)) return
      resetMfaState()
      setError(getPasskeySignInMessage(err))
      return
    }

    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    setSession(res)
    navigate('/', { replace: true })
  }

  /**
   * Abandons the second-factor step and returns to the login form
   */
  const cancelMfa = () => {
    resetMfaState()
    setError('')
  }

  /**
   * Switches the second-factor step from the passkey to the authenticator code input
   */
  const switchToAuthenticatorMfa = () => {
    setMfaUsePasskey(false)
    setMfaUseRecoveryCode(false)
    setMfaCode('')
    setError('')
  }

  /**
   * Switches the second-factor step to a recovery code
   */
  const switchToRecoveryMfa = () => {
    setMfaUsePasskey(false)
    setMfaUseRecoveryCode(true)
    setMfaCode('')
    setError('')
  }

  /**
   * Switches the second-factor step back to the passkey prompt
   */
  const switchToPasskeyMfa = () => {
    setMfaUsePasskey(true)
    setMfaCode('')
    setError('')
  }

  /**
   * Switches the second-factor input between an authenticator code and a recovery code
   */
  const toggleMfaRecoveryCode = () => {
    setMfaUseRecoveryCode((current) => !current)
    setMfaCode('')
    setError('')
  }

  return {
    mfaActive,
    mfaCode,
    setMfaCode,
    mfaUseRecoveryCode,
    toggleMfaRecoveryCode,
    mfaRecoveryOnly,
    mfaSubmitting,
    handleMfaSubmit,
    cancelMfa,
    mfaUsePasskey,
    mfaPasskeyAvailable,
    mfaTotpEnabled,
    handlePasskeyMfa,
    passkeyMfaSubmitting: passkeyMfa.isPending,
    switchToAuthenticatorMfa,
    switchToRecoveryMfa,
    switchToPasskeyMfa,
    beginChallenge,
  }
}
