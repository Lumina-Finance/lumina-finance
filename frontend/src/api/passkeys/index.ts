export type { Passkey, PasskeyConfig, RegisterPasskeyPayload } from '@/api/passkeys/types';

export {
  authenticatePasskey,
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
  usePasskeyConfig,
  usePasskeys,
  useRegisterPasskey,
  useRemovePasskey,
  useRenamePasskey,
} from '@/api/passkeys/hooks';
