type Listener = () => void;
const listeners = new Set<Listener>();
export function onRevalidate(fn: Listener) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitRevalidate() { listeners.forEach((fn) => fn()); }
