import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

/** GET `path` and expose a reload. `error` is the message from a failed load. */
export function useGet<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<T>(path).then((d) => { setData(d); setError(''); }).catch((e) => setError(String(e.message ?? e)));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, reload: load };
}
