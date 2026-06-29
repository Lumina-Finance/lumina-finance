export type { Passkey, PasskeyConfig, RegisterPasskeyPayload } from '@/api/passkeys/types';

export {
  fetchPasskeyConfig,
  fetchPasskeyRegistrationOptions,
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  renamePasskey,
} from '@/api/passkeys/requests';

export {
  usePasskeyConfig,
  usePasskeys,
  useRegisterPasskey,
  useRemovePasskey,
  useRenamePasskey,
} from '@/api/passkeys/hooks';
