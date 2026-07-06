export type { Passkey, PasskeyConfig, RegisterPasskeyPayload, RegisterPasskeyResult } from '@/api/passkeys/types';

export {
  authenticatePasskey,
  confirmPasskeyRegistration,
  fetchPasskeyAuthenticationOptions,
  fetchPasskeyConfig,
  fetchPasskeyMfaOptions,
  fetchPasskeyRegistrationOptions,
  fetchPasskeyResetOptions,
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  renamePasskey,
  verifyPasskeyMfa,
  verifyPasskeyReset,
} from '@/api/passkeys/requests';

export {
  useAuthenticatePasskey,
  useConfirmPasskeyRegistration,
  usePasskeyConfig,
  usePasskeys,
  useRegisterPasskey,
  useRemovePasskey,
  useRenamePasskey,
  useVerifyPasskeyMfa,
  useVerifyPasskeyReset,
} from '@/api/passkeys/hooks';
