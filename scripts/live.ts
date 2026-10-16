import { loaders, type Credential } from "../sources"
import { view, type SourceID, type State } from "../quota"

const labels: Record<SourceID, string> = { copilot: "Copilot", openai: "OpenAI", anthropic: "Claude" }

const result = Bun.spawnSync(["opencode", "api", "get", "/api/credential"])
if (result.exitCode !== 0) throw new Error("`opencode api get /api/credential` failed. Is OpenCode installed and running?")
const credentials = (JSON.parse(result.stdout.toString()) as { data: Credential[] }).data
const env = { credentials: async () => credentials }

const ids = (Bun.argv.slice(2).length ? Bun.argv.slice(2) : ["copilot", "openai"]) as SourceID[]

for (const id of ids) {
  let state: State
  try {
    const loaded = await loaders[id](env)
    state = loaded ? { type: "ready", quota: loaded } : { type: "absent" }
  } catch (error) {
    state = { type: "failed", error: error instanceof Error ? error.message : "offline" }
  }
  const shown = view(state, Date.now(), "full", labels[id])
  console.log(`${id}: ${state.type}`, shown.text ? `${shown.text} (${shown.tone})` : "")
}
