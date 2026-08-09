import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesk } from './useDesk'

/**
 * The queue, which is the only thing in this file with behaviour of its own.
 *
 * Everything else is a fetch and a JSON parse. The ordering is what would fail rarely, in play, and
 * unreproducibly — the server's answer depends on the order requests arrive in, so a discard that
 * overtakes a draw reshuffles a pile that should not exist yet.
 */

interface Call { readonly path: string, readonly body: Record<string, unknown> }

let calls: Call[]
let settle: Array<() => void>

/** A fetch that records what it was asked and hands back a promise the test decides when to resolve. */
function stubFetch(): void {
  calls = []
  settle = []
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ path, body })
    return new Promise<Response>(resolve => {
      settle.push(() => resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'desk-1', remaining: 30, codes: [11, 12] }),
      } as Response))
    })
  })
}

/** Let every queued continuation run. A macrotask, so nothing microtask-scheduled is left pending. */
const tick = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

/**
 * Answer every request in flight, oldest first, letting the next one go out between each.
 *
 * The queue schedules the following call only once the previous has settled, so draining has to be
 * interleaved rather than done in one pass — which is the behaviour under test.
 */
async function flush(): Promise<void> {
  await tick()
  while (settle.length) {
    (settle.shift() as () => void)()
    await tick()
  }
}

beforeEach(stubFetch)
afterEach(() => { vi.unstubAllGlobals() })

async function desk() {
  const built = createDesk({ seed: 's', copies: 1 })
  await flush()
  return await built
}

describe('creating a desk', () => {
  it('asks for the bag it was told to, opening plates held back', async () => {
    const built = createDesk({ seed: 's:plates', copies: 2, exclude: [11, 31] })
    await flush()
    await built

    expect(calls[0]?.path).toBe('/desk')
    expect(calls[0]?.body).toEqual({ seed: 's:plates', copies: 2, exclude: [11, 31] })
  })
})

describe('the queue', () => {
  /*
   * The case the chain exists for. Both calls are made without awaiting the first, which is what a
   * caller doing two things in one turn looks like; the second must still reach the server after the
   * first has been answered.
   */
  it('does not let a discard overtake the draw before it', async () => {
    const d = await desk()

    const drawing = d.draw(4)
    const discarding = d.discard([11, 12])
    await tick()

    // Only the draw has gone out: the discard is waiting behind it, unanswered.
    expect(calls.map(c => c.path)).toEqual(['/desk', '/desk/desk-1/draw'])

    await flush()
    await Promise.all([drawing, discarding])
    expect(calls.map(c => c.path)).toEqual([
      '/desk', '/desk/desk-1/draw', '/desk/desk-1/discard',
    ])
  })

  it('keeps going after a call fails', async () => {
    const d = await desk()

    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ message: 'cannot draw 1000' }),
    } as Response))
    await expect(d.draw(1000)).rejects.toThrow('cannot draw 1000')

    stubFetch()
    const drawing = d.draw(2)
    await flush()
    await expect(drawing).resolves.toEqual([11, 12])
  })

  it('says plainly when the server is not there', async () => {
    const d = await desk()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('connection refused')))
    await expect(d.draw(1)).rejects.toThrow(/Cannot reach the table/)
  })
})

describe('discarding', () => {
  it('sends nothing at all for an empty batch', async () => {
    const d = await desk()
    await d.discard([])
    expect(calls.map(c => c.path)).toEqual(['/desk'])
  })

  it('reports what the server said is left', async () => {
    const d = await desk()
    const drawing = d.draw(2)
    await flush()
    await drawing
    expect(d.remaining()).toBe(30)
  })
})
