import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useRefreshOidcIdentities } from '@/api/oidc';
import { ProviderReauthModal } from '@/pages/settings/components/security-section/ProviderReauthModal';
import { SetPasswordModal } from '@/pages/settings/components/security-section/SetPasswordModal';
import { useProviderReauth } from '@/pages/settings/hooks/useProviderReauth';

/**
 * The password area for an account with no password: a reminder and a button that re-confirms it is
 * you through a linked provider before setting the first password
 *
 * The reauth returns to settings with the setPassword flag, which opens the form here
 */
export function SetPasswordControls() {
  const location = useLocation();
  const navigate = useNavigate();
  const refreshOidcIdentities = useRefreshOidcIdentities();
  const reauth = useProviderReauth();

  const [modalOpen, setModalOpen] = useState<boolean>(
    () => (location.state as { setPassword?: boolean } | null)?.setPassword === true,
  );

  // The reauth arrival opens the form once, then the state is cleared so a reload does not reopen it
  useEffect(() => {
    if (!modalOpen) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [modalOpen, navigate, location.pathname]);

  // Refreshing the identities flips the section to the change-password form, which unmounts the modal,
  // so a successful set holds that refresh until the modal has finished animating out
  const refreshAfterExitRef = useRef(false);

  const finish = () => {
    refreshAfterExitRef.current = true;
    setModalOpen(false);
  };

  const handleModalExit = () => {
    if (!refreshAfterExitRef.current) return;
    refreshAfterExitRef.current = false;
    void refreshOidcIdentities();
  };

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        This account signs in only through a provider. Set a password to sign in without one. You'll
        re-confirm it's you with a provider first.
      </p>
      <button
        type="button"
        className="app-secondary-button"
        disabled={reauth.busySlug !== null || reauth.linkedProviders.length === 0}
        onClick={() => reauth.start({ kind: 'set-password' })}
      >
        {reauth.busySlug !== null ? <div className="app-spinner" /> : 'Set up a password'}
      </button>

      <ProviderReauthModal
        open={reauth.chooserOpen}
        providers={reauth.linkedProviders}
        busySlug={reauth.busySlug}
        onChoose={reauth.chooseProvider}
        onClose={reauth.closeChooser}
      />

      <SetPasswordModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onDone={finish}
        onExitComplete={handleModalExit}
      />
    </div>
  );
}
