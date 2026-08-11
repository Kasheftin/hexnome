import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandRow } from '@hexnome/rules/wire'
import { useGameSync } from './useGameSync'

/**
 * The cursor, and the two races around it.
 *
 * Fetching and posting are a `fetch` and a JSON parse, and testing those tests `fetch`. What is worth
 * pinning is the arithmetic nobody can see going wrong: a command applied twice is invisible for a
 * draft and reads as two rounds ending at once for a pass, which is how it was found in attempt 1.
 */

interface Call { readonly path: string, readonly body: Record<string, unknown> | null }

let calls: Call[]
let answer: (path: string) => unknown
let settle: Array<() => void>

function row(seq: number, prevSeq: number): CommandRow {
  return { seq, prevSeq, author: 0, cmdId: `c${seq}`, command: { kind: 'pass', seat: 0 } }
}

/** A fetch that records what it was asked and answers whatever the test has set up. */
function stubFetch({ hold = false } = {}): void {
  calls = []
  settle = []
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null })
    const reply = { ok: true, json: () => Promise.resolve(answer(path)) } as Response
    if (!hold) return Promise.resolve(reply)
    return new Promise<Response>(resolve => settle.push(() => resolve(reply)))
  })
}

const tick = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

async function drain(): Promise<void> {
  await tick()
  while (settle.length) {
    (settle.shift() as () => void)()
    await tick()
  }
}

beforeEach(() => stubFetch())
afterEach(() => { vi.unstubAllGlobals() })

describe('loading', () => {
  it('asks for everything and takes the cursor to the end', async () => {
    answer = () => ({ since: 0, head: { seq: 7 }, commands: [row(4, 0), row(7, 4)] })
    const sync = useGameSync('a-game')

    expect((await sync.load()).map(r => r.seq)).toEqual([4, 7])
    expect(sync.at()).toBe(7)
    expect(calls[0]?.path).toBe('/api/games/a-game/commands?since=0')
  })
})

describe('catching up', () => {
  it('asks from the cursor, and moves it', async () => {
    // Path-aware, because the load and the catch-up are two different questions and answering both
    // with one slice would have the catch-up hand back what the load already took.
    answer = path => path.endsWith('since=0')
      ? { since: 0, head: { seq: 7 }, commands: [row(7, 0)] }
      : { since: 7, head: { seq: 9 }, commands: [row(9, 7)] }
    const sync = useGameSync('a-game')
    await sync.load()
    calls.length = 0

    expect((await sync.catchUp()).map(r => r.seq)).toEqual([9])
    expect(calls[0]?.path).toBe('/api/games/a-game/commands?since=7')
    expect(sync.at()).toBe(9)
  })

  it('hands back nothing when there is nothing', async () => {
    answer = () => ({ since: 7, head: { seq: 7 }, commands: [] })
    const sync = useGameSync('a-game')
    await sync.load()

    expect(await sync.catchUp()).toEqual([])
    expect(sync.at()).toBe(7)
  })

  /**
   * The head moves even when this client has nothing to fetch.
   *
   * Somebody else's turn that we already hold still advances the chain, and the next turn from here
   * has to name the real head as its parent — a cursor left behind would be answered with a 409.
   */
  it('takes the head even with no new rows', async () => {
    answer = () => ({ since: 0, head: { seq: 12 }, commands: [] })
    const sync = useGameSync('a-game')

    await sync.catchUp()
    expect(sync.at()).toBe(12)
  })

  it('says nothing about a network that is down', async () => {
    const sync = useGameSync('a-game')
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    await expect(sync.catchUp()).resolves.toEqual([])
  })
})

describe('submitting', () => {
  it('names the cursor as the parent, and sends no seat of its own', async () => {
    answer = (path) => path.includes('?since=')
      ? { since: 0, head: { seq: 4 }, commands: [row(4, 0)] }
      : { commands: [row(5, 4)], duplicate: false }
    const sync = useGameSync('a-game')
    await sync.load()
    calls.length = 0

    await sync.submit({ kind: 'pass', seat: 0 })

    expect(calls[0]?.path).toBe('/api/games/a-game/commands')
    expect(calls[0]?.body).toMatchObject({ prevSeq: 4, command: { kind: 'pass', seat: 0 } })
    expect(calls[0]?.body).not.toHaveProperty('seat')
    expect(calls[0]?.body?.cmdId).toEqual(expect.any(String))
  })

  it('hands back the rows the server wrote, and moves the cursor past them', async () => {
    answer = () => ({ commands: [row(5, 4), row(6, 5)], duplicate: false })
    const sync = useGameSync('a-game')

    const outcome = await sync.submit({ kind: 'pass', seat: 0 })

    expect(outcome.commands.map(r => r.seq)).toEqual([5, 6])
    expect(outcome.failure).toBeUndefined()
    expect(sync.at()).toBe(6)
  })

  /**
   * The race attempt 1 found: a socket notification beating its own response.
   *
   * The server announces a command when it is stored, which can reach the browser before the reply
   * to the request that made it. A catch-up in that window would fetch the turn, hand it over, and
   * the reply would deliver it a second time.
   */
  it('stands aside while a turn is in flight', async () => {
    stubFetch({ hold: true })
    answer = () => ({ commands: [row(5, 4)], duplicate: false })
    const sync = useGameSync('a-game')

    const submitted = sync.submit({ kind: 'pass', seat: 0 })
    await tick()
    const meanwhile = await sync.catchUp()

    expect(meanwhile).toEqual([])
    // And exactly one request went out: the catch-up did not even ask.
    expect(calls).toHaveLength(1)
    await drain()
    expect((await submitted).commands.map(r => r.seq)).toEqual([5])
  })

  /**
   * The other half of the same race, for the fetch that *is* allowed out.
   *
   * A cursor can move while an answer is in the air, so what comes back is filtered against the
   * cursor as it stands on arrival rather than as it was when the question was asked.
   */
  it('drops rows the cursor has already passed', async () => {
    answer = () => ({ since: 0, head: { seq: 9 }, commands: [row(4, 0), row(9, 4)] })
    const sync = useGameSync('a-game')
    await sync.load()

    // The same slice again — an overlapping answer, which a stale cursor would replay.
    expect(await sync.catchUp()).toEqual([])
    expect(sync.at()).toBe(9)
  })
})

describe('when a turn does not land', () => {
  function refuse(status: number, message: string): void {
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null })
      return Promise.resolve({ ok: false, status, json: () => Promise.resolve({ message }) } as Response)
    })
  }

  it('reports a refusal in the server´s own words, and does not retry it', async () => {
    calls = []
    refuse(422, 'that cannot be paid for')
    const sync = useGameSync('a-game')

    const outcome = await sync.submit({ kind: 'pass', seat: 0 })

    expect(outcome).toMatchObject({ failure: 'refused', message: 'that cannot be paid for' })
    expect(calls).toHaveLength(1)
  })

  it('reports a stale turn as somebody having moved first', async () => {
    calls = []
    refuse(409, 'the log has moved on since you last read it')
    const sync = useGameSync('a-game')

    expect((await sync.submit({ kind: 'pass', seat: 0 })).failure).toBe('stale')
  })

  /**
   * Only a request that never landed is worth sending again — and it is safe to, because the `cmdId`
   * is stable across the attempts, so a server that did receive the first one hands back the rows it
   * already wrote rather than writing a second turn.
   */
  it('resends a request that never arrived, under one command id', async () => {
    calls = []
    let attempts = 0
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      attempts++
      return attempts < 3
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ commands: [row(5, 0)], duplicate: false }) } as Response)
    })
    const sync = useGameSync('a-game')

    const outcome = await sync.submit({ kind: 'pass', seat: 0 })

    expect(outcome.commands.map(r => r.seq)).toEqual([5])
    expect(calls).toHaveLength(3)
    expect(new Set(calls.map(call => call.body?.cmdId)).size).toBe(1)
  })

  it('gives up after three tries at a table that is not answering', async () => {
    calls = []
    vi.stubGlobal('fetch', (path: string) => {
      calls.push({ path, body: null })
      return Promise.reject(new Error('offline'))
    })
    const sync = useGameSync('a-game')

    expect((await sync.submit({ kind: 'pass', seat: 0 })).failure).toBe('unreachable')
    expect(calls).toHaveLength(3)
  })

  /** A failed turn must not silence the next one — the flag has to come off on every path. */
  it('lets a catch-up through again after a turn failed', async () => {
    calls = []
    refuse(422, 'no')
    const sync = useGameSync('a-game')
    await sync.submit({ kind: 'pass', seat: 0 })

    stubFetch()
    answer = () => ({ since: 0, head: { seq: 3 }, commands: [row(3, 0)] })
    expect((await sync.catchUp()).map(r => r.seq)).toEqual([3])
  })
})
