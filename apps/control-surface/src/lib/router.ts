import { useCallback, useEffect, useState } from 'react';

/** Read the current hash route (e.g. "#/missions" -> "/missions"). */
export function currentRoute(): string {
  const hash = window.location.hash;
  if (!hash || hash === '#') return '/';
  return hash.replace(/^#/, '');
}

export function navigate(route: string): void {
  window.location.hash = route;
}

/**
 * Minimal hash-based router: zero dependencies, real URLs (#/missions),
 * no full page reloads.
 */
export function useHashRoute(): [string, (route: string) => void] {
  const [route, setRoute] = useState<string>(currentRoute());

  useEffect(() => {
    const onHashChange = () => {
      setRoute(currentRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = useCallback((next: string) => navigate(next), []);

  return [route, go];
}
