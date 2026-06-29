import { useState } from 'react';
import { usePasskeyConfig, usePasskeys, useRegisterPasskey, useRemovePasskey, useRenamePasskey } from '@/api/passkeys';
import { assessPasskeySupport, type PasskeySupport } from '@/utils/passkeySupport';

/**
 * Owns the passkey management state: whether the manage dialog is open, the support assessment for
 * the current origin, the registered passkeys, and the add, rename, and remove actions
 */
export function usePasskeyManagement() {
  const config = usePasskeyConfig();
  const passkeys = usePasskeys();
  const register = useRegisterPasskey();
  const rename = useRenamePasskey();
  const remove = useRemovePasskey();
  const [isManageOpen, setIsManageOpen] = useState(false);

  // The badge and Manage button stay disabled until both the list and the relying party id are known
  const isLoading = passkeys.isLoading || config.isLoading;
  const support: PasskeySupport | null = config.data ? assessPasskeySupport(config.data.rp_id) : null;

  return {
    isManageOpen,
    openManage: () => setIsManageOpen(true),
    closeManage: () => setIsManageOpen(false),
    isLoading,
    support,
    passkeys: passkeys.data ?? [],
    registerPasskey: (name: string) => register.mutateAsync(name),
    isRegistering: register.isPending,
    renamePasskey: (passkeyId: string, name: string) => rename.mutateAsync({ passkeyId, name }),
    removePasskey: (passkeyId: string) => remove.mutateAsync(passkeyId),
    isMutating: rename.isPending || remove.isPending,
  };
}
