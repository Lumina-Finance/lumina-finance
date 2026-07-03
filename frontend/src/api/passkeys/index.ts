export type { Passkey, PasskeyConfig, RegisterPasskeyPayload, RegisterPasskeyResult } from '@/api/passkeys/types';

export {
  authenticatePasskey,
  confirmPasskeyRegistration,
  fetchPasskeyAuthenticationOptions,
  fetchPasskeyConfig,
  fetchPasskeyMfaOptions,
  fetchPasskeyRegistrationOptions,
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  renamePasskey,
  verifyPasskeyMfa,
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
} from '@/api/passkeys/hooks';
