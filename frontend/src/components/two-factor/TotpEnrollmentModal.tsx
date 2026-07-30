import { TotpEnrollment, TOTP_ENROLLMENT_TITLE_ID } from '@/components/two-factor/TotpEnrollment';
import { ModalContentPanel } from '@/components/modal/ContentPanel';
import type { ModalLevel } from '@/components/modal/Shell';
import type { TotpSetupResponse } from '@/api/two-factor';

interface TotpEnrollmentModalProps {
  open: boolean;
  onClose: () => void;
  /** Secret already minted after the enable step-up ran, so enrolment does not mint its own */
  initialSetup?: TotpSetupResponse;
  /** Set to stacked where this opens over the multi-factor modal rather than straight from a page */
  level?: ModalLevel;
}

/**
 * Hosts the enrolment flow in a modal for turning two-factor on from settings, closing once the
 * user acknowledges their recovery codes. The enable step-up ran and minted the secret before this
 * opened, so a wrong current factor was refused at its own prompt
 */
export function TotpEnrollmentModal({ open, onClose, initialSetup, level = 'page' }: TotpEnrollmentModalProps) {
  return (
    <ModalContentPanel open={open} onClose={onClose} titleId={TOTP_ENROLLMENT_TITLE_ID} level={level}>
      <TotpEnrollment onComplete={onClose} initialSetup={initialSetup} />
    </ModalContentPanel>
  );
}
