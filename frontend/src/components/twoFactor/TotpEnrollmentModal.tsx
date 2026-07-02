import { TotpEnrollment } from '@/components/twoFactor/TotpEnrollment';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';
import type { TotpSetupResponse } from '@/api/twoFactor/types';

interface TotpEnrollmentModalProps {
  open: boolean;
  onClose: () => void;
  /** Secret already minted after the enable step-up ran, so enrolment does not mint its own */
  initialSetup?: TotpSetupResponse;
}

/**
 * Hosts the enrolment flow in a modal for turning two-factor on from settings, closing once the
 * user acknowledges their recovery codes. The enable step-up ran and minted the secret before this
 * opened, so a wrong current factor was refused at its own prompt
 */
export function TotpEnrollmentModal({ open, onClose, initialSetup }: TotpEnrollmentModalProps) {
  return (
    <TwoFactorModalShell open={open} onClose={onClose}>
      <TotpEnrollment onComplete={onClose} initialSetup={initialSetup} />
    </TwoFactorModalShell>
  );
}
