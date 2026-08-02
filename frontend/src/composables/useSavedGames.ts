import { useLocalStorage } from '@vueuse/core'
import { parseGameSettings, type GameSettings } from '@hexnome/rules/gameSettings'
import { createGameId } from './createGameId'

/**
 * Started games, keyed by id and kept in localStorage.
 *
 * This is what makes `/game?id=…` survive a refresh. The board state does not persist yet — a
 * reload restarts the game — but which game it *is* does, so the page comes back as singleplayer
 * classic with four plates a round rather than as a guess.
 *
 * **A game has an id and a seed, and they are different values.** The id finds the game; the seed
 * generates it — the deck, the agenda, the reshuffles, the scatter. Copying a seed into a new game
 * replays the same deal under a new id, which is how a board can be played twice. The shape mirrors
 * the `Game` row on the server, so moving this to the API later is a change of transport rather than
 * of meaning.
 *
 * Everything read back goes through `parseGameSettings`. localStorage is user-editable and
 * outlives any version of this code, so a stored entry can be hand-mangled, truncated, or left
 * over from an older shape; an unparseable one is dropped rather than trusted.
 */

const STORAGE_KEY = 'hexnome:games'

/**
 * How many games to remember. Each entry is tiny, but nothing ever deleted them, so without a
 * cap this grows for as long as the browser profile lives.
 */
const MAX_REMEMBERED = 20

/** A game as it is remembered: what generates it, and what kind of game it is. */
export interface SavedGame {
  readonly seed: string
  readonly settings: GameSettings
}

export interface SavedGames {
  /** A game by id, or null if unknown or unreadable. */
  get(id: string): SavedGame | null
  /**
   * Store a new game and return its id.
   *
   * A seed may be supplied to replay a deal that has already been played; omitted, a fresh one is
   * minted. Either way the id is new — that is the difference between the two.
   */
  create(settings: Omit<GameSettings, 'createdAt'>, seed?: string): string
  /** Ids currently remembered, most recently created first. */
  ids(): string[]
}

/**
 * Read one stored entry.
 *
 * Entries written before games had their own seed hold settings at the top level and no seed at all.
 * Those fall back to using the id as the seed, which is exactly what such a game was played with, so
 * an old link still deals the board it always dealt.
 */
function parseSavedGame(id: string, value: unknown): SavedGame | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const nested = parseGameSettings(raw.settings)
  if (nested) return { seed: typeof raw.seed === 'string' && raw.seed ? raw.seed : id, settings: nested }

  const flat = parseGameSettings(raw)
  return flat ? { seed: id, settings: flat } : null
}

/**
 * Read one game's settings without a Vue context.
 *
 * For the router guard, which runs before any component exists. It shares STORAGE_KEY and
 * `parseGameSettings` with the composable, so the key and the validation have one definition
 * between them — only the reactivity differs.
 */
export function readSavedGame(id: string): SavedGame | null {
  if (!id) return null
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parseSavedGame(id, (parsed as Record<string, unknown>)[id])
  } catch {
    // Storage can be unavailable (private mode, disabled) or hold invalid JSON. Either way
    // there is no game to restore.
    return null
  }
}

export function useSavedGames(): SavedGames {
  const stored = useLocalStorage<Record<string, unknown>>(STORAGE_KEY, {})

  function entries(): [string, SavedGame][] {
    const raw = stored.value
    if (typeof raw !== 'object' || raw === null) return []
    const out: [string, SavedGame][] = []
    for (const [id, value] of Object.entries(raw)) {
      const parsed = parseSavedGame(id, value)
      if (parsed) out.push([id, parsed])
    }
    return out.sort((a, b) => b[1].settings.createdAt - a[1].settings.createdAt)
  }

  return {
    get(id) {
      if (!id) return null
      const raw = stored.value
      if (typeof raw !== 'object' || raw === null) return null
      return parseSavedGame(id, raw[id])
    },

    create(settings, seed) {
      const id = createGameId()
      const game: SavedGame = {
        // A fresh seed by default; a supplied one replays a deal already played.
        seed: seed ?? createGameId(),
        settings: { ...settings, createdAt: Date.now() },
      }
      // Rebuild from the parsed entries, which drops any unreadable leftovers at the same time.
      const kept = entries().slice(0, MAX_REMEMBERED - 1)
      const next: Record<string, SavedGame> = { [id]: game }
      for (const [key, value] of kept) next[key] = value
      stored.value = next
      return id
    },

    ids: () => entries().map(([id]) => id),
  }
}
