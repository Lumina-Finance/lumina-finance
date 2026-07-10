import { useState } from 'react';
import { beginOidcReauth, useOidcIdentities } from '@/api/oidc';
import { markOidcIntent, type OidcReauthAction } from '@/utils/oidcIntent';

/**
 * Drives the reauth step-up a passwordless account uses before a sensitive provider action
 *
 * The account proves it is still them by re-authenticating with a provider it already has linked. With
 * one linked provider it goes straight there, with several it opens a chooser. The pending action rides
 * along in the intent so the callback resumes it after the reauth arms the step-up proof
 */
export function useProviderReauth() {
  const identities = useOidcIdentities();
  const linkedProviders = identities.data?.identities ?? [];

  // The action to resume, held while the provider chooser is open for an account with several providers
  const [chooserAction, setChooserAction] = useState<OidcReauthAction | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  /** Mark the pending action and leave for the provider, which returns to finish the reauth */
  const reauthWith = async (slug: string, action: OidcReauthAction) => {
    setBusySlug(slug);
    try {
      markOidcIntent({ flow: 'reauth', action });
      const { authorization_url } = await beginOidcReauth(slug);
      window.location.assign(authorization_url);
    } catch {
      setBusySlug(null);
      setChooserAction(null);
    }
  };

  /** Begin a reauth for the given action, choosing the provider directly when only one is linked */
  const start = (action: OidcReauthAction) => {
    if (linkedProviders.length === 1) {
      void reauthWith(linkedProviders[0].provider_slug, action);
    } else if (linkedProviders.length > 1) {
      setChooserAction(action);
    }
  };

  const chooseProvider = (slug: string) => {
    if (chooserAction) void reauthWith(slug, chooserAction);
  };

  return {
    start,
    linkedProviders,
    chooserOpen: chooserAction !== null,
    closeChooser: () => setChooserAction(null),
    chooseProvider,
    busySlug,
  };
}
