import { createId } from './id'

type LeaseRecord = { owner: string, sessionId: string, expiresAt: number }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const LEASE_KEY = 'gymrecord-active-session-editor'

function parseLease(value: string | null): LeaseRecord | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as LeaseRecord
    return typeof parsed.owner === 'string' && typeof parsed.sessionId === 'string' && typeof parsed.expiresAt === 'number' ? parsed : null
  } catch { return null }
}

export class ActiveSessionLease {
  private readonly owner: string
  private interval: ReturnType<typeof setInterval> | null = null
  private acquired = false
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key !== LEASE_KEY || !this.acquired) return
    const lease = parseLease(event.newValue)
    if (lease && lease.owner !== this.owner && lease.sessionId === this.sessionId && lease.expiresAt > Date.now()) {
      this.acquired = false
      this.stopHeartbeat()
      this.onLost()
    }
  }
  private readonly onPageHide = () => this.release()

  constructor(private readonly sessionId: string, private readonly onLost: () => void,
    private readonly storage: StorageLike = localStorage, private readonly now: () => number = Date.now,
    private readonly events: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window === 'undefined' ? null : window,
    owner = createId()) { this.owner = owner }

  acquire() {
    const existing = parseLease(this.storage.getItem(LEASE_KEY))
    if (existing && existing.owner !== this.owner && existing.sessionId === this.sessionId && existing.expiresAt > this.now()) return false
    this.acquired = true
    this.refresh()
    this.interval = setInterval(() => this.refresh(), 3000)
    this.events?.addEventListener('storage', this.onStorage as EventListener)
    this.events?.addEventListener('pagehide', this.onPageHide as EventListener)
    return true
  }

  release() {
    this.stopHeartbeat()
    this.events?.removeEventListener('storage', this.onStorage as EventListener)
    this.events?.removeEventListener('pagehide', this.onPageHide as EventListener)
    const existing = parseLease(this.storage.getItem(LEASE_KEY))
    if (existing?.owner === this.owner) this.storage.removeItem(LEASE_KEY)
    this.acquired = false
  }

  private refresh() {
    if (!this.acquired) return
    const existing = parseLease(this.storage.getItem(LEASE_KEY))
    if (existing && existing.owner !== this.owner && existing.sessionId === this.sessionId && existing.expiresAt > this.now()) {
      this.acquired = false
      this.stopHeartbeat()
      this.onLost()
      return
    }
    this.storage.setItem(LEASE_KEY, JSON.stringify({ owner: this.owner, sessionId: this.sessionId, expiresAt: this.now() + 10000 }))
  }

  private stopHeartbeat() {
    if (this.interval !== null) clearInterval(this.interval)
    this.interval = null
  }
}
