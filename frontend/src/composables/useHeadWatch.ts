/**
 * Notices when a game's log moves, by socket if it can and by asking if it cannot.
 *
 * ## Two mechanisms, one meaning
 *
 * Both answer the same question — *has the head moved past what I have?* — and both answer it with a
 * number. Neither carries game data: the caller fetches through the ordinary endpoint, so there is
 * one path out of the server for commands and it is the one that is already tested.
 *
 * That is what makes the socket safe to be unreliable. It is an **optimisation, never a source of
 * truth**: if it never connects, or dies without saying so, the poll underneath still finds the same
 * move a second or two later. Nothing is lost, so nothing is acknowledged, replayed or resent.
 *
 * The poll therefore does not stop when the socket connects. A socket that is open but silently
 * broken — a proxy that dropped it, a laptop that slept — is indistinguishable from a quiet game,
 * and the failure mode of trusting it is a player sitting for ever in front of a board that has
 * moved on. It slows down instead, which costs a request a few seconds and removes the whole class
 * of problem.
 */
import { shallowRef } from 'vue'

/** How often to ask when the socket is not carrying the load. */
const POLL_EAGER_MS = 2000

/** And once it is. Rare enough to be nearly free, often enough to catch a socket that has died. */
const POLL_BACKSTOP_MS = 15_000

/** Reconnection backoff, in milliseconds, then repeating at the last value. */
const RETRY_MS = [500, 1000, 2000, 5000, 10_000]

export interface HeadWatch {
  /** True while a socket is carrying the notifications. Polling continues regardless. */
  readonly live: () => boolean
  stop: () => void
}

function socketUrl(gameId: string): string {
  const base = import.meta.env.VITE_API_BASE ?? ''
  const origin = base || globalThis.location.origin
  return `${origin.replace(/^http/, 'ws')}/watch?game=${encodeURIComponent(gameId)}`
}

/**
 * Watch a game, calling `moved` whenever the head might have advanced.
 *
 * `moved` is called on a bare notification, not with the new commands — it is a nudge to go and
 * look. It may be called when nothing has changed; a caller that refetches from its own cursor finds
 * nothing and carries on, which is cheaper than making this side certain.
 */
export function watchHead(gameId: string, moved: () => void): HeadWatch {
  const live = shallowRef(false)
  let socket: WebSocket | null = null
  let poll: ReturnType<typeof setTimeout> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let stopped = false

  function schedulePoll(): void {
    if (poll !== null) clearTimeout(poll)
    if (stopped) return
    poll = setTimeout(() => {
      moved()
      schedulePoll()
    }, live.value ? POLL_BACKSTOP_MS : POLL_EAGER_MS)
  }

  function connect(): void {
    if (stopped) return
    try {
      socket = new WebSocket(socketUrl(gameId))
    }
    catch {
      // No socket support, or a blocked scheme. The poll is already running and is enough.
      return
    }

    socket.onopen = () => {
      attempt = 0
      live.value = true
      socket?.send(JSON.stringify({ watch: gameId }))
      // Re-pace the poll now that something faster is carrying it.
      schedulePoll()
    }

    /*
     * The message is `{ gameId, seq }` and neither field is read. Anything arriving on this socket
     * means "go and look", and the caller's own cursor decides whether there is anything to see —
     * so a stale or duplicated notification costs one request and cannot mislead.
     */
    socket.onmessage = () => moved()

    socket.onclose = () => {
      live.value = false
      socket = null
      schedulePoll()
      if (stopped) return
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!
      attempt++
      retry = setTimeout(connect, wait)
    }

    // `onerror` is always followed by `onclose`, so reconnection is handled in one place.
    socket.onerror = () => { live.value = false }
  }

  schedulePoll()
  connect()

  return {
    live: () => live.value,
    stop() {
      stopped = true
      if (poll !== null) clearTimeout(poll)
      if (retry !== null) clearTimeout(retry)
      // Detached first: closing fires `onclose`, which would otherwise queue a reconnection.
      const open = socket
      socket = null
      open?.close()
      live.value = false
    },
  }
}
