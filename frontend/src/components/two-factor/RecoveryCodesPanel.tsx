import { WarningCallout } from '@/components/two-factor/WarningCallout';
import { copyText } from '@/utils/clipboard';

const RECOVERY_CODES_FILENAME = 'lumina-recovery-codes.txt';

interface RecoveryCodesPanelProps {
  codes: string[];
}

/**
 * Lists the one-time recovery codes with copy and download actions, shared by enrolment and regeneration
 */
export function RecoveryCodesPanel({ codes }: RecoveryCodesPanelProps) {
  /**
   * Copies the recovery codes to the clipboard as newline-separated text
   */
  const copyCodes = () => {
    void copyText(codes.join('\n'));
  };

  /**
   * Downloads the recovery codes as a text file
   */
  const downloadCodes = () => {
    const url = URL.createObjectURL(new Blob([codes.join('\n')], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = RECOVERY_CODES_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <ul
        className="space-y-1 rounded-lg p-4 font-mono text-sm"
        style={{ backgroundColor: 'var(--app-surface-soft)' }}
      >
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

      <WarningCallout>
        If you lose access to both your authenticator app and these recovery codes, you may be permanently
        locked out of your account.
      </WarningCallout>
    </div>
  );
}
