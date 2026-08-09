import { useLocalStorage } from '@vueuse/core'
import { parseGameSettings, type GameSettings } from '@hexnome/rules/gameSettings'
import { createGameId } from './createGameId'

/**
 * Settings for started games, keyed by game id and kept in localStorage.
 *
 * This is what makes `/game?id=…` survive a refresh. The board state does not persist yet — a
 * reload restarts the game — but which game it *is* does, so the page comes back as singleplayer
 * classic with four plates a round rather than as a guess.
 *
 * Everything read back goes through `parseGameSettings`. localStorage is user-editable and
 * outlives any version of this code, so a stored entry can be hand-mangled, truncated, or left
 * over from an older shape; an unparseable one is dropped rather than trusted.
 */

const STORAGE_KEY = 'hexnome:games'

/**
 * Fill in the seed for a game saved before there were seeds.
 *
 * Those games were dealt from their id, so the id is the honest answer rather than a placeholder —
 * they come back dealing what they always dealt. Done here, where the id is known, because
 * `parseGameSettings` is handed a value and not the key it was stored under.
 */
function withSeed(id: string, settings: GameSettings | null): GameSettings | null {
  if (!settings) return null
  return settings.seed ? settings : { ...settings, seed: id }
}

/**
 * How many games to remember. Each entry is tiny, but nothing ever deleted them, so without a
 * cap this grows for as long as the browser profile lives.
 */
const MAX_REMEMBERED = 20

export interface SavedGames {
  /** Settings for a game id, or null if unknown or unreadable. */
  get(id: string): GameSettings | null
  /** Store settings under a fresh id and return it. */
  create(settings: Omit<GameSettings, 'createdAt'>): string
  /**
   * Change part of a game already stored.
   *
   * For the lobby, which names the seats after the game has been minted. Deliberately narrow: it
   * merges into what is there and re-parses the result, so a patch cannot write a game that would
   * not have been readable in the first place.
   */
  update(id: string, patch: Partial<GameSettings>): void
  /** Ids currently remembered, most recently created first. */
  ids(): string[]
}

/**
 * Read one game's settings without a Vue context.
 *
 * For the router guard, which runs before any component exists. It shares STORAGE_KEY and
 * `parseGameSettings` with the composable, so the key and the validation have one definition
 * between them — only the reactivity differs.
 */
export function readSavedGame(id: string): GameSettings | null {
  if (!id) return null
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return withSeed(id, parseGameSettings((parsed as Record<string, unknown>)[id]))
  } catch {
    // Storage can be unavailable (private mode, disabled) or hold invalid JSON. Either way
    // there is no game to restore.
    return null
  }
}

export function useSavedGames(): SavedGames {
  const stored = useLocalStorage<Record<string, unknown>>(STORAGE_KEY, {})

  function entries(): [string, GameSettings][] {
    const raw = stored.value
    if (typeof raw !== 'object' || raw === null) return []
    const out: [string, GameSettings][] = []
    for (const [id, value] of Object.entries(raw)) {
      const parsed = parseGameSettings(value)
      if (parsed) out.push([id, parsed])
    }
    return out.sort((a, b) => b[1].createdAt - a[1].createdAt)
  }

  return {
    get(id) {
      if (!id) return null
      const raw = stored.value
      if (typeof raw !== 'object' || raw === null) return null
      return withSeed(id, parseGameSettings(raw[id]))
    },

    create(settings) {
      const id = createGameId()
      const full: GameSettings = { ...settings, createdAt: Date.now() }
      // Rebuild from the parsed entries, which drops any unreadable leftovers at the same time.
      const kept = entries().slice(0, MAX_REMEMBERED - 1)
      const next: Record<string, GameSettings> = { [id]: full }
      for (const [key, value] of kept) next[key] = value
      stored.value = next
      return id
    },

    update(id, patch) {
      const raw = stored.value
      if (typeof raw !== 'object' || raw === null) return
      const current = parseGameSettings(raw[id])
      if (!current) return
      // Re-parsed rather than trusted: a patch goes through the same gate a stored blob does, so
      // there is one definition of what a readable game is.
      const merged = parseGameSettings({ ...current, ...patch })
      if (merged) stored.value = { ...raw, [id]: merged }
    },

    ids: () => entries().map(([id]) => id),
  }
}
