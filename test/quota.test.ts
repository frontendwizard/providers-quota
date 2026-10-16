import { describe, expect, test } from "bun:test"
import {
  connectedProviders,
  isConfigured,
  jwtExpiry,
  nextSource,
  parseClaude,
  parseCodex,
  parseCopilot,
  pickSource,
  SOURCE_ORDER,
  SOURCES,
  view,
  type Mode,
  type Quota,
  type State,
  type States,
} from "../src/quota"

const now = Date.parse("2026-10-16T00:00:00.000Z")
const day = 86_400_000

const quota = (overrides: Partial<Quota> = {}): Quota => ({
  percentRemaining: 57.8,
  resetAt: new Date("2026-11-01T00:00:00.000Z"),
  period: "month",
  unlimited: false,
  counts: { remaining: 28939, entitlement: 50000 },
  ...overrides,
})
const ready = (overrides?: Partial<Quota>): State => ({ type: "ready", quota: quota(overrides) })
const copilot = (state: State, mode: Mode = "full") => view(state, now, mode, "Copilot")

const weeklyWindow = { used_percent: 100, limit_window_seconds: 604800, reset_after_seconds: 514655, reset_at: 1792649730 }
const fiveHourWindow = { used_percent: 30, limit_window_seconds: 18000, reset_after_seconds: 100, reset_at: 1792000000 }
const codexResponse = {
  plan_type: "prolite",
  rate_limit: { allowed: false, limit_reached: true, primary_window: weeklyWindow, secondary_window: null },
}
const codexWeekly = parseCodex(codexResponse)
const weekly = (overrides?: Partial<Quota>): State => ({ type: "ready", quota: { ...codexWeekly, ...overrides } })

const states = (overrides: Partial<States> = {}): States => ({
  copilot: { type: "loading" },
  openai: { type: "loading" },
  anthropic: { type: "loading" },
  ...overrides,
})
const allAbsent: States = { copilot: { type: "absent" }, openai: { type: "absent" }, anthropic: { type: "absent" } }

describe("view with a monthly quota", () => {
  test("shows counts and the reset date in the full format", () => {
    expect(copilot(ready())).toEqual({ text: "Copilot 57.8% left (28,939/50,000) · resets Nov 1", tone: "success" })
  })

  test("shows only the percentage in the compact format", () => {
    expect(copilot(ready(), "compact")).toEqual({ text: "Copilot 57.8% left", tone: "success" })
  })

  test("warns when the quota is used faster than the month passes", () => {
    const behind = ready({ percentRemaining: 40, counts: { remaining: 20000, entitlement: 50000 } })
    expect(copilot(behind)).toEqual({ text: "Copilot 40% left (20,000/50,000) · resets Nov 1", tone: "warning" })
    expect(copilot(ready({ percentRemaining: 40 }), "compact").tone).toBe("warning")
  })

  test("turns red below 10 percent and not at exactly 10", () => {
    expect(copilot(ready({ percentRemaining: 8 })).tone).toBe("error")
    expect(copilot(ready({ percentRemaining: 8 }), "compact").tone).toBe("error")
    expect(copilot(ready({ percentRemaining: 10 })).tone).toBe("warning")
  })

  test("shows unlimited plans as muted text in both formats", () => {
    expect(copilot(ready({ unlimited: true }))).toEqual({ text: "Copilot unlimited", tone: "muted" })
    expect(copilot(ready({ unlimited: true }), "compact")).toEqual({ text: "Copilot unlimited", tone: "muted" })
  })
})

describe("view with a weekly quota", () => {
  const openai = (state: State, mode: Mode = "full") => view(state, now, mode, "OpenAI")

  test("labels the window and the reset date", () => {
    expect(openai(weekly())).toEqual({ text: "OpenAI 0% left · weekly · resets Oct 22", tone: "error" })
    expect(openai(weekly(), "compact")).toEqual({ text: "OpenAI 0% left", tone: "error" })
  })

  test("compares the quota left with the share of the week left", () => {
    const behind = weekly({ percentRemaining: 50, resetAt: new Date(now + 6 * day) })
    const ahead = weekly({ percentRemaining: 50, resetAt: new Date(now + 2 * day) })
    expect(view(behind, now, "full", "Claude").tone).toBe("warning")
    expect(view(ahead, now, "full", "Claude").tone).toBe("success")
  })
})

describe("view with a missing reading", () => {
  test("shows a loading marker", () => {
    expect(copilot({ type: "loading" })).toEqual({ text: "Copilot …", tone: "muted" })
  })

  test("keeps the last reading and marks it stale after a failed refresh", () => {
    const failed: State = { type: "failed", error: "offline", last: quota() }
    expect(copilot(failed)).toEqual({
      text: "Copilot 57.8% left (28,939/50,000) · resets Nov 1 · stale",
      tone: "muted",
    })
    expect(copilot(failed, "compact")).toEqual({ text: "Copilot 57.8% left · stale", tone: "muted" })
    expect(view({ type: "failed", error: "offline", last: codexWeekly }, now, "full", "OpenAI")).toEqual({
      text: "OpenAI 0% left · weekly · resets Oct 22 · stale",
      tone: "muted",
    })
  })

  test("shows the error when there is no earlier reading", () => {
    expect(copilot({ type: "failed", error: "HTTP 401" })).toEqual({ text: "Copilot quota: HTTP 401", tone: "error" })
    expect(copilot({ type: "failed", error: "HTTP 401" }, "compact")).toEqual({
      text: "Copilot quota: HTTP 401",
      tone: "error",
    })
  })

  test("renders nothing for an absent source", () => {
    expect(copilot({ type: "absent" })).toEqual({ text: "", tone: "muted" })
  })
})

describe("parseCopilot", () => {
  const body = {
    quota_reset_date: "2026-11-01",
    quota_reset_date_utc: "2026-11-01T00:00:00.000Z",
    quota_snapshots: {
      premium_interactions: { entitlement: 50000, remaining: 28939, percent_remaining: 57.8, unlimited: false },
    },
  }

  test("reads the premium interactions quota", () => {
    expect(parseCopilot(body)).toEqual(quota())
  })

  test("falls back to the local reset date", () => {
    const parsed = parseCopilot({ ...body, quota_reset_date_utc: undefined })
    expect(parsed.resetAt.toISOString()).toBe("2026-11-01T00:00:00.000Z")
  })

  test("rejects malformed bodies", () => {
    expect(() => parseCopilot({ quota_snapshots: {} })).toThrow(/premium_interactions/)
    expect(() => parseCopilot(null)).toThrow(/bad body/)
    expect(() =>
      parseCopilot({ ...body, quota_snapshots: { premium_interactions: { entitlement: "50000" } } }),
    ).toThrow(/entitlement/)
    expect(() => parseCopilot({ ...body, quota_reset_date_utc: "nope" })).toThrow(/reset date/)
  })
})

describe("parseCodex", () => {
  test("reads the weekly window from a real response", () => {
    expect(codexWeekly).toEqual({
      percentRemaining: 0,
      resetAt: new Date(1792649730 * 1000),
      period: "week",
      unlimited: false,
    })
    expect(codexWeekly.resetAt.toISOString().slice(0, 10)).toBe("2026-10-22")
  })

  test("picks the longest window whichever slot holds it", () => {
    const weeklySecond = { rate_limit: { primary_window: fiveHourWindow, secondary_window: { ...weeklyWindow, used_percent: 42 } } }
    const weeklyFirst = { rate_limit: { primary_window: { ...weeklyWindow, used_percent: 42 }, secondary_window: fiveHourWindow } }
    expect(parseCodex(weeklySecond).percentRemaining).toBe(58)
    expect(parseCodex(weeklyFirst).percentRemaining).toBe(58)
  })

  test("rejects a response with no usable window", () => {
    expect(() => parseCodex({ plan_type: "x", rate_limit: null })).toThrow(/no weekly window/)
    expect(() => parseCodex({ rate_limit: { primary_window: null, secondary_window: null } })).toThrow(/no weekly window/)
    expect(() => parseCodex(null)).toThrow(/no weekly window/)
  })
})

describe("parseClaude", () => {
  const body = {
    five_hour: { utilization: 37.0, resets_at: "2026-10-16T14:00:00.000000+00:00" },
    seven_day: { utilization: 26.0, resets_at: "2026-10-20T04:00:00.000000+00:00" },
    seven_day_opus: null,
  }

  test("reads the seven day window", () => {
    expect(parseClaude(body)).toEqual({
      percentRemaining: 74,
      resetAt: new Date("2026-10-20T04:00:00.000Z"),
      period: "week",
      unlimited: false,
    })
  })

  test("rejects a missing or malformed seven day window", () => {
    expect(() => parseClaude({ ...body, seven_day: null })).toThrow(/no weekly window/)
    expect(() => parseClaude({ seven_day: { utilization: "26", resets_at: "x" } })).toThrow(/no weekly window/)
  })
})

describe("jwtExpiry", () => {
  const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`

  test("returns the expiry in milliseconds", () => {
    expect(jwtExpiry(jwt({ exp: 1792649730 }))).toBe(1792649730 * 1000)
  })

  test("returns undefined when the token has no readable expiry", () => {
    expect(jwtExpiry(jwt({ sub: "x" }))).toBeUndefined()
    expect(jwtExpiry("not-a-jwt")).toBeUndefined()
    expect(jwtExpiry("")).toBeUndefined()
  })
})

describe("nextSource", () => {
  test("walks the order and wraps", () => {
    expect(nextSource(SOURCE_ORDER, "copilot", states())).toBe("openai")
    expect(nextSource(SOURCE_ORDER, "openai", states())).toBe("anthropic")
    expect(nextSource(SOURCE_ORDER, "anthropic", states())).toBe("copilot")
    expect(nextSource(SOURCE_ORDER, undefined, states())).toBe("copilot")
  })

  test("skips absent sources", () => {
    expect(nextSource(SOURCE_ORDER, "copilot", states({ openai: { type: "absent" } }))).toBe("anthropic")
    expect(nextSource(SOURCE_ORDER, "anthropic", states({ copilot: { type: "absent" } }))).toBe("openai")
  })

  test("keeps failed sources in the rotation", () => {
    expect(nextSource(SOURCE_ORDER, "copilot", states({ openai: { type: "failed", error: "x" } }))).toBe("openai")
    expect(nextSource(SOURCE_ORDER, "openai", states({ openai: { type: "failed", error: "x" } }))).toBe("anthropic")
  })

  test("stays on the shown source when no other qualifies", () => {
    const onlyCopilot = states({ openai: { type: "absent" }, anthropic: { type: "absent" } })
    expect(nextSource(SOURCE_ORDER, "copilot", onlyCopilot)).toBe("copilot")
  })

  test("returns nothing when every source is absent", () => {
    expect(nextSource(SOURCE_ORDER, "copilot", allAbsent)).toBeUndefined()
  })
})

describe("pickSource", () => {
  test("follows the provider of the selected model", () => {
    expect(pickSource("github-copilot", states())).toBe("copilot")
    expect(pickSource("openai", states())).toBe("openai")
    expect(pickSource("anthropic", states())).toBe("anthropic")
  })

  test("falls back to the first present source", () => {
    expect(pickSource("opencode-go", states())).toBe("copilot")
    expect(pickSource("opencode-go", states({ copilot: { type: "absent" } }))).toBe("openai")
    expect(pickSource("openai", states({ openai: { type: "absent" } }))).toBe("copilot")
    expect(pickSource(undefined, states())).toBe("copilot")
  })

  test("returns nothing when every source is absent", () => {
    expect(pickSource("openai", allAbsent)).toBeUndefined()
  })
})

describe("connectedProviders", () => {
  const integrations = [
    { id: "anthropic", methods: [{ type: "env" }, { type: "key" }], connections: [] },
    { id: "github-copilot", methods: [{ type: "oauth" }], connections: [{ type: "credential" }] },
    { id: "openai", methods: [{ type: "oauth" }], connections: [{ type: "credential" }] },
    { id: "opencode-go", methods: [{ type: "key" }], connections: [{ type: "credential" }] },
    { id: "groq", methods: [{ type: "env" }], connections: [{ type: "env" }] },
  ]
  const sourcesFor = (connected: ReadonlySet<string>) =>
    SOURCES.filter((source) => isConfigured(source, connected)).map((source) => source.id)

  test("keeps integrations that have a connection, saved login or env key", () => {
    const connected = connectedProviders({ location: { directory: "/x" }, data: integrations })
    expect([...connected].sort()).toEqual(["github-copilot", "groq", "openai", "opencode-go"])
    expect(sourcesFor(connected)).toEqual(["copilot", "openai"])
  })

  test("adds a source when its provider gets connected", () => {
    const withKey = connectedProviders({ data: [...integrations.slice(1), { id: "anthropic", connections: [{ type: "env" }] }] })
    expect(sourcesFor(withKey)).toEqual(["copilot", "openai", "anthropic"])
  })

  test("ignores malformed entries", () => {
    const entries = [null, { id: 1, connections: [{}] }, { id: "x" }, { id: "y", connections: "no" }, { id: "z", connections: [] }]
    expect(connectedProviders({ data: entries }).size).toBe(0)
  })

  test("rejects anything but the response envelope", () => {
    expect(() => connectedProviders(integrations)).toThrow(/bad integrations/)
    expect(() => connectedProviders(undefined)).toThrow(/bad integrations/)
  })
})
