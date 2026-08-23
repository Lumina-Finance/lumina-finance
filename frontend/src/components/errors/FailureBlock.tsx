import { AlertTriangle, Check, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copyText } from '@/utils/clipboard';
import { buildErrorReport } from '@/utils/errorReport';
import { clearStoredData } from '@/utils/storedData';

/** How much of the app the block stands in for: the whole window, a page area, or one card's contents */
export type FailureBlockSize = 'card' | 'inline' | 'screen';

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

const ICON_SIZE: Record<FailureBlockSize, number> = { screen: 26, card: 22, inline: 18 };

const HEADING_CLASS: Record<FailureBlockSize, string> = {
  screen: 'text-3xl',
  card: 'text-2xl',
  inline: 'text-lg',
};

// The inline size sits inside a card that has its own padding around it, so it closes the gaps the
// two standalone sizes need to fill a window
const MESSAGE_SPACING_CLASS: Record<FailureBlockSize, string> = {
  screen: 'mt-4',
  card: 'mt-4',
  inline: 'mt-2',
};

const CONTROLS_SPACING_CLASS: Record<FailureBlockSize, string> = {
  screen: 'mt-6',
  card: 'mt-6',
  inline: 'mt-4',
};

// Two lines is what the shortest widget on the dashboard has room for once its heading and its
// Reload button are placed. A server message runs to whatever length the server chose, so without
// this the button is pushed out of a card that cannot grow to follow it
const COMPACT_MESSAGE_CAP_CLASS = 'line-clamp-2';

interface FailureBlockProps {
  componentStack?: string | null;

  /** The API's own explanation, quoted in place of the app's wording where the response carried one */
  detail?: string | null;

  error: unknown;
  heading: ReactNode;

  // Set by the container rather than taken from the size, because every caller of the inline size
  // asks for the same size while only some of them sit somewhere that cannot grow
  /**
   * Draws the box for a container whose height is fixed before its contents are known: shorter
   * wording, and a quoted server message cut off after two lines
   */
  compact?: boolean;

  // Keeps the reload from emptying this browser's storage. Set it where the failure is known to be a
  // request that failed rather than saved state that broke a render, since the wipe exists to clear
  // that state, and it otherwise takes the theme, the sidebar width and the whole cached query data
  // with it for nothing
  preserveStoredData?: boolean;

  /** Chooses the lost-connection wording over the general one, the caller having decided which fits */
  serverUnreachable: boolean;

  size: FailureBlockSize;
}

/**
 * The heading, explanation and recovery controls shown wherever something did not load
 *
 * The crash screen and the smaller box a working page puts beside a failed list render the same
 * block, so the controls exist once. What differs is the heading the caller passes, how large the
 * block is drawn, and whether reloading keeps this browser's storage
 *
 * A caller whose container is too short for the usual sentence asks for the compact wording
 * instead. That sentence runs to five lines in a dashboard widget, which would leave no room for
 * the Reload button, and the compact one drops the bug report link with it. It is asked for rather
 * than taken from the size, since every caller of the inline size asks for the same size while the
 * space each of them has differs: a dashboard widget gives the box about 174px, while an insights
 * card, which holds a height too, has 360px or more and takes the usual wording
 *
 * It returns a fragment rather than its own container, since the three callers each need a
 * different one: a full window, a centred card, or a strip inside a section that is already there
 */
export default function FailureBlock({
  compact = false,
  componentStack = null,
  detail = null,
  error,
  heading,
  preserveStoredData = false,
  serverUnreachable,
  size,
}: FailureBlockProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const copyResetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);

  /**
   * Reloads, by default onto empty storage, because state saved in this browser can be what broke the
   * render and a plain reload would restore it
   *
   * A caller that knows the failure was a request rather than saved state keeps the storage, since
   * wiping it then costs the user their theme, their sidebar width and every cached response without
   * making the reload any likelier to work
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

  return (
    <>
      <div className="flex items-center gap-3">
        <AlertTriangle
          size={ICON_SIZE[size]}
          strokeWidth={2}
          className="shrink-0"
          style={{ color: 'var(--app-accent)' }}
          aria-hidden
        />

        <h1 className={`font-serif font-normal tracking-tight ${HEADING_CLASS[size]}`}>{heading}</h1>
      </div>

      <p
        className={`${MESSAGE_SPACING_CLASS[size]} text-sm leading-relaxed ${compact && detail ? COMPACT_MESSAGE_CAP_CLASS : ''}`}
        style={{ color: 'var(--app-text-muted)' }}
      >
        {detail ?? (compact ? (
          serverUnreachable
            ? <>The app can&apos;t reach the server right now.</>
            : <>Something went wrong. Please try reloading the application.</>
        ) : serverUnreachable ? (
          <>
            The app can&apos;t reach the server right now. Reload once your connection is back.
          </>
        ) : (
          <>
            Something went wrong while the app was responding to your request. Reloading usually
            fixes it. If it keeps happening, please submit a{' '}
            <a
              href={BUG_REPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
              style={{ color: 'var(--app-accent)' }}
            >
              bug report
            </a>.
          </>
        ))}
      </p>

      <div className={`${CONTROLS_SPACING_CLASS[size]} flex flex-wrap items-center gap-4`}>
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
}
