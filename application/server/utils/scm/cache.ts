export class TtlCache<V> {
  private readonly store = new Map<string, { value: V, expiry: number }>()

  constructor(private readonly ttlMs: number, private readonly maxSize = 500) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiry) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxSize) {
      const now = Date.now()
      for (const [k, v] of this.store) {
        if (now > v.expiry) { this.store.delete(k); break }
      }
      if (this.store.size >= this.maxSize) {
        const first = this.store.keys().next().value
        if (first !== undefined) this.store.delete(first)
      }
    }
    this.store.set(key, { value, expiry: Date.now() + this.ttlMs })
  }
}
