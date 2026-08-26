/**
 * Deal a finished game again, and go and sit at the new one.
 *
 * Two screens offer this — the panel at the end of a game, and a row on a high score board — and the
 * five steps between pressing and arriving are the same both times: ask the server for a copy, keep
 * the seat it hands back, remember the table so the menu can offer a way in, and route on the status
 * rather than on a guess about which kinds of game have lobbies.
 *
 * **Nothing about the deal passes through here.** The server reads both seeds off the row being
 * repeated, so there is nothing for a caller to get wrong or to tamper with; this only carries an id
 * out and a seat back.
 *
 * `pending` is the *id* being repeated rather than a flag, because a board shows a dozen of these at
 * once and a boolean would put every row in a spinner over one press.
 */
import { shallowRef, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { cloneGame } from '@/api/games'
import { rememberCurrentGame } from '@/composables/currentGame'
import { playerName } from '@/composables/playerName'
import { rememberSeat } from '@/composables/useSeat'

export interface RepeatGame {
  /** The game currently being dealt again, or null. */
  readonly pending: Ref<string | null>
  /** Throws what the API threw, so each screen can say it in its own words. */
  repeat: (id: string) => Promise<void>
}

export function useRepeatGame(): RepeatGame {
  const router = useRouter()
  const pending = shallowRef<string | null>(null)

  async function repeat(id: string): Promise<void> {
    if (pending.value !== null) return
    pending.value = id
    try {
      const claim = await cloneGame(id, playerName())
      // Before navigating, or the creator arrives at their own table as a spectator.
      rememberSeat(claim.game.id, { seat: claim.seat, token: claim.token })
      rememberCurrentGame(claim.game.id)
      await router.push({
        /*
         * Read off the answer rather than decided here. A solo game comes back already `running`,
         * because its only seat was claimed in the same request; a table comes back `waiting` with
         * chairs to fill. Guessing from the seat count would be a second opinion about something the
         * server has already settled.
         */
        path: claim.game.status === 'waiting' ? '/join' : '/game',
        query: { id: claim.game.id },
      })
    } finally {
      pending.value = null
    }
  }

  return { pending, repeat }
}
