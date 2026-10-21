import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto'

// Sync encryption. A passphrase becomes a 256-bit key with scrypt. Each segment is sealed with
// AES-256-GCM under a fresh 12-byte IV. The GCM tag also rejects truncated or corrupt files.

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const CHECK_PLAIN = 'prometheus-sync-check-v1'

export interface Sealed {
  v: 1
  iv: string
  tag: string
  data: string
}

export function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase.normalize('NFKC'), salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export function newSalt(): Buffer {
  return randomBytes(16)
}

export function seal(key: Buffer, plain: string): Sealed {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}

// Throws when the key is wrong or the file was altered.
export function open(key: Buffer, sealed: Sealed): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8')
}

// Folder-level marker: salt plus a sealed known string. Lets a device check its passphrase before
// writing anything.
export interface FolderMeta {
  v: 1
  salt: string
  check: Sealed
}

export async function createMeta(passphrase: string): Promise<{ meta: FolderMeta; key: Buffer }> {
  const salt = newSalt()
  const key = await deriveKey(passphrase, salt)
  return { meta: { v: 1, salt: salt.toString('base64'), check: seal(key, CHECK_PLAIN) }, key }
}

// Returns the key when the passphrase matches the folder, otherwise null.
export async function unlockMeta(passphrase: string, meta: FolderMeta): Promise<Buffer | null> {
  const key = await deriveKey(passphrase, Buffer.from(meta.salt, 'base64'))
  try {
    return open(key, meta.check) === CHECK_PLAIN ? key : null
  } catch {
    return null
  }
}
