export type {
  ConfirmTotpPayload,
  RecoveryCodesResponse,
  TotpSetupResponse,
} from '@/api/twoFactor/types';

export {
  confirmTotp,
  setupTotp,
} from '@/api/twoFactor/requests';

export {
  useConfirmTotp,
  useSetupTotp,
} from '@/api/twoFactor/hooks';
