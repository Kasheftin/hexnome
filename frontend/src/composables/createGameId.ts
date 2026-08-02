/**
 * A game id, minted in the browser.
 *
 * **Not part of `@hexnome/rules`**, and the extraction is what made that obvious: the package compiles
 * without the DOM lib, and this is the one thing in it that reached for a browser API. Generating an
 * identifier is a platform concern, not a rule — the server mints its own, and the rules never care
 * where an id came from.
 *
 * `crypto.randomUUID` needs a secure context, which localhost and https both are — but a plain http
 * origin on a LAN is not, and that is a normal way to test a browser game on a phone. So there is a
 * fallback built from `getRandomValues`, which is available either way.
 */
export function createGameId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    // RFC 4122 version 4 layout.
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
    return [
      hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
    ].join('-')
  }

  throw new Error('No crypto source available to generate a game id')
}
