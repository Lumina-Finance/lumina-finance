import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

const DIGIT_PATTERN = /\d/;

/**
 * Renders a fixed-length one-time code as individual digit boxes with focus advance, backspace, and paste
 */
export function OtpInput({ value, onChange, length = 6, disabled = false, autoFocus = false }: OtpInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  /**
   * Focuses one digit box, clamped to the available range
   */
  const focusBox = (index: number) => {
    const clamped = Math.max(0, Math.min(length - 1, index));
    inputsRef.current[clamped]?.focus();
  };

  /**
   * Writes the typed digit at its position and advances focus, ignoring non-digits
   *
   * A password manager autofills the whole code into the first box at once, so any multi-digit input
   * is spread across the boxes rather than collapsed to a single character
   */
  const handleBoxChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');

    if (digits.length > 1) {
      const filled = (value.slice(0, index) + digits).slice(0, length);
      onChange(filled);
      focusBox(filled.length);
      return;
    }

    const digit = raw.slice(-1);
    if (digit && !DIGIT_PATTERN.test(digit)) return;

    const next = value.split('');
    next[index] = digit;
    onChange(next.join('').slice(0, length));
    if (digit) focusBox(index + 1);
  };

  /**
   * Moves focus to the previous box when backspacing an already empty box
   */
  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !value[index]) {
      focusBox(index - 1);
    }
  };

  /**
   * Fills the boxes from a pasted value, keeping only its digits
   */
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;

    onChange(digits);
    focusBox(digits.length);
  };

  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length }, (_, index) => (
        <input
          // The boxes are positional and fixed, so the index is a stable key
          key={index}
          ref={(node) => {
            inputsRef.current[index] = node;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          // The first box accepts the full autofilled code, which handleBoxChange spreads across boxes
          maxLength={index === 0 ? length : 1}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          value={value[index] ?? ''}
          onChange={(event) => handleBoxChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          aria-label={`Digit ${index + 1}`}
          // Override the app-input horizontal padding so the centred digit is not clipped in a narrow box
          style={{ paddingLeft: 0, paddingRight: 0 }}
          className="app-input h-12 w-12 text-center text-lg"
        />
      ))}
    </div>
  );
}
