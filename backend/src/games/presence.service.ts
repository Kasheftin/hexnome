import { Injectable } from '@nestjs/common'

/**
 * Who is still at the table.
 *
 * ## Not part of the game, and deliberately not stored like one
 *
 * A log is what happened at the table. Somebody's browser being open is not that, so presence is not
 * a command, is not folded, and is not written anywhere. It lives here, in this process, for as long
 * as the process does — and after a restart nobody is known to be present until they next say so,
 * which is a poll away and true in the meantime.
 *
 * ## Nobody is asked to report it
 *
 * There is no heartbeat, because there was already one. Every client refetches `GET /games/:id` on
 * every watch tick — 2s without a socket, 15s with one — and that request carries the seat token,
 * because it is how a client learns which seat is its own. So the server is told *this token is
 * still here* by every player, at worst every fifteen seconds, without anybody adding a timer.
 * `GamesService.viewOf` is where that is noticed.
 *
 * The socket stays out of it. `HeadsGateway` accepts no credential at all — a socket that can ask
 * for nothing cannot be asked to disclose anything — and it does not know which seat is on the other
 * end. Keeping it that way is worth more than a faster red icon.
 */
@Injectable()
export class PresenceService {
  /** gameId → seat → when it was last heard from, in epoch millis. */
  private readonly heard = new Map<string, Map<number, number>>()

  /**
   * Where the time comes from, replaceable so a spec can move it instead of sleeping through ninety
   * seconds.
   *
   * A field rather than a constructor parameter, and that is not a style choice: Nest reads the
   * constructor's types to decide what to inject, and a bare `() => number` is a `Function` it
   * cannot resolve — a default value does not save it, and the container refuses to build the module
   * at all. Unit tests construct the class themselves and would never have noticed.
   *
   * A clock is exactly the sort of thing the rules package may not touch, because a fold must give
   * the same answer twice. This is not the rules; presence is a fact about *now* and nothing else.
   */
  clock: () => number = Date.now

  /** Heard from. Called once per authenticated read of a game, which is often enough. */
  seen(gameId: string, seat: number): void {
    const at = this.clock()
    const game = this.heard.get(gameId) ?? new Map<number, number>()

    // Swept as it is written, so a table that keeps playing never carries seats that left it.
    for (const [other, when] of game) {
      if (other !== seat && at - when > PRESENT_MS) game.delete(other)
    }
    game.set(seat, at)

    /*
     * Re-set so this game becomes the newest key. A `Map` iterates in insertion order, which makes
     * the eviction below oldest-first for nothing — the same trick `useSeat` uses on the client.
     */
    this.heard.delete(gameId)
    this.heard.set(gameId, game)

    /*
     * A game nobody ever opens again would otherwise sit here for the life of the process. Bounded
     * rather than swept on a timer: a cap needs no scheduling and cannot fall behind.
     */
    while (this.heard.size > MAX_GAMES) {
      const oldest = this.heard.keys().next().value
      if (oldest === undefined) break
      this.heard.delete(oldest)
    }
  }

  /** The seats heard from recently enough to call present. */
  online(gameId: string): ReadonlySet<number> {
    const game = this.heard.get(gameId)
    if (!game) return EMPTY

    const at = this.clock()
    const present = new Set<number>()
    for (const [seat, when] of game) {
      if (at - when <= PRESENT_MS) present.add(seat)
    }
    return present
  }

  /** How many games are remembered. For the specs; nothing in the app asks. */
  get size(): number {
    return this.heard.size
  }

  /**
   * How many seats are held for a game, fresh or stale. For the specs; nothing in the app asks.
   *
   * `online` cannot answer this. It filters by age, so a seat that was swept and a seat that merely
   * went quiet look identical through it — which is exactly the difference between forgetting a
   * departed player and carrying them for the life of the process.
   */
  remembered(gameId: string): number {
    return this.heard.get(gameId)?.size ?? 0
  }
}

/**
 * How long a seat stays present after its last word.
 *
 * Ninety seconds rather than the thirty or forty-five that the fifteen-second poll would suggest,
 * because browsers throttle timers in **hidden tabs** to roughly one a minute. A player who switched
 * tabs while waiting for their turn is still at the table, and calling them absent is the worse of
 * the two errors available: *offline* should mean gone, not looking elsewhere.
 *
 * The price is that a closed tab takes about this long, plus one poll, to show as away.
 */
const PRESENT_MS = 90_000

/** How many games to remember at once. Far above any real table count; this is a leak stop. */
const MAX_GAMES = 500

const EMPTY: ReadonlySet<number> = new Set()
