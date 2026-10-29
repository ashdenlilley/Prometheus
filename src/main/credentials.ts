import { promises as fs } from 'fs'

// Named secrets in one file, each sealed by `keys` (the OS keychain) when given. Without keys the
// values are plain text, so only use that where no keychain exists.
export interface Sealer {
  seal(text: string): Promise<string>
  open(sealed: string): Promise<string | null>
}

export class CredentialStore {
  private values: Record<string, string> | null = null

  constructor(
    private file: string,
    private keys?: Sealer
  ) {}

  // True when values are sealed by the OS keychain rather than kept in plain text.
  get sealed(): boolean {
    return !!this.keys
  }

  private async load(): Promise<Record<string, string>> {
    if (!this.values) {
      try {
        this.values = JSON.parse(await fs.readFile(this.file, 'utf8'))
      } catch {
        this.values = {}
      }
    }
    return this.values!
  }

  async get(name: string): Promise<string | null> {
    const sealed = (await this.load())[name]
    if (sealed === undefined) return null
    return this.keys ? this.keys.open(sealed) : sealed
  }

  async has(name: string): Promise<boolean> {
    return name in (await this.load())
  }

  async set(name: string, value: string): Promise<void> {
    const values = await this.load()
    values[name] = this.keys ? await this.keys.seal(value) : value
    await this.write(values)
  }

  async delete(name: string): Promise<void> {
    const values = await this.load()
    if (!(name in values)) return
    delete values[name]
    await this.write(values)
  }

  // Written to a temp file and renamed, so a crash never leaves a half-written file.
  private async write(values: Record<string, string>) {
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(values), { mode: 0o600 })
    await fs.rename(tmp, this.file)
  }
}
