import { useState, useEffect } from 'react';
import type { Theme } from '@/types';
import { readStoredValue, writeStoredValue } from '@/utils/browserStorage';

const THEME_KEY = 'lumina:settings:theme';

/**
 * Reads and applies the user's theme preference, persisting it to local storage and toggling the
 * document's dark class and colour scheme to match
 *
 * When the preference is `system`, it also tracks the OS colour scheme and re-applies whenever that
 * changes, so the app follows a live OS toggle without a page reload
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (readStoredValue(THEME_KEY) as Theme) || 'system'
  );

  useEffect(() => {
    const root = document.documentElement;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && darkQuery.matches);
      root.classList.toggle('dark', isDark);
      root.style.colorScheme = isDark ? 'dark' : 'light';
    };

    apply();
    writeStoredValue(THEME_KEY, theme);

    if (theme === 'system') {
      darkQuery.addEventListener('change', apply);
      return () => darkQuery.removeEventListener('change', apply);
    }
  }, [theme]);

  return { theme, setTheme };
}
