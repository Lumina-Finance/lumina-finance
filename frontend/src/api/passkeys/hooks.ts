import { startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { passkeyKeys } from '@/api/cache/queryKeys';
import {
  fetchPasskeyConfig,
  fetchPasskeyRegistrationOptions,
  fetchPasskeys,
  registerPasskey,
  removePasskey,
  renamePasskey,
} from '@/api/passkeys/requests';
import { useAuth } from '@/hooks/useAuth';

/**
 * Reads the relying party id used to check the current origin can register passkeys
 *
 * The value is fixed per deployment, so it is cached indefinitely and never refetched on focus
 */
export function usePasskeyConfig() {
  return useQuery({
    queryKey: passkeyKeys.config(),
    queryFn: fetchPasskeyConfig,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/**
 * Reads the current user's registered passkeys
 */
export function usePasskeys() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: passkeyKeys.list(),
    queryFn: fetchPasskeys,
    enabled: !!accessToken,
  });
}

/**
 * Runs the full registration ceremony for a named passkey, then refreshes the list
 *
 * The three steps stay in one mutation so the browser prompt sits between requests this server
 * issued, and a thrown WebAuthnError from a cancelled or unsupported prompt surfaces to the caller
 */
export function useRegisterPasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const optionsJSON = await fetchPasskeyRegistrationOptions();
      const credential = await startRegistration({ optionsJSON });
      return registerPasskey({ name, credential });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeyKeys.list() }),
  });
}

/**
 * Relabels a passkey, then refreshes the list
 */
export function useRenamePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ passkeyId, name }: { passkeyId: string; name: string }) => renamePasskey(passkeyId, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeyKeys.list() }),
  });
}

/**
 * Removes a passkey, then refreshes the list
 */
export function useRemovePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (passkeyId: string) => removePasskey(passkeyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeyKeys.list() }),
  });
}
