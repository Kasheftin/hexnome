import { shallowRef } from 'vue'
import type { CommandRow, PlayerCommand } from '@hexnome/rules/wire'
import { ApiError } from '@/api/base'
import { getCommands, submitCommand } from '@/api/games'
import { seatToken } from '@/composables/useSeat'

/**
 * A game's log, over the wire: what has happened, and how to add to it.
 *
 * ## Nothing here is optimistic
 *
 * A turn is submitted and *then* applied, from the rows that come back. The board already waits half
 * a second for pieces to fly, so a round trip hides inside an animation that was there anyway — and
 * skipping optimism skips the whole apparatus that goes with it: no rollback, no reconciliation, no
 * state that is nearly true. The server's answer is the only thing this end ever applies, whoever
 * played the turn.
 *
 * That also means there is one path by which a command reaches the board, and every client uses it.
 * A turn of your own and a turn of somebody else's differ in nothing but which request fetched them.
 *
 * ## The cursor, and the two races around it
 *
 * `cursor` is the last `seq` this client holds, and it is what a new turn names as its `prevSeq`.
 * Two things can go wrong with it, and both actually happened in attempt 1:
 *
 * - **A socket notification can beat its own HTTP response.** The server announces a command when it
 *   is stored, which can reach this browser before the reply to the request that made it. A catch-up
 *   would then fetch that command, hand it over, and the reply would deliver it again a moment
 *   later. So catch-up stands aside entirely while a submit is in flight.
 * - **The cursor can move while a fetch is in the air.** So what comes back is filtered against the
 *   cursor *as it stands when the answer arrives*, not as it was when the question went out.
 */

export type SyncFailure = 'unreachable' | 'stale' | 'refused'

export interface SubmitOutcome {
  /** Rows to fold, oldest first. Empty on a failure. */
  readonly commands: readonly CommandRow[]
  /** Why it did not land. Absent when it did. */
  readonly failure?: SyncFailure
  /** What to tell the player, when there is something worth telling them. */
  readonly message?: string
}

export interface GameSync {
  /** Every command from the beginning. For a page arriving at a game already in progress. */
  load: () => Promise<readonly CommandRow[]>
  /** Anything new since the last fetch. Empty most of the time, and cheap to ask. */
  catchUp: () => Promise<readonly CommandRow[]>
  /** Take a turn. The rows that come back are the turn *and* anything the server added behind it. */
  submit: (command: PlayerCommand) => Promise<SubmitOutcome>
  /** Where this client's copy of the log ends. */
  at: () => number
}

/** How many times to resend a turn that never reached the server. Beyond this it is not the network. */
const ATTEMPTS = 3
const RETRY_MS = 400

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * A fresh id per turn, stable across resends of that turn.
 *
 * It is what lets a lost response be sent again safely: the server recognises the id and hands back
 * the rows it already wrote rather than writing a second turn. `randomUUID` is unavailable outside a
 * secure context, and this is not a secret — a collision costs one refused turn, not a leak.
 */
function newCommandId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function useGameSync(gameId: string): GameSync {
  const cursor = shallowRef(0)
  let submitting = false

  /** Keep only what is genuinely new, and move the cursor past it. */
  function take(rows: readonly CommandRow[]): readonly CommandRow[] {
    const fresh = rows.filter(row => row.seq > cursor.value)
    for (const row of fresh) cursor.value = Math.max(cursor.value, row.seq)
    return fresh
  }

  return {
    at: () => cursor.value,

    async load() {
      const slice = await getCommands(gameId, 0)
      cursor.value = 0
      return take(slice.commands)
    },

    async catchUp() {
      // Standing aside, not queueing: a turn in flight will deliver its own rows, and fetching them
      // first would apply them twice.
      if (submitting) return []
      try {
        const slice = await getCommands(gameId, cursor.value)
        /*
         * The head is taken as well as the rows. A game can move without this client having anything
         * new to fetch — somebody else's turn that we already hold — and the cursor should not lag
         * behind it, because the next turn has to name the real head as its parent.
         */
        const fresh = take(slice.commands)
        cursor.value = Math.max(cursor.value, slice.head.seq)
        return fresh
      } catch {
        // On a timer, and a flaky network is not worth a banner. The next tick tries again.
        return []
      }
    },

    async submit(command) {
      submitting = true
      const turn = { cmdId: newCommandId(), prevSeq: cursor.value, command }
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            const result = await submitCommand(gameId, turn, seatToken(gameId))
            return { commands: take(result.commands) }
          } catch (error) {
            if (!(error instanceof ApiError)) throw error
            /*
             * Only a request that never landed is worth sending again. Anything the server answered
             * — stale, refused, forbidden — will be answered the same way a second time, and the
             * `cmdId` means a resend of a turn that *did* land is safe rather than necessary.
             */
            if (!error.isUnreachable || attempt === ATTEMPTS) return failure(error)
            await pause(RETRY_MS)
          }
        }
      } finally {
        submitting = false
      }
    },
  }
}

function failure(error: ApiError): SubmitOutcome {
  if (error.isStale) {
    return { commands: [], failure: 'stale', message: 'Somebody moved first. Catching up…' }
  }
  if (error.isRefused) {
    return { commands: [], failure: 'refused', message: error.message }
  }
  return { commands: [], failure: 'unreachable', message: 'Cannot reach the table.' }
}
