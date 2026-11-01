import { WarningCallout } from '@/components/WarningCallout'
import { copyText } from '@/utils/clipboard'
import { saveBlobAsFile } from '@/utils/downloadFile'
import { formatList } from '@/utils/formatList'

const RECOVERY_CODES_FILENAME = 'lumina-recovery-codes.txt'

/** The factors these codes stand in for, which the lockout warning names */
export type RecoveryFactors = {
  authenticator: boolean
  passkeys: number
}

type RecoveryCodesPanelProps = {
  codes: string[]
  factors: RecoveryFactors
}

/**
 * Words the lockout warning for the factors the codes cover, so it never names one the user doesn't have
 */
function lockoutWarning({ authenticator, passkeys }: RecoveryFactors): string {
  const names = [
    ...(authenticator ? ['your authenticator app'] : []),
    ...(passkeys === 1 ? ['your passkey'] : passkeys > 1 ? ['your passkeys'] : []),
  ]
  const lost = `${names.length === 1 ? 'both ' : ''}${formatList([...names, 'these recovery codes'])}`
  return `If you lose access to ${lost}, you may be permanently locked out of your account.`
}

/**
 * Lists the one-time recovery codes with copy and download actions, shared by enrolment and regeneration
 */
export function RecoveryCodesPanel({ codes, factors }: RecoveryCodesPanelProps) {
  /**
   * Copies the recovery codes to the clipboard as newline-separated text
   */
  const copyCodes = () => {
    void copyText(codes.join('\n'))
  }

  /**
   * Downloads the recovery codes as a text file
   */
  const downloadCodes = () => {
    saveBlobAsFile(new Blob([codes.join('\n')], { type: 'text/plain' }), RECOVERY_CODES_FILENAME)
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1 rounded-lg p-4 font-mono text-sm" style={{ backgroundColor: 'var(--app-surface-soft)' }}>
        {codes.map((recoveryCode) => (
          <li key={recoveryCode}>{recoveryCode}</li>
        ))}
      </ul>

      <div className="flex gap-2">
        <button type="button" onClick={copyCodes} className="app-secondary-button flex-1">
          Copy
        </button>
        <button type="button" onClick={downloadCodes} className="app-secondary-button flex-1">
          Download
        </button>
      </div>

      <WarningCallout>{lockoutWarning(factors)}</WarningCallout>
    </div>
  )
}
