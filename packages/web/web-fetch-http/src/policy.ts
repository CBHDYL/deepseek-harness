/**
 * URL validation and content-type classification for the local HTTP(S) fetch
 * provider — the pure, network-free half. The provider's `fetch()` composes
 * these with transport (redirect following, byte caps, decoding).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Validate a request URL against the basic transport hygiene the provider
 * enforces before any network access: http(s) only, no embedded credentials,
 * bounded length. Returns the parsed `URL`. Throws {@link WebError} otherwise.
 * (Loopback/private-network blocking is separate — the provider resolves each
 * target in {@linkcode .../provider.ts} and refuses blocked ranges per hop.)
 *
 * @param input - the raw URL string from the fetch request.
 * @param maxUrlLength - inclusive upper bound on `input`'s length.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string, maxUrlLength: number): URL {
  if (input.length > maxUrlLength) {
    throw new WebError(`URL exceeds the maximum length of ${maxUrlLength}`, 'WEB_INVALID_URL')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call
 * (and thus a fresh provider/permission decision).
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Whether an IP literal must never be fetched by an agent-driven HTTP tool:
 * loopback, RFC1918 private, link-local, CGNAT, benchmarking, multicast,
 * unspecified, IPv6 ULA/link-local/multicast, and IPv4-mapped/compatible/NAT64
 * forms of any of the above. The 169.254.0.0/16 range also covers cloud
 * metadata endpoints (169.254.169.254).
 *
 * This classifies IP literals only. A non-IP string (e.g. a bare hostname) is
 * NOT classified here — the provider resolves hostnames and classifies each
 * resolved address, so a public name like `example.com` must not be fail-closed
 * by this function.
 * @param address - a bare IPv4 or IPv6 literal (no enclosing brackets).
 * @returns true when the literal must never be fetched.
 */
export function isBlockedAddress(address: string): boolean {
  const v4 = ipv4IsBlocked(address)
  if (v4 !== undefined) return v4
  const lower = address.toLowerCase()
  if (!lower.includes(':')) return false // not an IP literal; the provider resolves names and classifies per-address
  return ipv6IsBlocked(lower)
}

/** Classify a dotted-quad IPv4 literal, or `undefined` when `address` is not one. */
function ipv4IsBlocked(address: string): boolean | undefined {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (v4 === null) return undefined
  const a = Number(v4[1])
  const b = Number(v4[2])
  if (a > 255 || b > 255 || Number(v4[3]) > 255 || Number(v4[4]) > 255) return true
  if (a === 0) return true // 0.0.0.0/8 unspecified
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a >= 224) return true // 224.0.0.0/4 multicast + reserved
  return false
}

/** The eight 16-bit groups of one expanded IPv6 literal — an index-safe tuple. */
type Ipv6Groups = [number, number, number, number, number, number, number, number]

/** Classify a bare (lower-cased) IPv6 literal, including mapped/NAT64/compatible embedded IPv4. */
function ipv6IsBlocked(lower: string): boolean {
  if (lower === '::' || lower === '::1') return true // unspecified + loopback
  const g = ipv6Groups(lower)
  if (g === null) return false // unparseable; the provider resolves names and the DNS layer errors on its own
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true // ff00::/8 multicast
  const embedded = ipv6EmbeddedV4(g)
  if (embedded !== undefined) return isBlockedAddress(embedded) // mapped / NAT64 / compatible embedded IPv4
  return false
}

/**
 * Recover the 32-bit IPv4 embedded in the last groups of a mapped
 * (`::ffff:<v4>`), NAT64 well-known (`64:ff9b::<v4>`), or IPv4-compatible
 * (`::<v4>`) IPv6 form, as a dotted-quad string; `undefined` otherwise.
 */
function ipv6EmbeddedV4(g: Ipv6Groups): string | undefined {
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return ipv4FromUint32((g[6] << 16) | g[7])
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return ipv4FromUint32((g[6] << 16) | g[7])
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return ipv4FromUint32((g[6] << 16) | g[7])
  return undefined
}

/** Render the low 32 bits as a dotted-quad IPv4 literal. */
function ipv4FromUint32(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`
}

/** Expand a bare IPv6 literal to its eight 16-bit groups, or `null` when unparseable. */
function ipv6Groups(input: string): Ipv6Groups | null {
  const double = input.indexOf('::')
  const toGroupsList = (segment: string): number[] | null => {
    if (segment === '') return []
    const out: number[] = []
    for (const part of segment.split(':')) {
      if (part === '') return null
      const group = toGroups(part)
      if (group === null) return null
      out.push(...group)
    }
    return out
  }
  const head = toGroupsList(double !== -1 ? input.slice(0, double) : input)
  const tail = toGroupsList(double !== -1 ? input.slice(double + 2) : '')
  if (head === null || tail === null) return null
  const count = head.length + tail.length
  if (double !== -1) {
    const fill = 8 - count
    if (fill < 0) return null
    // `count + fill === 8` by construction, so the cast is index-safe.
    return [...head, ...Array<number>(fill).fill(0), ...tail] as Ipv6Groups
  }
  return count === 8 ? [...head, ...tail] as Ipv6Groups : null
}

/** One IPv6 part to one or two 16-bit groups (an embedded dotted-quad yields two). */
function toGroups(part: string): number[] | null {
  if (part.includes('.')) {
    const raw = part.split('.').map(Number)
    if (raw.length !== 4 || raw.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null
    const [d0, d1, d2, d3] = raw as [number, number, number, number]
    return [(d0 << 8) | d1, (d2 << 8) | d3]
  }
  const n = Number.parseInt(part, 16)
  if (Number.isNaN(n) || n < 0 || n > 0xffff) return null
  return [n]
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. The provider feeds this label to `TextDecoder`
 * so a non-UTF-8 response is decoded with its declared encoding rather than
 * silently mangled into replacement characters.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset label, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
 * the label is present but not a charset `TextDecoder` recognizes — better to
 * fail loudly than return mojibake.
 *
 * @param charset - the declared charset label (from {@link parseCharset}), or
 *   `undefined` to default to UTF-8.
 * @returns a decoder for the declared (or defaulted) encoding.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  try {
    return new TextDecoder(charset)
  } catch (error: unknown) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}
