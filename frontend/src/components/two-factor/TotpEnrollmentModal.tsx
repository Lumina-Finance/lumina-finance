import { TotpEnrollment, TOTP_ENROLLMENT_TITLE_ID } from '@/components/two-factor/TotpEnrollment';
import { ModalContentPanel } from '@/components/modal/ContentPanel';
import type { TotpSetupResponse } from '@/api/two-factor';

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
    <ModalContentPanel open={open} onClose={onClose} titleId={TOTP_ENROLLMENT_TITLE_ID}>
      <TotpEnrollment onComplete={onClose} initialSetup={initialSetup} />
    </ModalContentPanel>
  );
}
