import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

const BUG_REPORT_URL = 'https://github.com/Lumina-Finance/lumina-finance/issues/new';

// How long the copy button confirms before returning to its usual label
const COPY_CONFIRMATION_MS = 2000;

interface FallbackProps {
  componentStack: string | null;
  error: unknown;
  variant: FallbackVariant;
}

/**
 * The recovery screen shown in place of whatever failed to render
 *
 * The card variant sits in the page area with the navigation still beside it, the screen variant
 * stands alone when there is no app left around it. Both carry the same message and actions, since
 * from the user's side the difference is only how much of the app is still there
 */
export default function Fallback({ componentStack, error, variant }: FallbackProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const copyResetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);

  /**
   * Reloads onto empty storage, because state saved in this browser can be what broke the render
   * and a plain reload would restore it
   */
  const handleReload = () => {
    clearStoredData();
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
      <AlertTriangle
        size={variant === 'screen' ? 22 : 20}
        strokeWidth={2}
        style={{ color: 'var(--app-accent)' }}
        aria-hidden
      />

      <h1
        className={`mt-3 font-serif font-normal tracking-tight ${variant === 'screen' ? 'text-4xl' : 'text-2xl'}`}
      >
        OK this was not in the plan <span aria-hidden>:(</span>
      </h1>

      <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
        The app ran into an issue while trying to respond to your request. Your data is fine, and
        reloading usually fixes it. If it persists, please try again in a bit and submit a{' '}
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
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="button" className="app-primary-button" onClick={handleReload}>
          Reload
        </button>

        <button
          type="button"
          className="text-xs font-medium underline underline-offset-2 transition-colors duration-200"
          style={{ color: 'var(--app-text-muted)' }}
          onClick={handleCopy}
        >
          {COPY_LABELS[copyStatus]}
        </button>
      </div>
    </>
  );

  if (variant === 'screen') {
    return (
      <div
        className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
        style={{ backgroundColor: 'var(--app-bg)' }}
      >
        <div className="w-full max-w-sm">{content}</div>
      </div>
    );
  }

  return (
    <div className="flex justify-center py-10">
      <div
        className="w-full max-w-md rounded-2xl border p-6"
        style={{ backgroundColor: 'var(--app-surface-soft)', borderColor: 'var(--app-border)' }}
      >
        {content}
      </div>
    </div>
  );
}
