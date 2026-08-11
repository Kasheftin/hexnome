/**
 * Where this server answers.
 *
 * nginx forwards `/api` to it **without stripping the prefix** — `proxy_pass http://localhost:22466;`
 * has no URI part, so the request arrives exactly as the browser sent it (settings/hexnome.com). So
 * the backend is mounted there rather than nginx being taught to take it off.
 *
 * ## Two places need it, and only one of them is Nest's
 *
 * `setGlobalPrefix` moves the controllers. It does **not** move the head socket: `HeadsGateway`
 * attaches a `WebSocketServer` to the raw HTTP server, which knows nothing about Nest's routing and
 * would go on listening at `/watch` while every client asked for `/api/watch`.
 *
 * That failure is silent — a socket that never connects makes clients fall back to polling, so the
 * game works and merely feels slow. Hence one constant, read by both.
 */
export const API_PREFIX = 'api'

/** The head socket's path, prefix included. See `HeadsGateway.attach`. */
export const WATCH_PATH = `/${API_PREFIX}/watch`
