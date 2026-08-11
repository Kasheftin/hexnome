import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { WATCH_PATH } from '../apiPrefix'
import { HeadsGateway } from './heads.gateway'

/**
 * The gateway, over real sockets.
 *
 * Mocking `ws` would test the mock. What is worth knowing here is what actually happens on a wire:
 * that a subscriber is reached and a stranger is not, that a closed socket leaves no room behind,
 * and above all that **nothing but the number goes out**. That last one is the reason this file
 * exists — it is a leak test, and a leak test against a fake proves nothing.
 */

let http: Server
let heads: HeadsGateway
let port: number
const open: WebSocket[] = []

/** A client that has said which game it is watching, and is ready to be sent to. */
async function watcher(gameId: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${WATCH_PATH}`)
  open.push(socket)
  await new Promise<void>(resolve => socket.once('open', () => resolve()))
  /*
   * The subscription is a message, so it lands a tick after the send. Wait for the room to have
   * *grown* rather than merely to be non-empty: the second watcher of a game would otherwise see the
   * first one's entry and return before the server had filed its own. A sleep would be flaky on a
   * loaded machine; this is exact.
   */
  const before = heads.watchers(gameId)
  socket.send(JSON.stringify({ watch: gameId }))
  await until(() => heads.watchers(gameId) > before)
  return socket
}

/** The next message, or null if none arrives within `ms`. Absence is a result worth asserting. */
function heard(socket: WebSocket, ms = 250): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    socket.once('message', (raw) => {
      clearTimeout(timer)
      resolve(raw.toString())
    })
  })
}

async function until(ready: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

beforeEach(async () => {
  heads = new HeadsGateway()
  http = createServer()
  heads.attach(http)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()))
  const address = http.address()
  port = typeof address === 'object' && address !== null ? address.port : 0
})

afterEach(async () => {
  for (const socket of open.splice(0)) socket.close()
  await heads.onModuleDestroy()
  await new Promise<void>(resolve => http.close(() => resolve()))
})

describe('telling watchers a game moved', () => {
  it('reaches a socket watching that game', async () => {
    const socket = await watcher('game-a')
    heads.moved('game-a', 7)

    expect(await heard(socket)).toBe(JSON.stringify({ gameId: 'game-a', seq: 7 }))
  })

  /* The message is the whole disclosure, so this is what stops the next field being added lightly. */
  it('says the game and the number, and nothing else', async () => {
    const socket = await watcher('game-a')
    heads.moved('game-a', 3)

    const said = JSON.parse((await heard(socket)) ?? '{}') as Record<string, unknown>
    expect(Object.keys(said).sort()).toEqual(['gameId', 'seq'])
  })

  it('does not reach a socket watching a different game', async () => {
    const elsewhere = await watcher('game-b')
    heads.moved('game-a', 1)

    expect(await heard(elsewhere)).toBeNull()
  })

  it('does not reach a socket that has not said what it is watching', async () => {
    const silent = new WebSocket(`ws://127.0.0.1:${port}${WATCH_PATH}`)
    open.push(silent)
    await new Promise<void>(resolve => silent.once('open', () => resolve()))
    heads.moved('game-a', 1)

    expect(await heard(silent)).toBeNull()
  })

  it('reaches every watcher of one game', async () => {
    const [first, second] = [await watcher('game-a'), await watcher('game-a')]
    const both = Promise.all([heard(first), heard(second)])
    heads.moved('game-a', 9)

    expect(await both).toEqual([
      JSON.stringify({ gameId: 'game-a', seq: 9 }),
      JSON.stringify({ gameId: 'game-a', seq: 9 }),
    ])
  })

  it('is quiet about a game nobody is watching', () => {
    expect(() => heads.moved('nobody-here', 1)).not.toThrow()
  })
})

describe('rooms', () => {
  it('forgets a socket that closed', async () => {
    const socket = await watcher('game-a')
    socket.close()

    await until(() => heads.watchers('game-a') === 0)
    expect(heads.watchers('game-a')).toBe(0)
  })

  it('moves a socket that changes which game it watches', async () => {
    const socket = await watcher('game-a')
    socket.send(JSON.stringify({ watch: 'game-b' }))
    await until(() => heads.watchers('game-b') > 0)

    expect(heads.watchers('game-a')).toBe(0)
    heads.moved('game-b', 4)
    expect(await heard(socket)).toContain('game-b')
  })

  /* The inbound vocabulary is one word. Anything else must not subscribe a socket to anything. */
  it('ignores anything that is not a subscription', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${WATCH_PATH}`)
    open.push(socket)
    await new Promise<void>(resolve => socket.once('open', () => resolve()))

    for (const nonsense of ['', 'not json', '{}', '{"watch":42}', '{"watch":""}', '[1,2,3]']) {
      socket.send(nonsense)
    }
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(heads.watchers('game-a')).toBe(0)
    expect(socket.readyState).toBe(WebSocket.OPEN)
  })
})
