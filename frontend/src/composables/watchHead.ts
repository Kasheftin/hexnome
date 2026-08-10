/**
 * Notices when a game has moved, by socket if it can and by asking if it cannot.
 *
 * ## Two mechanisms, one meaning
 *
 * Both answer the same question — *has this game moved past what I hold?* — and neither carries game
 * data. The caller refetches through the ordinary endpoint, so there is one path out of the server
 * and it is the one that is already tested.
 *
 * That is what makes the socket safe to be unreliable. It is an **optimisation, never a source of
 * truth**: if it never connects, or dies without saying so, the poll underneath finds the same move a
 * second or two later. Nothing is lost, so nothing is acknowledged, replayed or resent.
 *
 * The poll therefore does not stop when the socket connects. A socket that is open but silently
 * broken — a proxy that dropped it, a laptop that slept — is indistinguishable from a quiet game, and
 * the failure mode of trusting it is a player sitting for ever in front of a table that has filled up.
 * It slows down instead, which costs a request every fifteen seconds and removes the whole class of
 * problem.
 */

/** How often to ask when the socket is not carrying the load. */
const POLL_EAGER_MS = 2000

/** And once it is. Rare enough to be nearly free, often enough to catch a socket that has died. */
const POLL_BACKSTOP_MS = 15_000

/** Reconnection backoff, in milliseconds, then repeating at the last value. */
const RETRY_MS = [500, 1000, 2000, 5000, 10_000]

/**
 * How far the game has moved, if the notification knew — and null when it did not.
 *
 * A socket message carries the number; a poll tick is only a reminder to look. The caller uses the
 * difference: a number it already has means there is nothing to fetch, while `null` means "no idea,
 * go and check", which is the backstop doing its job.
 */
export type Moved = (seq: number | null) => void

export interface HeadWatch {
  /** True while a socket is carrying the notifications. Polling continues regardless. */
  readonly live: () => boolean
  stop: () => void
}

/** The `seq` out of a socket message, or null if it is not one we can read. */
function seqOf(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  try {
    const message = JSON.parse(raw) as { seq?: unknown }
    return typeof message?.seq === 'number' ? message.seq : null
  } catch {
    return null
  }
}

function socketUrl(gameId: string): string {
  const origin = globalThis.location.origin.replace(/^http/, 'ws')
  return `${origin}/watch?game=${encodeURIComponent(gameId)}`
}

/**
 * Watch a game, calling `moved` whenever it might have.
 *
 * `moved` is a nudge to go and look, not a delivery. It may be called when nothing has changed; a
 * caller that compares what comes back with what it holds finds nothing and carries on, which is
 * cheaper than making this side certain.
 */
export function watchHead(gameId: string, moved: Moved): HeadWatch {
  let socket: WebSocket | null = null
  let live = false
  let poll: ReturnType<typeof setTimeout> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let stopped = false

  function schedulePoll(): void {
    if (poll !== null) clearTimeout(poll)
    if (stopped) return
    poll = setTimeout(() => {
      // No number: a poll knows only that time has passed.
      moved(null)
      schedulePoll()
    }, live ? POLL_BACKSTOP_MS : POLL_EAGER_MS)
  }

  function connect(): void {
    if (stopped) return
    try {
      socket = new WebSocket(socketUrl(gameId))
    } catch {
      // No socket support, or a blocked scheme. The poll is already running and is enough.
      return
    }

    socket.onopen = () => {
      attempt = 0
      live = true
      socket?.send(JSON.stringify({ watch: gameId }))
      // Re-pace the poll now that something faster is carrying it.
      schedulePoll()
    }

    /*
     * The message is `{ gameId, seq }`. The number is passed on so the caller can skip a fetch it
     * does not need; anything unreadable is treated as a bare nudge, because a message that arrived
     * at all means something happened. A stale or duplicated notification costs one comparison.
     */
    socket.onmessage = event => moved(seqOf(event.data))

    socket.onclose = () => {
      live = false
      socket = null
      schedulePoll()
      if (stopped) return
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] as number
      attempt++
      retry = setTimeout(connect, wait)
    }

    // `onerror` is always followed by `onclose`, so reconnection is handled in one place.
    socket.onerror = () => { live = false }
  }

  schedulePoll()
  connect()

  return {
    live: () => live,
    stop() {
      stopped = true
      if (poll !== null) clearTimeout(poll)
      if (retry !== null) clearTimeout(retry)
      // Detached before closing: `onclose` would otherwise schedule a reconnect on the way out.
      if (socket) {
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        socket.close()
      }
      socket = null
      live = false
    },
  }
}
