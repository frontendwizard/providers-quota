import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { jwtExpiry, parseClaude, parseCodex, parseCopilot, parseGo, parseXai, type Quota, type SourceID } from "./quota"

const USER_AGENT = "providers-quota/1.0"
const KEYCHAIN_TIMEOUT_MS = 20_000
const KEYCHAIN_RETRY_MS = 10 * 60_000

export type Credential = {
  integrationID: string
  active: boolean
  value: { type: string; refresh?: string; access?: string; expires?: number; key?: string }
}
export type Env = { credentials: () => Promise<Credential[]> }
/** Resolves to null when the user has no login for this source, so the footer skips it. */
export type Loader = (env: Env) => Promise<Quota | null>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error("offline")
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new Error("bad body")
  }
}

const loadCopilot: Loader = async (env) => {
  const credentials = await env.credentials()
  const credential = credentials.find((item) => item.integrationID === "github-copilot" && item.active)
  if (credential?.value.type !== "oauth") throw new Error("not logged in")
  return parseCopilot(
    await getJson("https://api.github.com/copilot_internal/user", {
      Authorization: `Bearer ${credential.value.refresh}`,
      "X-GitHub-Api-Version": "2025-04-01",
    }),
  )
}

const loadOpenAI: Loader = async () => {
  const file = join(homedir(), ".codex", "auth.json")
  let raw: string
  try {
    raw = await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new Error("Codex login unreadable")
  }
  let auth: unknown
  try {
    auth = JSON.parse(raw)
  } catch {
    throw new Error("Codex login unreadable")
  }
  const tokens = isRecord(auth) && isRecord(auth.tokens) ? auth.tokens : undefined
  const token = tokens?.access_token
  if (typeof token !== "string" || token === "") return null

  const expiry = jwtExpiry(token)
  if (expiry !== undefined && expiry <= Date.now()) throw new Error("Codex login expired")
  const account = tokens?.account_id
  return parseCodex(
    await getJson("https://chatgpt.com/backend-api/wham/usage", {
      Authorization: `Bearer ${token}`,
      ...(typeof account === "string" ? { "ChatGPT-Account-Id": account } : {}),
    }),
  )
}

type Keychain = { type: "token"; token: string; expiresAt: number } | { type: "absent" } | { type: "error"; message: string }

const readKeychain = (): Promise<Keychain> =>
  new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          // `security` exits 44 when the item does not exist.
          if (error.code === 44) return resolve({ type: "absent" })
          return resolve({ type: "error", message: error.killed ? "Keychain timed out" : "Keychain unavailable" })
        }
        try {
          const oauth = (JSON.parse(stdout) as { claudeAiOauth?: Record<string, unknown> }).claudeAiOauth
          const token = oauth?.accessToken
          if (typeof token !== "string" || token === "") return resolve({ type: "absent" })
          const expiresAt = typeof oauth?.expiresAt === "number" ? oauth.expiresAt : 0
          resolve({ type: "token", token, expiresAt })
        } catch {
          resolve({ type: "error", message: "Claude Code login unreadable" })
        }
      },
    )
  })

// Every Keychain read may raise a macOS permission dialog, so a read happens only
// when no usable token is cached and the last read is 10 minutes old.
let keychain: { at: number; result: Keychain } | undefined

async function claudeLogin(now: number): Promise<Keychain> {
  const cached = keychain
  if (cached) {
    const usable = cached.result.type === "token" && cached.result.expiresAt > now
    if (usable || now - cached.at < KEYCHAIN_RETRY_MS) return cached.result
  }
  keychain = { at: now, result: await readKeychain() }
  return keychain.result
}

const loadAnthropic: Loader = async () => {
  if (platform() !== "darwin") return null
  const login = await claudeLogin(Date.now())
  if (login.type === "absent") return null
  if (login.type === "error") throw new Error(login.message)
  if (login.expiresAt <= Date.now()) throw new Error("Claude Code login expired")
  return parseClaude(
    await getJson("https://api.anthropic.com/api/oauth/usage", {
      Authorization: `Bearer ${login.token}`,
      "anthropic-beta": "oauth-2025-04-20",
    }),
  )
}

const loadXai: Loader = async (env) => {
  const credentials = await env.credentials()
  const credential = credentials.find((item) => item.integrationID === "xai" && item.active)
  if (credential?.value.type !== "oauth" || typeof credential.value.access !== "string" || credential.value.access === "")
    return null
  const access = credential.value.access
  const expiry = typeof credential.value.expires === "number" ? credential.value.expires : jwtExpiry(access)
  if (expiry !== undefined && expiry <= Date.now()) throw new Error("xAI login expired")
  return parseXai(
    await getJson("https://cli-chat-proxy.grok.com/v1/billing?format=credits", {
      Authorization: `Bearer ${access}`,
      "x-xai-token-auth": "xai-grok-cli",
    }),
  )
}

const loadGo: Loader = async (env) => {
  const credentials = await env.credentials()
  const credential = credentials.find((item) => item.integrationID === "opencode-go" && item.active)
  if (credential?.value.type !== "key" || typeof credential.value.key !== "string" || credential.value.key === "")
    return null
  return parseGo(
    await getJson("https://opencode.ai/zen/go/v1/usage", {
      Authorization: `Bearer ${credential.value.key}`,
    }),
  )
}

export const loaders: Record<SourceID, Loader> = {
  copilot: loadCopilot,
  openai: loadOpenAI,
  anthropic: loadAnthropic,
  xai: loadXai,
  go: loadGo,
}
