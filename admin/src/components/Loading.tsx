import { useEffect, useState } from 'react';

interface Props {
  children: React.ReactNode;
  delayMs?: number;
}

export function Loading({ children, delayMs = 150 }: Props) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  if (!show) return null;
  return <>{children}</>;
}
