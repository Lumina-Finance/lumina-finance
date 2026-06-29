export type { Passkey, PasskeyConfig, RegisterPasskeyPayload, RegisterPasskeyResult } from '@/api/passkeys/types';

export {
  authenticatePasskey,
  confirmPasskeyRegistration,
  fetchPasskeyAuthenticationOptions,
  fetchPasskeyConfig,
  fetchPasskeyRegistrationOptions,
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  renamePasskey,
} from '@/api/passkeys/requests';

export {
  useAuthenticatePasskey,
  useConfirmPasskeyRegistration,
  usePasskeyConfig,
  usePasskeys,
  useRegisterPasskey,
  useRemovePasskey,
  useRenamePasskey,
} from '@/api/passkeys/hooks';
