import { describe, expect, it } from 'vitest'
import { createDealer, replayDealer } from './dealer'
import { createGameLog, recordingTableau, type LogEntry } from './gameLog'
import { defaultGameSettings } from './gameSettings'
import { openingPosition, tableauOptionsFor } from './setup'
import { createTableau, type Tableau, type TileSpec } from './tableau'

/**
 * The property the whole restore rests on: a game replayed from its commands leaves the deck exactly
 * where playing it left the deck. Not merely the board — the board was always rebuildable. The bags,
 * the piles and the hidden tokens are the part that used to be lost.
 */

const SETTINGS = defaultGameSettings(1700000000000)
const SEED = 'a-seed-to-play-twice'

/** A game played for real, recording one batch of entries per turn. */
function play(turns: number, { spendPerTurn = 0 } = {}) {
  const log = createGameLog()
  const commands: LogEntry[][] = []
  let batch: LogEntry[] = []

  const tableau: Tableau = recordingTableau(
    createTableau(tableauOptionsFor(SETTINGS)),
    (entry) => { log.append(entry); batch.push(entry) },
  )
  const dealer = createDealer(SEED)

  const commit = () => { commands.push(batch); batch = [] }

  openingPosition(tableau, SETTINGS, undefined)
  commit()

  for (let turn = 0; turn < turns; turn++) {
    dealer.deal(tableau)
    // Take the whole top lot, which is what makes the next deal due and eventually empties a lot.
    for (const tile of tableau.tilesInSourceLot(0)) {
      const slot = tableau.freeDrawerSlots()[0]
      if (slot !== undefined) tableau.moveTile(tile.id, { kind: 'drawer', slot })
    }
    dealer.reveal(tableau)

    /*
     * A payment: spend a couple of drawer tiles back into the pile. One `recycle` for the whole
     * event, which is the batching the replay has to reproduce from the command boundary alone.
     */
    if (spendPerTurn > 0) {
      const spent: TileSpec[] = []
      for (const tile of tableau.tiles().filter(t => t.location.kind === 'drawer').slice(0, spendPerTurn)) {
        spent.push({ color: tile.color, value: tile.value })
        tableau.discard(tile.id)
      }
      dealer.recycle(spent, [])
    }

    commit()
  }

  return { tableau, dealer, commands }
}

describe('replaying the deck', () => {
  it('leaves the bags where playing left them', () => {
    const live = play(6)
    const rebuilt = replayDealer(SEED, SETTINGS, live.commands)

    // The next thing each would deal must be the same thing, which is the only test that matters.
    const nextLive = createTableau(tableauOptionsFor(SETTINGS))
    const nextRebuilt = createTableau(tableauOptionsFor(SETTINGS))
    live.dealer.deal(nextLive)
    rebuilt.dealer.deal(nextRebuilt)

    expect(nextRebuilt.plates().map(p => p.id)).toEqual(nextLive.plates().map(p => p.id))
    expect(nextRebuilt.tiles().map(t => ({ color: t.color, value: t.value })))
      .toEqual(nextLive.tiles().map(t => ({ color: t.color, value: t.value })))
  })

  it('rebuilds the same board', () => {
    const live = play(5)
    const rebuilt = replayDealer(SEED, SETTINGS, live.commands)
    expect(rebuilt.tableau.tiles().map(t => t.id)).toEqual(live.tableau.tiles().map(t => t.id))
    expect(rebuilt.tableau.plates().map(p => p.id)).toEqual(live.tableau.plates().map(p => p.id))
  })

  it('counts the round\'s deals the same way', () => {
    const live = play(3)
    expect(replayDealer(SEED, SETTINGS, live.commands).dealer.platesDealt())
      .toBe(live.dealer.platesDealt())
  })

  /*
   * The hidden tokens are what a reveal needs, and losing them is silent: the plate simply never
   * turns over. Dealing then revealing on both sides must produce the same face.
   */
  it('remembers what each face-down plate is carrying', () => {
    const live = play(4)
    const rebuilt = replayDealer(SEED, SETTINGS, live.commands)

    for (const board of [live.tableau, rebuilt.tableau]) {
      for (const tile of board.tilesInSourceLot(0)) {
        const slot = board.freeDrawerSlots()[0]
        if (slot !== undefined) board.moveTile(tile.id, { kind: 'drawer', slot })
      }
    }
    live.dealer.reveal(live.tableau)
    rebuilt.dealer.reveal(rebuilt.tableau)

    const faces = (b: Tableau) => b.plates()
      .map(p => b.plateToken(p.id))
      .map(t => (t ? `${t.color}:${t.value}` : '—'))
    expect(faces(rebuilt.tableau)).toEqual(faces(live.tableau))
  })

  /*
   * Spending is the other half of the fold, and the harder half: what a turn destroys goes back into
   * a pile, and the pile is what a later reshuffle deals from. A replay that rebuilds the board but
   * loses the pile looks perfect until the bag runs dry.
   */
  it('puts back what a turn spent', () => {
    const live = play(4, { spendPerTurn: 2 })
    const rebuilt = replayDealer(SEED, SETTINGS, live.commands)

    const nextLive = createTableau(tableauOptionsFor(SETTINGS))
    const nextRebuilt = createTableau(tableauOptionsFor(SETTINGS))
    live.dealer.deal(nextLive)
    rebuilt.dealer.deal(nextRebuilt)

    expect(nextRebuilt.tiles().map(t => `${t.color}:${t.value}`))
      .toEqual(nextLive.tiles().map(t => `${t.color}:${t.value}`))
    expect(rebuilt.tableau.tiles().map(t => t.id)).toEqual(live.tableau.tiles().map(t => t.id))
  })
})
