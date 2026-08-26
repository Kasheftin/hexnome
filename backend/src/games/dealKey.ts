/**
 * The public seed a game is dealt from.
 *
 * Null means "my own id", which is nearly every game: a game's public seed was its id for as long as
 * no game was ever dealt twice, and the column exists only so a repeat can inherit another game's.
 * Written once, here, because both the desks and the fold have to agree about it — and they are built
 * in different services, minutes apart in the life of a game.
 */
export function dealKeyOf(game: { readonly id: string, readonly dealKey: string | null }): string {
  return game.dealKey ?? game.id
}
