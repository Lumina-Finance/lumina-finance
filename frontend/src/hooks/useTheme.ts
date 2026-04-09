import { useState, useEffect } from 'react';
import type { Theme } from '@/types';

const THEME_KEY = 'lumina:settings:theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || 'system'
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
    localStorage.setItem(THEME_KEY, theme);

    if (theme === 'system') {
      darkQuery.addEventListener('change', apply);
      return () => darkQuery.removeEventListener('change', apply);
    }
  }, [theme]);

  return { theme, setTheme };
}
