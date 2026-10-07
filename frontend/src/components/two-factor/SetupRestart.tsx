import { useEffect, useRef } from 'react';

interface SetupRestartProps {
  /** Begins the same setup again from its first step */
  onStartAgain: () => void;
}

/**
 * Replaces a setup's final button once that step fails. The server answers an expired setup the same
 * as a missing one, so retrying can't work, and the copy never says why so a stolen session learns
 * nothing from it
 */
export function SetupRestart({ onStartAgain }: SetupRestartProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The Done button that had focus is gone, so focus moves to its replacement rather than the page. This
  // block is taller than Done, so on a short screen the button is also brought fully into view
  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
    buttonRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <div className="space-y-3">
      <p role="alert" className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
        Oops, something went wrong. Please start again.
      </p>
      <button ref={buttonRef} type="button" onClick={onStartAgain} className="app-primary-button w-full">
        Start again
      </button>
    </div>
  );
}
