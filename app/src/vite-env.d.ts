
/**
 * The game catalogue, baked in at build time by the `replay-game-catalogue`
 * plugin in app/vite.config.ts. Virtual rather than a file on disk so a fresh
 * checkout typechecks before anything has generated it.
 */
declare module 'virtual:game-catalogue' {
  const snapshot: {
    generatedAt: string;
    sources: Array<{ label: string; detail: string; count: number }>;
    games: unknown[];
  };
  export default snapshot;
}
