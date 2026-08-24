import type { PlayerCommand } from './game'
import type { PlateLocation, TileLocation } from './tableau'

/**
 * A `Command` out of an untrusted value, or null.
 *
 * **The gate `applyCommand` does not have.** It takes a `Command` and believes it — `to as
 * TileLocation` is a cast, not a check — which was perfectly safe while the only caller was the view
 * that built the object a line earlier. Once a command arrives over HTTP it is a stranger, and a
 * malformed `to` would reach `moveTile` unread.
 *
 * The same shape as `parseGameSettings`: one function, all or nothing, returning null rather than
 * throwing so the caller decides what a bad command means. Unlike the settings it patches **nothing**
 * — a dial with an unreadable value can fall back to a default because the game is still the game,
 * but a turn nobody can read is not a turn to guess at.
 *
 * The ids are checked only for being non-empty strings. Whether `src:t7` names anything is the
 * board's question and `applyCommand` asks it; this establishes that the request has the right shape,
 * so the two cannot disagree about a turn they both partly understand.
 */

/** The longest an id may be. Ids are minted by the model (`0:t14`), so this is room to spare. */
const MAX_ID = 64

/** The most drawer items one placement may be paid with — a full drawer and then some. */
const MAX_PAYING = 32

/** The most items one draft may take. A lot is five, and a sweep cannot reach every lot. */
const MAX_DRAFT = 64

/**
 * The longest seating plan this will read, per index.
 *
 * A plan is one entry per slot whether or not the slot holds anything, so its length is the drawer's
 * width — `tileSlots` and `plateSlots`, both dials with far smaller ceilings than this. The tableau
 * refuses any plan whose length is not exactly right; this only stops an arbitrarily long array
 * arriving from the network before anybody has counted the slots.
 */
const MAX_SEATS = 64

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** A non-negative index: a slot, a petal, a lot. Negative ones address nothing. */
function index(value: unknown): number | null {
  const n = whole(value)
  return n !== null && n >= 0 ? n : null
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID ? value : null
}

/** A seating plan: ids by slot, with `null` for an empty one. */
function seats(value: unknown, limit: number): Array<string | null> | null {
  if (!Array.isArray(value) || value.length > limit) return null
  const out: Array<string | null> = []
  for (const entry of value) {
    if (entry === null) {
      out.push(null)
      continue
    }
    const one = id(entry)
    if (one === null) return null
    out.push(one)
  }
  return out
}

function ids(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null
  const out: string[] = []
  for (const entry of value) {
    const one = id(entry)
    if (one === null) return null
    out.push(one)
  }
  return out
}

function axial(value: unknown): { q: number, r: number } | null {
  const raw = record(value)
  if (!raw) return null
  const q = whole(raw.q)
  const r = whole(raw.r)
  return q !== null && r !== null ? { q, r } : null
}

function tileLocation(value: unknown): TileLocation | null {
  const raw = record(value)
  if (!raw) return null
  switch (raw.kind) {
    case 'drawer': {
      const slot = index(raw.slot)
      return slot === null ? null : { kind: 'drawer', slot }
    }
    case 'onPlate': {
      const plateId = id(raw.plateId)
      const petal = index(raw.petal)
      return plateId === null || petal === null ? null : { kind: 'onPlate', plateId, petal }
    }
    case 'source': {
      const lot = index(raw.lot)
      const at = index(raw.index)
      return lot === null || at === null ? null : { kind: 'source', lot, index: at }
    }
    default:
      return null
  }
}

function plateLocation(value: unknown): PlateLocation | null {
  const raw = record(value)
  if (!raw) return null
  switch (raw.kind) {
    case 'board': {
      const hole = axial(raw.hole)
      return hole === null ? null : { kind: 'board', hole }
    }
    case 'plateSlot': {
      const slot = index(raw.slot)
      return slot === null ? null : { kind: 'plateSlot', slot }
    }
    case 'source': {
      const lot = index(raw.lot)
      return lot === null ? null : { kind: 'source', lot }
    }
    default:
      return null
  }
}

/**
 * Read a command a client sent.
 *
 * **`deal` is not among them, and that is deliberate.** It carries what the desk dealt, and the desk
 * is the server's — a client that could submit one would be choosing its own tiles. The server builds
 * its deals itself and never parses one, so there is nothing here to accidentally accept.
 */
export function parseCommand(value: unknown): PlayerCommand | null {
  const raw = record(value)
  if (!raw) return null

  const seat = index(raw.seat)
  if (seat === null) return null

  switch (raw.kind) {
    case 'pass':
      return { kind: 'pass', seat }

    /*
     * Nothing to read but the seat: an undo names no turn, because "the last one still standing" is
     * the log's answer and not the client's to offer. A client that could nominate which turn to take
     * back could take back a turn from three rounds ago, or somebody else's.
     *
     * Whether it is *allowed* — solo, the setting on, the turn inside this round — is `canUndo`'s
     * question, asked by the service against the log. This only says the request has a shape.
     */
    case 'undo':
      return { kind: 'undo', seat }

    case 'draft': {
      const taking = ids(raw.ids, MAX_DRAFT)
      return taking === null ? null : { kind: 'draft', seat, ids: taking }
    }

    case 'arrange': {
      const drawer = seats(raw.drawer, MAX_SEATS)
      const bays = seats(raw.bays, MAX_SEATS)
      if (drawer === null || bays === null) return null
      return { kind: 'arrange', seat, drawer, bays }
    }

    case 'put': {
      const item = record(raw.item)
      if (!item) return null
      const itemId = id(item.id)
      if (itemId === null) return null
      if (item.kind !== 'tile' && item.kind !== 'plate') return null

      // A tile goes to a tile location and a plate to a plate one. Crossing them would reach
      // `moveTile` with a hole, or `movePlate` with a petal.
      const to = item.kind === 'tile' ? tileLocation(raw.to) : plateLocation(raw.to)
      if (to === null) return null

      const paying = ids(raw.paying, MAX_PAYING)
      if (paying === null) return null

      /*
       * Absent is the honest answer for a tile, which has no rotation. Present, it must be a whole
       * number — the model takes it modulo six, so any of them addresses a real turn.
       */
      let rotation: number | undefined
      if (raw.rotation !== undefined) {
        const turned = whole(raw.rotation)
        if (turned === null) return null
        rotation = turned
      }

      return { kind: 'put', seat, item: { kind: item.kind, id: itemId }, to, paying, rotation }
    }

    default:
      return null
  }
}
