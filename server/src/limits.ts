// Edge rate limit through a Workers Rate Limiting binding. No binding (local tests) means no check.
export async function throttled(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  return limiter ? !(await limiter.limit({ key })).success : false
}

const LIMIT_IP = 20 // per client address per 15 min
const LIMIT_IP_NONE = 5 // the shared 'none' bucket (no client address)
const LIMIT_IP_WARP = 200 // the shared 'warp' bucket: many users leave through one WARP egress, so it needs a higher cap

// Limit for an ipKey bucket. Requests with no client address share 'none', which is limited more tightly.
export const ipLimit = (key: string) => (key === 'none' ? LIMIT_IP_NONE : key === 'warp' ? LIMIT_IP_WARP : LIMIT_IP)

// Bucket for one client address. IPv6 is bucketed per /48, since one site can hold a whole /48.
// Cloudflare WARP (2a09:bac0::/29) shares one bucket, 'warp'. Requests with no CF-Connecting-IP share 'none'.
export function ipKey(ip: string | null): string {
  if (!ip) return 'none'
  if (!ip.includes(':')) return ip
  // IPv4-mapped IPv6 (::ffff:203.0.113.1) is the IPv4 address, not one shared /64.
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (v4) return v4[1]
  // Expand '::' so the first three groups are always the /48 prefix. Lowercased so 'DB8' and 'db8' match.
  const [left, right] = ip.toLowerCase().split('::')
  const l = left ? left.split(':') : []
  const r = right === undefined ? [] : right ? right.split(':') : []
  const groups = right === undefined ? l : [...l, ...Array(Math.max(0, 8 - l.length - r.length)).fill('0'), ...r]
  const prefix = groups.slice(0, 3).map(g => g.padStart(4, '0'))
  // 2a09:bac0::/29: first group 2a09, top 13 bits of the second group 0xbac0 (so bac0-bac7).
  if (prefix[0] === '2a09' && (parseInt(prefix[1], 16) & 0xfff8) === 0xbac0) return 'warp'
  return `${prefix.join(':')}::/48`
}
