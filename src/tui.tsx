import { Plugin } from "@opencode/plugin/tui"
import { createSignal, Show } from "solid-js"
import { loaders, type Env } from "./sources"
import {
  connectedProviders,
  isConfigured,
  nextSource,
  pickSource,
  SOURCE_ORDER,
  SOURCES,
  view,
  type Mode,
  type Quota,
  type SourceID,
  type State,
  type States,
  type Tone,
} from "./quota"

const REFRESH_MS = 60_000
const SNAP_BACK_MS = 1000

const labels = new Map(SOURCES.map((source) => [source.id, source.label]))
const initial = (): States => ({ copilot: { type: "loading" }, openai: { type: "loading" }, anthropic: { type: "loading" } })

const lastQuota = (state: State): Quota | undefined =>
  state.type === "ready" ? state.quota : state.type === "failed" ? state.last : undefined

export default Plugin.define({
  id: "providers-quota",
  async setup(context) {
    const [states, setStates] = createSignal<States>(initial())
    const [manual, setManual] = createSignal<SourceID | undefined>(undefined)
    const [settings, updateSettings] = context.storage.store("settings", { initial: { compact: false } })
    const mode = (): Mode => (settings.compact ? "compact" : "full")
    const env: Env = { credentials: async () => await context.client.credential.list() }
    const inFlight = new Set<SourceID>()
    let snapBack: ReturnType<typeof setTimeout> | undefined

    const shown = (): SourceID | undefined => {
      const chosen = manual()
      if (chosen && states()[chosen].type !== "absent") return chosen
      return pickSource(context.ui.model.current()?.providerID, states())
    }

    const rotate = () => {
      const next = nextSource(SOURCE_ORDER, shown(), states())
      if (!next) return
      setManual(next)
      clearTimeout(snapBack)
      snapBack = setTimeout(() => setManual(undefined), SNAP_BACK_MS)
    }

    const update = (id: SourceID, next: (prev: State) => State) =>
      setStates((prev) => ({ ...prev, [id]: next(prev[id]) }))

    const refresh = async (id: SourceID) => {
      if (inFlight.has(id)) return
      inFlight.add(id)
      try {
        const quota = await loaders[id](env)
        update(id, () => (quota ? { type: "ready", quota } : { type: "absent" }))
      } catch (error) {
        const message = error instanceof Error ? error.message : "offline"
        update(id, (prev) => ({ type: "failed", error: message, last: lastQuota(prev) }))
      } finally {
        inFlight.delete(id)
      }
    }

    const color = (tone: Tone) => (tone === "muted" ? context.theme.text.muted : context.theme.text.feedback[tone].base)
    const QuotaLine = () => {
      const line = () => {
        const id = shown()
        if (!id) return undefined
        const result = view(states()[id], Date.now(), mode(), labels.get(id) ?? id)
        return result.text ? result : undefined
      }
      // Rotate on release: the text is right-aligned and resizes on rotation, so a press
      // handler would let the release land on the neighbouring footer location, which opens a dialog.
      return (
        <Show when={line()}>
          {(current) => (
            <text fg={color(current().tone)} selectable={false} flexShrink={0} onMouseUp={rotate}>
              {current().text}
            </text>
          )}
        </Show>
      )
    }

    const unslot = [
      // Appended after the built-in shell and subagent indicator and never shrunk, so a shell
      // starting on its left squeezes only the path. The home footer already shows the line,
      // and the narrow home prompt would wrap it.
      context.ui.slot({
        append: "prompt.footer",
        render: () => (
          <Show when={context.ui.router.current().type === "session"}>
            <QuotaLine />
          </Show>
        ),
      }),
      context.ui.slot({ append: "home.footer.status", render: () => <QuotaLine /> }),
    ]

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "providers-quota.compact",
          title: "Toggle compact quota",
          group: "Provider quota",
          palette: true,
          slash: { name: "quota" },
          run: () =>
            updateSettings((draft) => {
              draft.compact = !draft.compact
            }),
        },
        {
          id: "providers-quota.next",
          title: "Next quota source",
          group: "Provider quota",
          palette: true,
          slash: { name: "quota-next" },
          run: rotate,
        },
      ],
    }))

    let connected: ReadonlySet<string> | undefined
    const refreshAll = async () => {
      try {
        connected = connectedProviders(await context.client.integration.list())
      } catch {
        // Keep the last known set. Until a lookup succeeds nothing counts as configured,
        // so no loader reads a foreign credential.
      }
      for (const source of SOURCES) {
        if (connected && isConfigured(source, connected)) void refresh(source.id)
        else update(source.id, () => ({ type: "absent" }))
      }
    }
    void refreshAll()
    const timer = setInterval(() => void refreshAll(), REFRESH_MS)
    timer.unref?.()

    return () => {
      clearInterval(timer)
      clearTimeout(snapBack)
      for (const stop of unslot) stop()
    }
  },
})
