import { useState } from 'react';
import {
  useConfirmPasskeyRegistration,
  usePasskeyConfig,
  usePasskeys,
  useRegisterPasskey,
  useRemovePasskey,
  useRenamePasskey,
} from '@/api/passkeys';
import { assessPasskeySupport, type PasskeySupport } from '@/utils/passkeySupport';

/**
 * Owns the passkey management state: whether the manage dialog is open, the support assessment for
 * the current origin, the registered passkeys, the add, rename, and remove actions, and the recovery
 * codes shown once when a first passkey is registered
 */
export function usePasskeyManagement() {
  const config = usePasskeyConfig();
  const passkeys = usePasskeys();
  const register = useRegisterPasskey();
  const confirmRegistration = useConfirmPasskeyRegistration();
  const rename = useRenamePasskey();
  const remove = useRemovePasskey();
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[] | null>(null);

  // The badge and Manage button stay disabled until both the list and the relying party id are known
  const isLoading = passkeys.isLoading || config.isLoading;
  const support: PasskeySupport | null = config.data ? assessPasskeySupport(config.data.rp_id) : null;

  /**
   * Registers a passkey, revealing the recovery codes to acknowledge when it is the first one
   */
  async function registerPasskey(name: string) {
    const result = await register.mutateAsync(name);
    if (result.recovery_codes) {
      setPendingRecoveryCodes(result.recovery_codes);
    }
  }

  /**
   * Activates the staged first passkey once its recovery codes are acknowledged
   */
  async function acknowledgeRecoveryCodes() {
    await confirmRegistration.mutateAsync();
    setPendingRecoveryCodes(null);
  }

  return {
    isManageOpen,
    openManage: () => setIsManageOpen(true),
    closeManage: () => setIsManageOpen(false),
    isLoading,
    support,
    passkeys: passkeys.data ?? [],
    registerPasskey,
    isRegistering: register.isPending,
    renamePasskey: async (passkeyId: string, name: string) => {
      await rename.mutateAsync({ passkeyId, name });
    },
    removePasskey: (passkeyId: string) => remove.mutateAsync(passkeyId),
    isMutating: rename.isPending || remove.isPending,
    pendingRecoveryCodes,
    acknowledgeRecoveryCodes,

    // Dismissing without acknowledging leaves the passkey staged, a later login prunes it
    dismissRecoveryCodes: () => setPendingRecoveryCodes(null),
  };
}
