import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'

/**
 * Tells watchers that a game has moved, and nothing else.
 *
 * ## It broadcasts a number, not the game
 *
 * The whole message is `{ gameId, seq }`. A sequence number says "there is something new" and
 * discloses nothing — not who joined, not what they chose, and above all not the seed. Clients then
 * fetch through `GET /games/:id` exactly as they do without a socket.
 *
 * That is deliberate and worth keeping. Pushing the game itself would mean a second path out of the
 * server carrying game data, which would have to grow its own idea of what a given client may see —
 * and the first bug in it would leak something. Here there is one such path, already written and
 * already tested, and the socket is only a nudge towards it.
 *
 * The consequence is that **the socket is an optimisation, never a source of truth**. A client that
 * never connects, or whose connection dies unnoticed, is only as slow as its polling. Nothing is
 * lost, so nothing needs replaying or acknowledging.
 *
 * ## Rooms are a `Set` per game
 *
 * No presence, no membership list, no lifecycle: a socket says which game it is watching and is
 * dropped from the set when it closes. Anything more would be state to keep correct, and a stale
 * entry here would matter — it is the difference between a quiet game and a dead one.
 */
@Injectable()
export class HeadsGateway implements OnModuleDestroy {
  private server: WebSocketServer | null = null

  /** gameId → the sockets watching it. */
  private readonly rooms = new Map<string, Set<WebSocket>>()

  /**
   * Attach to the HTTP server already listening.
   *
   * Shares the port, so the Vite proxy and any production host need no second route and no second
   * certificate — a socket is an upgrade of a request that was already going to be allowed.
   */
  attach(http: Server): void {
    this.server = new WebSocketServer({ server: http, path: '/watch' })

    this.server.on('connection', (socket) => {
      let watching: string | null = null

      socket.on('message', (raw) => {
        const gameId = readSubscription(raw.toString())
        if (!gameId || gameId === watching) return
        this.leave(watching, socket)
        watching = gameId
        this.join(gameId, socket)
      })

      const drop = (): void => {
        this.leave(watching, socket)
        watching = null
      }
      socket.on('close', drop)
      // A socket that errored is gone whether or not `close` follows, and a set of dead sockets is a
      // slow leak in a process that stays up for weeks.
      socket.on('error', drop)
    })
  }

  /** Say that a game moved. Called after the write is safely stored, never before. */
  moved(gameId: string, seq: number): void {
    const room = this.rooms.get(gameId)
    if (!room) return
    const message = JSON.stringify({ gameId, seq })
    for (const socket of room) {
      // OPEN only. A socket mid-close throws on send, and one bad watcher must not fail the others.
      if (socket.readyState === socket.OPEN) socket.send(message)
    }
  }

  /** How many sockets are watching a game. For the specs; nothing in the app asks. */
  watchers(gameId: string): number {
    return this.rooms.get(gameId)?.size ?? 0
  }

  async onModuleDestroy(): Promise<void> {
    this.rooms.clear()
    await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()))
  }

  private join(gameId: string, socket: WebSocket): void {
    const room = this.rooms.get(gameId) ?? new Set<WebSocket>()
    room.add(socket)
    this.rooms.set(gameId, room)
  }

  private leave(gameId: string | null, socket: WebSocket): void {
    if (!gameId) return
    const room = this.rooms.get(gameId)
    if (!room) return
    room.delete(socket)
    if (room.size === 0) this.rooms.delete(gameId)
  }
}

/**
 * The only thing a client may say: which game it is watching.
 *
 * Deliberately the entire inbound vocabulary. A socket that can ask for nothing cannot be asked to
 * disclose anything, so this end needs no authentication — watching is public, and a game id is
 * already the capability to read one.
 */
function readSubscription(raw: string): string | null {
  try {
    const message: unknown = JSON.parse(raw)
    const watch = (message as { watch?: unknown })?.watch
    return typeof watch === 'string' && watch.length > 0 && watch.length <= 64 ? watch : null
  } catch {
    return null
  }
}
