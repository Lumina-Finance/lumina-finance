import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { passkeyKeys } from '@/api/cache/queryKeys';
import {
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
import type { StepUpPayload } from '@/api/two-factor/types';
import { useAuth } from '@/hooks/useAuth';
import { withMinDelay } from '@/utils/timing';

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
 * Runs the full passwordless sign-in ceremony, resolving to the new session
 *
 * The browser prompt sits between the options and verify requests so the assertion answers a challenge
 * this server issued. The caller commits the returned session
 */
export function useAuthenticatePasskey() {
  return useMutation({
    mutationFn: async () => {
      const optionsJSON = await fetchPasskeyAuthenticationOptions();
      const credential = await startAuthentication({ optionsJSON });
      return authenticatePasskey(credential);
    },
  });
}

/**
 * Runs the passkey second-factor ceremony for a password login, resolving to the new session
 *
 * The options request does not spend the login challenge, so a cancelled prompt leaves the user free
 * to retry or fall back to a code, while a verified assertion completes the login
 */
export function useVerifyPasskeyMfa() {
  return useMutation({
    mutationFn: async (mfaToken: string) => {
      const optionsJSON = await fetchPasskeyMfaOptions(mfaToken);
      const credential = await startAuthentication({ optionsJSON });
      return verifyPasskeyMfa(mfaToken, credential);
    },
  });
}

/**
 * Runs the passkey second-factor ceremony for a password reset
 *
 * The options request does not spend the reset challenge, so a cancelled prompt leaves the user free
 * to retry or fall back to a code, while a verified assertion completes the reset
 */
export function useVerifyPasskeyReset() {
  return useMutation({
    mutationFn: async (payload: { token: string; new_password: string; mfa_token: string }) => {
      const optionsJSON = await fetchPasskeyResetOptions(payload.mfa_token);
      const credential = await startAuthentication({ optionsJSON });
      return verifyPasskeyReset(payload, credential);
    },
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
 * issued, and a thrown WebAuthnError from a cancelled or unsupported prompt surfaces to the caller. A
 * first passkey comes back staged with recovery codes, so the list only changes once it is confirmed
 */
export function useRegisterPasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, step_up }: { name: string; step_up?: StepUpPayload }) => {
      // Step up before fetching options, so a wrong factor is refused before the browser ceremony runs
      // and the passkey is only ever created after the current factor verifies
      const optionsJSON = await fetchPasskeyRegistrationOptions(step_up);
      const credential = await startRegistration({ optionsJSON });
      // The minimum delay holds only the server store, so a cancelled prompt still surfaces at once
      return withMinDelay(() => registerPasskey({ name, credential }));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeyKeys.list() }),
  });
}

/**
 * Activates a staged first passkey once its recovery codes are acknowledged, then refreshes the list
 */
export function useConfirmPasskeyRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withMinDelay(confirmPasskeyRegistration),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeyKeys.list() }),
  });
}

/**
 * Relabels a passkey, then refreshes the list
 */
export function useRenamePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ passkeyId, name }: { passkeyId: string; name: string }) =>
      withMinDelay(() => renamePasskey(passkeyId, name)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeyKeys.list() }),
  });
}

/**
 * Removes a passkey after a step-up reauthentication, then refreshes the list
 */
export function useRemovePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ passkeyId, payload }: { passkeyId: string; payload: StepUpPayload }) =>
      removePasskey(passkeyId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: passkeyKeys.list() }),
  });
}
