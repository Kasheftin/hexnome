import { describe, expect, it } from 'vitest'
import { PresenceService } from './presence.service'

/**
 * Presence, with the clock in the test's hand.
 *
 * Every question here is about elapsed time, and the only way to ask one honestly without waiting a
 * minute and a half is to hold the clock — which is why the service takes one.
 */
function attable() {
  let now = 1_000_000
  const presence = new PresenceService()
  presence.clock = () => now
  return {
    presence,
    /** Move the clock on. Seconds, because every threshold in the service is written in them. */
    after: (seconds: number) => { now += seconds * 1000 },
  }
}

const PRESENT = 90

describe('a seat that has been heard from', () => {
  it('is present', () => {
    const { presence } = attable()
    presence.seen('a-game', 1)

    expect([...presence.online('a-game')]).toEqual([1])
  })

  it('stays present right up to the threshold', () => {
    const { presence, after } = attable()
    presence.seen('a-game', 1)
    after(PRESENT)

    expect(presence.online('a-game').has(1)).toBe(true)
  })

  it('is gone a moment after it', () => {
    const { presence, after } = attable()
    presence.seen('a-game', 1)
    after(PRESENT + 1)

    expect(presence.online('a-game').has(1)).toBe(false)
  })

  /** The ordinary case: a client polls, so the count starts again every time. */
  it('is kept present by being heard from again', () => {
    const { presence, after } = attable()
    presence.seen('a-game', 1)
    for (let poll = 0; poll < 20; poll++) {
      after(15)
      presence.seen('a-game', 1)
    }

    expect(presence.online('a-game').has(1)).toBe(true)
  })

  /**
   * **The case the threshold is chosen for.** A tab the player switched away from has its timers
   * throttled by the browser to roughly one a minute, so it polls at 60s rather than 15s. They are
   * still at the table, and the earlier, tighter thresholds this could have had — 30s, 45s — would
   * every one of them have called them absent for reading their email.
   *
   * This is why `PRESENT_MS` is 90s and not less, and it cannot be reproduced in a headless browser,
   * so it is pinned here as the arithmetic it really is.
   */
  it('survives a tab that has been backgrounded and throttled to one poll a minute', () => {
    const { presence, after } = attable()
    presence.seen('a-game', 1)
    for (let minute = 0; minute < 10; minute++) {
      after(60)
      expect(presence.online('a-game').has(1)).toBe(true)
      presence.seen('a-game', 1)
    }

    expect(presence.online('a-game').has(1)).toBe(true)
  })
})

describe('a table of them', () => {
  it('answers each seat separately', () => {
    const { presence, after } = attable()
    presence.seen('a-game', 0)
    after(PRESENT - 10)
    presence.seen('a-game', 1)
    after(20)

    // Seat 0 was heard 110s ago and seat 1 20s ago.
    expect([...presence.online('a-game')]).toEqual([1])
  })

  it('keeps one game´s seats out of another´s', () => {
    const { presence } = attable()
    presence.seen('a-game', 1)

    expect([...presence.online('another-game')]).toEqual([])
  })

  it('knows nothing about a game nobody has read', () => {
    const { presence } = attable()
    expect([...presence.online('a-game')]).toEqual([])
  })
})

/**
 * The two things that stop a process which stays up for weeks from growing forever.
 *
 * Neither is visible in play, and both are the kind of thing that is only ever noticed as a slow
 * leak months later — so they are pinned here rather than trusted.
 */
describe('what it forgets', () => {
  it('drops a seat that stopped polling, rather than carrying it', () => {
    const { presence, after } = attable()
    presence.seen('a-game', 0)
    presence.seen('a-game', 1)
    expect(presence.remembered('a-game')).toBe(2)

    // Seat 0 keeps playing for an hour; seat 1 left after the first minute.
    for (let poll = 0; poll < 240; poll++) {
      after(15)
      presence.seen('a-game', 0)
    }

    expect([...presence.online('a-game')]).toEqual([0])
    /*
     * And asked through `remembered`, not `online`: the departed seat has to be *gone*, not merely
     * too old to be listed. Filtering would answer this question the same way while the table grew a
     * row for every player who ever sat at it.
     */
    expect(presence.remembered('a-game')).toBe(1)
  })

  it('remembers a bounded number of games, oldest first', () => {
    const { presence, after } = attable()
    for (let game = 0; game < 520; game++) {
      presence.seen(`game-${game}`, 0)
      after(1)
    }

    expect(presence.size).toBe(500)
    expect(presence.online('game-519').has(0)).toBe(true)
    expect(presence.online('game-0').has(0)).toBe(false)
  })

  /**
   * Reading a game must not make it the newest, or a table nobody is playing could survive on being
   * looked at while a real one is evicted from under it.
   *
   * Asked through `remembered`, because `online` reports an evicted game and a merely quiet one
   * identically — which is what let an earlier version of this test pass against a service that had
   * no eviction order at all.
   */
  it('counts a game as fresh from when it was last heard, not last asked about', () => {
    const { presence, after } = attable()
    presence.seen('early', 0)
    after(1)
    for (let game = 0; game < 499; game++) {
      presence.seen(`game-${game}`, 0)
      after(1)
    }
    // 500 games, `early` the oldest of them. Asking about it changes nothing.
    presence.online('early')
    presence.seen('one-more', 0)

    expect(presence.size).toBe(500)
    expect(presence.remembered('early')).toBe(0)
    expect(presence.remembered('game-0')).toBe(1)
  })
})
