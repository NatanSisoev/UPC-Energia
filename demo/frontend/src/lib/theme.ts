import { useEffect, useState } from 'react';
import { useSim } from '../store/useSim';

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

/** Resolved dark/light from the theme preference ('system' follows the OS), applied to <html data-theme>. */
export function useDark(): boolean {
  const theme = useSim((s) => s.theme);
  const [sys, setSys] = useState(() => media()?.matches ?? false);
  useEffect(() => {
    const m = media();
    if (!m) return;
    const on = (e: MediaQueryListEvent) => setSys(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const dark = theme === 'dark' || (theme === 'system' && sys);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return dark;
}
