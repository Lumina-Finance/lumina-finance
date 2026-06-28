import { TotpEnrollment } from '@/components/twoFactor/TotpEnrollment';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';

interface TotpEnrollmentModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Hosts the enrolment flow in a modal for turning two-factor on from settings, closing once the
 * user acknowledges their recovery codes
 */
export function TotpEnrollmentModal({ open, onClose }: TotpEnrollmentModalProps) {
  return (
    <TwoFactorModalShell open={open} onClose={onClose}>
      <TotpEnrollment onComplete={onClose} />
    </TwoFactorModalShell>
  );
}
