import { useRef, useState } from 'react';

/** Digit count of a TOTP code, the single source of truth for every one-time-code input */
export const OTP_LENGTH = 6;

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Renders a fixed-length one-time code as digit boxes backed by a single hidden input. The lone field
 * is what the browser, the OS, and password managers fill, so the whole code lands in one assignment
 * instead of racing a row of controlled boxes that drop the last autofilled digit. The boxes are a
 * purely visual rendering of its value, with native typing, backspace, paste, and autofill for free
 */
export function OtpInput({ value, onChange, length = OTP_LENGTH, disabled = false, autoFocus = false }: OtpInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // The active box is where the next digit lands, so it carries the focus ring while the field is focused
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <div
      className="relative flex justify-center gap-2"
      style={{ opacity: disabled ? 0.6 : 1 }}
      onClick={() => {
        if (!disabled) inputRef.current?.focus();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        aria-label="One-time code"
        // The real field sits invisibly over the boxes so it captures typing, paste, and autofill while
        // the boxes below show its digits
        className="absolute inset-0 z-10 h-full w-full cursor-default opacity-0"
      />
      {Array.from({ length }, (_, index) => {
        const isActive = isFocused && !disabled && index === activeIndex;
        return (
          <div
            key={index}
            aria-hidden
            className="app-input flex h-12 w-12 items-center justify-center text-lg"
            style={{
              paddingLeft: 0,
              paddingRight: 0,
              ...(isActive
                ? { borderColor: 'var(--app-accent-border)', boxShadow: '0 0 0 2px var(--app-accent-soft)' }
                : {}),
            }}
          >
            {value[index] ?? ''}
          </div>
        );
      })}
    </div>
  );
}
