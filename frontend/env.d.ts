/// <reference types="vite/client" />

/**
 * Declared so a typo is a typecheck failure rather than a request to `undefined/games`.
 *
 * Optional because there need not be a `.env` at all — `api/base.ts` falls back to `/api`, which is
 * what both the dev proxy and nginx serve, so a fresh clone runs with no setup. See `.env.sample`.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
