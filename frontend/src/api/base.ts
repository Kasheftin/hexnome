/**
 * Where the server is, in one place.
 *
 * Every request and the head socket go through here, so the app has exactly one idea of where the
 * backend lives and it comes from `VITE_API_BASE` — see `.env.sample`.
 *
 * ## Why a prefix at all
 *
 * The browser is always on the same origin as the API: nginx proxies `/api` to the backend in
 * production, and the Vite dev server proxies the same path to `localhost:3000`. Same-origin in both,
 * so there is no CORS to configure and no credentials mode to get wrong. What differs between the two
 * is nothing, which is the point — a path that works locally works deployed.
 *
 * The backend is mounted under the prefix rather than nginx stripping it (`setGlobalPrefix('api')`),
 * so what leaves here is what the server answers on.
 *
 * ## Getting this wrong is quiet
 *
 * The deployed site serves `index.html` for any path it does not recognise — that is what makes an
 * SPA's deep links work. So a request that loses its prefix does not 404: it comes back **200 with a
 * page of HTML**, and the failure surfaces later, as JSON parsing nonsense. There is nothing clever
 * to be done about that beyond keeping the prefix in one place, which is this file.
 */

/**
 * The prefix, without a trailing slash.
 *
 * `/api` when unset, so a clone with no `.env` runs. Trailing slashes are stripped rather than
 * refused: `/api` and `/api/` are the same intent, and every caller passes a path that starts with
 * one, so keeping it would produce `/api//games`.
 */
const BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '')

/** A path on the API, as a URL to fetch. `path` starts with a slash. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`
}

/**
 * The same, as a WebSocket URL.
 *
 * A relative base has to be made absolute — `new WebSocket('/api/watch')` throws, where `fetch` is
 * perfectly happy with a path. `URL` against the current origin does that, and also handles an
 * absolute `VITE_API_BASE` pointing at another host, where the scheme to swap is that host's rather
 * than this page's.
 */
export function apiSocketUrl(path: string): string {
  const url = new URL(`${BASE}${path}`, globalThis.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
