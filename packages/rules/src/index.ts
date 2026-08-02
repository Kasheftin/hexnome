/**
 * The rules of hexnome, as a library.
 *
 * Everything here is pure TypeScript over plain data — no `vue`, no `three`, and no DOM in the
 * tsconfig's `lib`. That is what lets the same code decide a move in the browser and validate one on
 * the server, rather than the two drifting into disagreement about what the game is.
 *
 * Subpath imports (`@hexnome/rules/deck`) work too and are usually clearer about what a file depends
 * on. This barrel exists for consumers that would rather have one import.
 */
export * from './agenda'
export * from './bag'
export * from './deck'
export * from './draft'
export * from './gameLog'
export * from './gameSettings'
export * from './groups'
export * from './hex'
export * from './payment'
export * from './placement'
export * from './plate'
export * from './random'
export * from './recycling'
export * from './scoringTimeline'
export * from './source'
export * from './tableau'
export * from './turn'
