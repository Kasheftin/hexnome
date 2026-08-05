/**
 * The wire contract, which lives in the rules package so the client shares it exactly.
 *
 * Re-exported here because that is where this module's callers already look, and because the import
 * path is the only thing that would otherwise have to change everywhere at once. Add nothing to this
 * file: a shape defined here rather than there is a shape the client cannot see, which is how the
 * two ends drift apart.
 */
export * from '@hexnome/rules/wire'
