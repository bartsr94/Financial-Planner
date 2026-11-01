import { useEffect, useState } from 'react';

// Each page has its own path, so a refresh keeps you where you were and the back button works.
// The server sends index.html for any path it doesn't know.

/** Go to `path` without a page load. */
export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The current path, following back, forward and `navigate`. */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => { setPath(location.pathname); window.scrollTo(0, 0); };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}
