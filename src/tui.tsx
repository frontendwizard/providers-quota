import { Plugin } from "@opencode/plugin/tui"
import { RGBA } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import { loaders, type Env } from "./sources"
import {
  connectedProviders,
  DEFAULT_SETTINGS,
  hoverRgb,
  isConfigured,
  nextSource,
  pickSource,
  resolveSettings,
  SOURCE_ORDER,
  SOURCES,
  view,
  type Mode,
  type Quota,
  type Settings,
  type SourceID,
  type State,
  type States,
  type Tone,
} from "./quota"

const REFRESH_MS = 60_000
const SNAP_BACK_MS = 1000

const labels = new Map(SOURCES.map((source) => [source.id, source.label]))
const initial = (): States => ({
  copilot: { type: "loading" },
  openai: { type: "loading" },
  anthropic: { type: "loading" },
  xai: { type: "loading" },
  go: { type: "loading" },
})

const lastQuota = (state: State): Quota | undefined =>
  state.type === "ready" ? state.quota : state.type === "failed" ? state.last : undefined

export default Plugin.define({
  id: "providers-quota",
  async setup(context) {
    const [states, setStates] = createSignal<States>(initial())
    const [manual, setManual] = createSignal<SourceID | undefined>(undefined)
    const [stored, updateStored] = context.storage.store("settings", { initial: DEFAULT_SETTINGS })
    const settings = () => resolveSettings(stored)
    const change = (patch: (current: Settings) => Partial<Settings>) =>
      updateStored((draft) => {
        Object.assign(draft, patch(settings()))
      })
    const mode = (): Mode => (settings().compact ? "compact" : "full")
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
    const channels = (value: RGBA): readonly [number, number, number] => {
      const [red, green, blue] = value.toInts()
      return [red, green, blue]
    }
    const QuotaLine = (props: { divider?: "before" | "after" }) => {
      const [hovered, setHovered] = createSignal(false)
      const line = () => {
        const id = shown()
        if (!id) return undefined
        const result = view(states()[id], Date.now(), mode(), labels.get(id) ?? id, settings().reset[mode()])
        return result.text ? result : undefined
      }
      const fg = (tone: Tone) => {
        const resting = settings().colored ? color(tone) : context.theme.text.muted
        if (!hovered()) return resting
        if (resting.equals(context.theme.text.muted)) return context.theme.text.base
        const next = hoverRgb(channels(resting), channels(context.theme.text.muted), channels(context.theme.text.base))
        return RGBA.fromInts(next[0], next[1], next[2], resting.toInts()[3])
      }
      const divider = (side: "before" | "after") => (
        <Show when={props.divider === side}>
          <span style={{ fg: context.theme.text.muted }}>{side === "before" ? "· " : " ·"}</span>
        </Show>
      )
      // Rotate on release: the text is right-aligned and resizes on rotation, so a press
      // handler would let the release land on the neighbouring footer location, which opens a dialog.
      return (
        <Show when={line()}>
          {(current) => (
            <box
              flexShrink={0}
              onMouseOver={() => setHovered(true)}
              onMouseOut={() => setHovered(false)}
              onMouseUp={rotate}
            >
              <text fg={fg(current().tone)} selectable={false} wrapMode="none">
                {divider("before")}
                {current().text}
                {divider("after")}
              </text>
            </box>
          )}
        </Show>
      )
    }

    const inSession = () => context.ui.router.current().type === "session"
    const unslot = [
      // Right goes after the built-in shell and subagent indicator and the hints, and never
      // shrinks, so a shell starting on its left squeezes only the path. Left goes in the status
      // box beside the path, and it moves when the indicator appears. The dot faces the stats.
      // The home footer already shows the line, and the narrow home prompt would wrap it.
      context.ui.slot({
        append: "prompt.footer",
        render: () => (
          <Show when={inSession() && settings().position === "right"}>
            <QuotaLine divider="before" />
          </Show>
        ),
      }),
      context.ui.slot({
        append: "prompt.footer.status",
        render: () => (
          <Show when={inSession() && settings().position === "left"}>
            <QuotaLine divider="after" />
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
          run: () => change((current) => ({ compact: !current.compact })),
        },
        {
          id: "providers-quota.reset",
          title: "Toggle the reset date in the quota line",
          group: "Provider quota",
          palette: true,
          slash: { name: "quota-reset" },
          run: () => change((current) => ({ reset: { ...current.reset, [mode()]: !current.reset[mode()] } })),
        },
        {
          id: "providers-quota.position",
          title: "Move the quota line left or right of the session stats",
          group: "Provider quota",
          palette: true,
          slash: { name: "quota-position" },
          run: () => change((current) => ({ position: current.position === "right" ? "left" : "right" })),
        },
        {
          id: "providers-quota.color",
          title: "Toggle the quota line color",
          group: "Provider quota",
          palette: true,
          slash: { name: "quota-color" },
          run: () => change((current) => ({ colored: !current.colored })),
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
