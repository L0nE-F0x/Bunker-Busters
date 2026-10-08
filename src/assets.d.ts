// Side-effect CSS imports from @fontsource packages (resolved by Vite).
declare module '@fontsource/*';

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string;

/**
 * Injected by vite.config.ts from public/: each model's content hash (the cache-busting `?v=`) and
 * size in bytes (the loading bar's total before any response arrives), and one hash over every voice clip.
 */
declare const __MODEL_REV__: Record<string, { v: string; size: number }>;
declare const __VOICE_REV__: string;
