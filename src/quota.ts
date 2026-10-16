export type SourceID = "copilot" | "openai" | "anthropic"
export type Period = "month" | "week"
export type Quota = {
  percentRemaining: number
  resetAt: Date
  period: Period
  unlimited: boolean
  counts?: { remaining: number; entitlement: number }
}
export type State =
  | { type: "loading" }
  | { type: "ready"; quota: Quota }
  | { type: "failed"; error: string; last?: Quota }
  | { type: "absent" }
export type Tone = "muted" | "success" | "warning" | "error"
export type Mode = "full" | "compact"

export const SOURCES: ReadonlyArray<{ id: SourceID; label: string; providers: readonly string[] }> = [
  { id: "copilot", label: "Copilot", providers: ["github-copilot"] },
  { id: "openai", label: "OpenAI", providers: ["openai"] },
  { id: "anthropic", label: "Claude", providers: ["anthropic"] },
]
export const SOURCE_ORDER = SOURCES.map((source) => source.id)
export type States = Record<SourceID, State>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const finite = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`bad ${field}`)
  return value
}

/** Provider ids OpenCode reports as connected, from a saved login or an env key. */
export function connectedProviders(response: unknown): ReadonlySet<string> {
  const integrations = isRecord(response) ? response.data : undefined
  if (!Array.isArray(integrations)) throw new Error("bad integrations")
  return new Set(
    integrations.flatMap((item) =>
      isRecord(item) && typeof item.id === "string" && Array.isArray(item.connections) && item.connections.length > 0
        ? [item.id]
        : [],
    ),
  )
}

export const isConfigured = (source: { providers: readonly string[] }, connected: ReadonlySet<string>) =>
  source.providers.some((provider) => connected.has(provider))

export function parseCopilot(json: unknown): Quota {
  if (!isRecord(json)) throw new Error("bad body")
  const snapshots = json.quota_snapshots
  const premium = isRecord(snapshots) ? snapshots.premium_interactions : undefined
  if (!isRecord(premium)) throw new Error("no premium_interactions")

  const resetAt = new Date(String(json.quota_reset_date_utc ?? json.quota_reset_date))
  if (Number.isNaN(resetAt.getTime())) throw new Error("bad reset date")

  const entitlement = finite(premium.entitlement, "entitlement")
  const counts = { remaining: finite(premium.remaining, "remaining"), entitlement }
  return {
    percentRemaining: finite(premium.percent_remaining, "percent_remaining"),
    resetAt,
    period: "month",
    unlimited: premium.unlimited === true,
    counts,
  }
}

const NO_WEEKLY = "no weekly window"

export function parseCodex(json: unknown): Quota {
  const limit = isRecord(json) ? json.rate_limit : undefined
  if (!isRecord(limit)) throw new Error(NO_WEEKLY)
  const windows = [limit.primary_window, limit.secondary_window].filter(
    (window): window is Record<string, unknown> =>
      isRecord(window) &&
      Number.isFinite(window.limit_window_seconds) &&
      Number.isFinite(window.used_percent) &&
      Number.isFinite(window.reset_at),
  )
  // The weekly window is the longest one; plans may also carry a 5 hour window.
  const weekly = windows.sort((a, b) => Number(b.limit_window_seconds) - Number(a.limit_window_seconds))[0]
  if (!weekly) throw new Error(NO_WEEKLY)
  return {
    percentRemaining: 100 - Number(weekly.used_percent),
    resetAt: new Date(Number(weekly.reset_at) * 1000),
    period: "week",
    unlimited: false,
  }
}

export function parseClaude(json: unknown): Quota {
  const weekly = isRecord(json) ? json.seven_day : undefined
  if (!isRecord(weekly)) throw new Error(NO_WEEKLY)
  const resetAt = new Date(String(weekly.resets_at))
  if (!Number.isFinite(weekly.utilization) || Number.isNaN(resetAt.getTime())) throw new Error(NO_WEEKLY)
  return { percentRemaining: 100 - Number(weekly.utilization), resetAt, period: "week", unlimited: false }
}

/** Expiry of a JWT in ms epoch, or undefined when the token has no readable `exp`. */
export function jwtExpiry(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"))
    return isRecord(payload) && typeof payload.exp === "number" ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

const number = (value: number, options?: Intl.NumberFormatOptions) => value.toLocaleString("en-US", options)

const percentLeft = (quota: Quota) => number(quota.percentRemaining, { maximumFractionDigits: 1 })

const detail: Record<Period, (quota: Quota) => string> = {
  month: ({ counts }) => (counts ? ` (${number(counts.remaining)}/${number(counts.entitlement)})` : ""),
  week: () => " · weekly",
}

const formats: Record<Mode, (quota: Quota, label: string) => string> = {
  full: (quota, label) => {
    const resets = quota.resetAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    return `${label} ${percentLeft(quota)}% left${detail[quota.period](quota)} · resets ${resets}`
  },
  compact: (quota, label) => `${label} ${percentLeft(quota)}% left`,
}

const readyText = (quota: Quota, mode: Mode, label: string) =>
  quota.unlimited ? `${label} unlimited` : formats[mode](quota, label)

const cycleStart: Record<Period, (resetAt: Date) => Date> = {
  month: (resetAt) => {
    const start = new Date(resetAt)
    start.setUTCMonth(start.getUTCMonth() - 1)
    return start
  },
  week: (resetAt) => new Date(resetAt.getTime() - 7 * 24 * 60 * 60 * 1000),
}

const paceTone = ({ percentRemaining, resetAt, period }: Quota, now: number): Tone => {
  if (percentRemaining < 10) return "error"
  const cycleLeft = (resetAt.getTime() - now) / (resetAt.getTime() - cycleStart[period](resetAt).getTime())
  return percentRemaining / 100 < cycleLeft ? "warning" : "success"
}

export function view(state: State, now: number, mode: Mode, label: string): { text: string; tone: Tone } {
  switch (state.type) {
    case "loading":
      return { text: `${label} …`, tone: "muted" }
    case "ready":
      return {
        text: readyText(state.quota, mode, label),
        tone: state.quota.unlimited ? "muted" : paceTone(state.quota, now),
      }
    case "failed":
      if (state.last) return { text: `${readyText(state.last, mode, label)} · stale`, tone: "muted" }
      return { text: `${label} quota: ${state.error}`, tone: "error" }
    case "absent":
      return { text: "", tone: "muted" }
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

const present = (states: States, id: SourceID) => states[id].type !== "absent"

/** The source after `shown` in `order`, wrapping and skipping absent ones. Returns `shown` when no other source qualifies. */
export function nextSource(order: readonly SourceID[], shown: SourceID | undefined, states: States): SourceID | undefined {
  const start = shown === undefined ? -1 : order.indexOf(shown)
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length]
    if (present(states, id)) return id
  }
  return undefined
}

export function pickSource(providerID: string | undefined, states: States): SourceID | undefined {
  const own = SOURCES.find((source) => providerID !== undefined && source.providers.includes(providerID))
  if (own && present(states, own.id)) return own.id
  return SOURCE_ORDER.find((id) => present(states, id))
}
