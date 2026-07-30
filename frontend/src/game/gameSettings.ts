/**
 * What was chosen when a game was started.
 *
 * Pure TypeScript over plain data — no `vue`, no `three` (docs/tech-spec.md). It lives in
 * `game/` because the rules will need it: the mode decides how a round is scored and how many
 * pieces it supplies, so setup has to read from here.
 *
 * Everything is parsed defensively. These values round-trip through localStorage, which is
 * user-editable and outlives any version of this code, so a stored blob can be truncated, from
 * an older shape, or simply nonsense. `parseGameSettings` is the only way in.
 */

export type GameKind = 'singleplayer' | 'multiplayer' | 'quiz'

export type SingleplayerMode = 'classic' | 'classicReversed' | 'random'

export interface GameKindInfo {
  readonly id: GameKind
  readonly label: string
  /** False until the kind is actually playable; the menu shows it but will not start it. */
  readonly available: boolean
}

export const GAME_KINDS: readonly GameKindInfo[] = [
  { id: 'singleplayer', label: 'Single player', available: true },
  { id: 'multiplayer', label: 'Multiplayer', available: false },
  { id: 'quiz', label: 'Quiz mode', available: false },
]

export interface SingleplayerModeInfo {
  readonly id: SingleplayerMode
  readonly label: string
  readonly rounds: number
  /**
   * Deliberately empty for now. The modes differ in how many pieces they supply and how score
   * is counted, and none of that is settled — see docs/game-design.md. An invented blurb would
   * read as decided.
   */
  readonly description: string
}

export const SINGLEPLAYER_MODES: readonly SingleplayerModeInfo[] = [
  { id: 'classic', label: 'Classic', rounds: 4, description: '' },
  { id: 'classicReversed', label: 'Classic reversed', rounds: 4, description: '' },
  { id: 'random', label: 'Random', rounds: 6, description: '' },
]

export const PLATES_PER_ROUND_CHOICES: readonly number[] = [3, 4, 5, 6]
export const DEFAULT_PLATES_PER_ROUND = 4
export const DEFAULT_SINGLEPLAYER_MODE: SingleplayerMode = 'classic'

export interface GameSettings {
  readonly kind: GameKind
  readonly mode: SingleplayerMode
  readonly platesPerRound: number
  /** Epoch milliseconds. Supplied by the caller so this module never reads the clock. */
  readonly createdAt: number
}

export function roundsOf(mode: SingleplayerMode): number {
  return SINGLEPLAYER_MODES.find(m => m.id === mode)?.rounds ?? 0
}

export function modeInfo(mode: SingleplayerMode): SingleplayerModeInfo | undefined {
  return SINGLEPLAYER_MODES.find(m => m.id === mode)
}

export function isSingleplayerMode(value: unknown): value is SingleplayerMode {
  return SINGLEPLAYER_MODES.some(m => m.id === value)
}

export function isGameKind(value: unknown): value is GameKind {
  return GAME_KINDS.some(k => k.id === value)
}

export function isPlatesPerRound(value: unknown): boolean {
  return typeof value === 'number' && PLATES_PER_ROUND_CHOICES.includes(value)
}

export function defaultGameSettings(createdAt: number): GameSettings {
  return {
    kind: 'singleplayer',
    mode: DEFAULT_SINGLEPLAYER_MODE,
    platesPerRound: DEFAULT_PLATES_PER_ROUND,
    createdAt,
  }
}

/**
 * Read settings from an untrusted value, or null if it cannot be salvaged.
 *
 * Returns null rather than a patched-up default on a bad `kind` or `mode`: those name what the
 * game *is*, so quietly substituting one would drop a player into a different game from the one
 * they started. `platesPerRound` is different — it is a dial, so an out-of-range value falls
 * back to the default rather than discarding the whole game.
 */
export function parseGameSettings(value: unknown): GameSettings | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  if (!isGameKind(raw.kind)) return null
  if (!isSingleplayerMode(raw.mode)) return null

  return {
    kind: raw.kind,
    mode: raw.mode,
    platesPerRound: isPlatesPerRound(raw.platesPerRound)
      ? (raw.platesPerRound as number)
      : DEFAULT_PLATES_PER_ROUND,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : 0,
  }
}

/**
 * A game id.
 *
 * `crypto.randomUUID` needs a secure context, which localhost and https both are — but a plain
 * http origin on a LAN is not, and that is a normal way to test a browser game on a phone. So
 * there is a fallback built from `getRandomValues`, which is available either way.
 */
export function createGameId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    // RFC 4122 version 4 layout.
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
    return [
      hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
    ].join('-')
  }

  throw new Error('No crypto source available to generate a game id')
}
