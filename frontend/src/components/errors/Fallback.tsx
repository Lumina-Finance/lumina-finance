import { AlertTriangle, Check, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useServerReachability } from '@/hooks/useServerReachability';
import { copyText } from '@/utils/clipboard';
import { buildErrorReport } from '@/utils/errorReport';
import { clearStoredData } from '@/utils/storedData';

export type FallbackVariant = 'card' | 'screen';

type CopyStatus = 'idle' | 'copied' | 'failed';

const COPY_LABELS: Record<CopyStatus, string> = {
  idle: 'Copy error details',
  copied: 'Copied',
  failed: 'Could not copy',
};

// The issue list rather than a blank new issue, so the repository's own template picker is what
// the user lands on
const BUG_REPORT_URL = 'https://github.com/Lumina-Finance/lumina-finance/issues';

// How long the copy button confirms before returning to its usual label
const COPY_CONFIRMATION_MS = 2000;

interface FallbackProps {
  componentStack: string | null;
  error: unknown;

  // Keeps the reload from emptying this browser's storage. Set it where the failure is known to be a
  // network one, since the wipe exists to clear state that could have caused a render error and it
  // costs the theme and the sidebar width to no purpose when that is not what went wrong
  preserveStoredData?: boolean;

  variant: FallbackVariant;
}

/**
 * The recovery screen shown in place of whatever failed to render
 *
 * The card variant sits in the page area with the navigation still beside it, the screen variant
 * stands alone when there is no app left around it. Both carry the same message and actions, since
 * from the user's side the difference is only how much of the app is still there
 */
export default function Fallback({ componentStack, error, preserveStoredData = false, variant }: FallbackProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const copyResetTimer = useRef<number | null>(null);
  // Until the probe comes back the message assumes a bug, since that is the only thing the user
  // can act on. An unreachable server rewrites it rather than the other way round
  const serverUnreachable = useServerReachability() === 'unreachable';

  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);

  /**
   * Reloads, by default onto empty storage, because state saved in this browser can be what broke the
   * render and a plain reload would restore it
   *
   * A caller that knows the failure was a network one keeps the storage, since wiping it then only
   * costs the user their theme and sidebar width without making the reload any likelier to work
   */
  const handleReload = () => {
    if (!preserveStoredData) clearStoredData();
    window.location.reload();
  };

  /**
   * Puts the technical detail on the clipboard for a bug report, keeping it off the screen
   *
   * The report is built here rather than when the error was caught so the time reflects the moment
   * the user asked for it, which is what they will have seen in the app
   */
  const handleCopy = async () => {
    const report = buildErrorReport({
      componentStack,
      error,
      // The query string is left out on purpose. A password reset link carries its token there and
      // the provider callback carries an authorization code, and this text is written to be pasted
      // into a public bug report
      path: window.location.pathname,
      occurredAt: new Date(),
      userAgent: navigator.userAgent,
    });

    setCopyStatus((await copyText(report)) ? 'copied' : 'failed');

    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setCopyStatus('idle'), COPY_CONFIRMATION_MS);
  };

  const content = (
    <>
      <div className="flex items-center gap-3">
        <AlertTriangle
          size={variant === 'screen' ? 26 : 22}
          strokeWidth={2}
          className="shrink-0"
          style={{ color: 'var(--app-accent)' }}
          aria-hidden
        />

        <h1
          className={`font-serif font-normal tracking-tight ${variant === 'screen' ? 'text-3xl' : 'text-2xl'}`}
        >
          OK this was not in the plan <span aria-hidden>:(</span>
        </h1>
      </div>

      <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
        {serverUnreachable ? (
          <>
            The app can&apos;t reach the server right now. Your data is fine. Reload once your
            connection is back.
          </>
        ) : (
          <>
            The app ran into an issue while trying to respond to your request. Your data is fine,
            and reloading usually fixes it. If it persists, please try again in a bit and submit a{' '}
            <a
              href={BUG_REPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
              style={{ color: 'var(--app-accent)' }}
            >
              bug report
            </a>{' '}
            if it still doesn&apos;t resolve.
          </>
        )}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="button" className="app-primary-button" onClick={handleReload}>
          <RefreshCw size={15} strokeWidth={2} aria-hidden />
          Reload
        </button>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 transition-colors duration-200"
          style={{ color: 'var(--app-text-muted)' }}
          onClick={handleCopy}
        >
          {copyStatus === 'copied' ? (
            <Check size={14} strokeWidth={2.5} style={{ color: 'var(--app-positive)' }} aria-hidden />
          ) : (
            <Copy size={14} strokeWidth={2} aria-hidden />
          )}
          {COPY_LABELS[copyStatus]}
        </button>
      </div>
    </>
  );

  if (variant === 'screen') {
    return (
      <div
        className="flex min-h-[100dvh] items-center justify-center px-4"
        style={{ backgroundColor: 'var(--app-bg)' }}
      >
        <div className="w-full max-w-md">{content}</div>
      </div>
    );
  }

  return (
    // The page area is taller than the card, so the height gives it something to sit in the middle
    // of rather than hugging the top of the content column
    <div className="flex min-h-[70dvh] items-center justify-center">
      <div
        className="w-full max-w-md rounded-2xl border p-6"
        style={{ backgroundColor: 'var(--app-surface-soft)', borderColor: 'var(--app-border)' }}
      >
        {content}
      </div>
    </div>
  );
}
