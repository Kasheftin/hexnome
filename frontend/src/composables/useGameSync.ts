/**
 * A game's connection to the server: load it, submit turns, notice when they disagree.
 *
 * ## What is optimistic and what is authoritative
 *
 * The board on screen is the local engine's, and it moves the instant the player does — every drag,
 * every placement, with no round trip. What the server holds is the log, and the log is the truth.
 * The two agree because both sides validate with the same `@hexnome/rules` code, so a move the client
 * allowed is a move the server allows.
 *
 * A turn is therefore submitted **after** it has already been applied locally. When the
 * acknowledgement comes back it carries two things: `effects`, which the client already has, and
 * `response`, which is what the server added and the client has not. Only the second is applied.
 * That split is why the board does not have to be rebuilt on every turn, and why the scene keeps its
 * animation state.
 *
 * ## When they disagree
 *
 * Rarely, and never for a benign reason:
 *
 * - **A lost response** is not a disagreement. The turn carries a `cmdId`; resending it returns the
 *   original row rather than writing a second, so a flaky network costs a retry and nothing else.
 * - **`409`** means something else wrote to this game — a second tab, or another seat later on.
 * - **`422`** means the server refused a move the client had accepted. That is a bug in one of them,
 *   and there is no sensible way to carry on from it.
 *
 * Both are resolved the same way: `diverged` is raised and the board is rebuilt from the server's
 * log. There is deliberately no attempt to unpick the local state move by move — an optimistic
 * client that can be *nearly* right about the truth is worse than one that reloads.
 */
import { shallowRef } from 'vue'
import type { LogEntry } from '@hexnome/rules/gameLog'
import type { CommandView, GameView } from '@hexnome/rules/wire'
import { ApiError, getCommands, getGame, submitCommand } from '@/api/games'
import { seatIn } from '@/composables/useSeat'

/** How many times to resend a turn whose response never arrived. */
const RETRIES = 3

/** How long to wait between those attempts. Short: the player is watching. */
const RETRY_PAUSE_MS = 400

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export type SyncStatus = 'loading' | 'ready' | 'saving' | 'missing' | 'diverged' | 'offline'

export interface LoadedGame {
  readonly game: GameView
  /**
   * Everything that has happened, oldest first and **still grouped by command**.
   *
   * Not flattened, because the grouping carries information the entries do not: one command is one
   * turn, so counting them is how a reloaded game knows it is on turn six rather than turn one.
   */
  readonly commands: readonly CommandView[]
  /** The command to build the next one on. */
  readonly head: number
}

export interface GameSync {
  readonly status: () => SyncStatus
  /** What went wrong, when the status says something did. */
  readonly problem: () => string
  /** Fetch the game and its whole log. Throws nothing: read `status` afterwards. */
  load: (id: string) => Promise<LoadedGame | null>
  /**
   * Send a completed turn.
   *
   * Resolves with the entries the server added and the client has yet to apply — usually empty,
   * until the deck moves across. Resolves with `null` when the game has diverged, in which case the
   * caller should stop playing and let the page rebuild.
   */
  submit: (effects: readonly LogEntry[]) => Promise<readonly LogEntry[] | null>
}

/**
 * A command id that is stable across retries of the same turn but unique between turns.
 *
 * `crypto.randomUUID` needs a secure context, which `localhost` and HTTPS both are; the fallback
 * keeps a plain-HTTP LAN test from failing on something this incidental.
 */
function newCommandId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function useGameSync(): GameSync {
  const status = shallowRef<SyncStatus>('loading')
  const problem = shallowRef('')

  let gameId = ''
  let head = 0
  /** The seat token for this game, looked up when it loads. Without one you are a spectator. */
  let token = ''

  function diverge(why: string): null {
    status.value = 'diverged'
    problem.value = why
    return null
  }

  async function load(id: string): Promise<LoadedGame | null> {
    gameId = id
    token = seatIn(id)?.token ?? ''
    status.value = 'loading'
    problem.value = ''

    try {
      const [game, slice] = await Promise.all([getGame(id), getCommands(id, 0)])
      head = slice.head.seq
      status.value = 'ready'
      return { game, head, commands: slice.commands }
    }
    catch (error) {
      if (error instanceof ApiError && error.isMissing) {
        status.value = 'missing'
        problem.value = 'there is no game with that id'
      }
      else {
        status.value = 'offline'
        problem.value = error instanceof ApiError
          ? `the server answered ${error.status}`
          : 'the server could not be reached'
      }
      return null
    }
  }

  async function submit(effects: readonly LogEntry[]): Promise<readonly LogEntry[] | null> {
    if (status.value === 'diverged') return null
    // An empty turn is not worth a row. Cancelling a placement produces one.
    if (effects.length === 0) return []

    const turn = { cmdId: newCommandId(), prevSeq: head, effects }
    status.value = 'saving'

    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        const result = await submitCommand(gameId, turn, token)
        head = result.command.seq
        status.value = 'ready'
        /*
         * `effects` are this client's own and are already on its board; applying them again would
         * double every move. Only what the server added is new.
         *
         * A recognised retry takes the same path on purpose: the row it returns is the one this
         * client wrote, so its response is still exactly the part that was never applied.
         */
        return result.command.response
      }
      catch (error) {
        if (!(error instanceof ApiError)) {
          // The request never landed. Resend it — the command id makes that safe.
          if (attempt < RETRIES - 1) {
            await pause(RETRY_PAUSE_MS)
            continue
          }
          status.value = 'offline'
          problem.value = 'the server could not be reached'
          return null
        }
        if (error.isStale) return diverge('another window changed this game')
        if (error.isRefused) return diverge('the server would not accept that move')
        if (error.isMissing) return diverge('this game is no longer on the server')
        return diverge(`the server answered ${error.status}`)
      }
    }

    return null
  }

  return { status: () => status.value, problem: () => problem.value, load, submit }
}
