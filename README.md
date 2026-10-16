# providers-quota

An [OpenCode](https://opencode.ai) plugin that shows how much of each AI subscription you have left, in the footer.

```text
Copilot 55.8% left (27,943/50,000) · resets Nov 1
OpenAI 0% left · weekly · resets Oct 22
```

Click the line to switch to the next subscription. One second after your last click, it switches back to the provider of the model you are using.

## What you need

- OpenCode 2.0 or later. The plugin uses the OpenCode 2 plugin API. It has been tested on OpenCode 2.0.30 on macOS only.
- At least one provider from the table below, connected in OpenCode.

## Install

Run this command, then restart OpenCode.

```sh
opencode plugin add github:frontendwizard/providers-quota
```

`plugin add` writes the plugin to `cli.json` in your OpenCode config directory, so it applies to every project.

To install without `plugin add`, clone the repository into a plugin folder. For one project, run this in the project root.

```sh
git clone https://github.com/frontendwizard/providers-quota .opencode/plugins/providers-quota
```

For every project, clone it into your OpenCode config directory instead.

```sh
git clone https://github.com/frontendwizard/providers-quota ~/.config/opencode/plugins/providers-quota
```

To keep the clone somewhere else, add its path to `cli.json` in your OpenCode config directory.

```json
{
	"plugins": ["/path/to/providers-quota"]
}
```

The repository contains the compiled plugin, `tui.js`, so there is nothing to install or build.

## Supported providers

| Footer label | Limit shown | Reads usage from | Needs |
| --- | --- | --- | --- |
| Copilot | Premium requests per month | `api.github.com/copilot_internal/user`, with OpenCode's own GitHub Copilot login | `github-copilot` connected in OpenCode |
| OpenAI | Weekly | `chatgpt.com/backend-api/wham/usage`, with the token in `~/.codex/auth.json` | `openai` connected in OpenCode, and a Codex CLI signed in with ChatGPT |
| Claude | Weekly (seven days) | `api.anthropic.com/api/oauth/usage`, with the token in the macOS Keychain item `Claude Code-credentials` | `anthropic` connected in OpenCode, macOS, and Claude Code signed in |

The plugin asks OpenCode which providers are connected, either as a saved login or as an API key in an environment variable. It shows a provider only when OpenCode has it connected and the plugin has a reader for it. Other connected providers, such as OpenCode Go, expose no usage endpoint, so the plugin skips them.

OpenAI usage comes from your Codex CLI login and not from OpenCode's OpenAI login. In testing on OpenCode 2.0.30, the usage endpoint rejected OpenCode's token with a 401. That token is issued for calling models.

## Use

The line sits in the footer on the home screen. Inside a session it sits at the right end of the prompt row, after the built-in shell and subagent indicator, so it does not move when a background shell starts. A muted dot divider, like the ones between the built-in footer segments, comes before it. On a terminal narrower than about 90 columns the full format is cut off at the right edge, so use `/quota` for the compact format. Every 60 seconds the plugin checks which providers are connected and refreshes the usage of each one. A newly connected provider appears after its first usage request finishes.

- Click the line to show the next provider. Rotation order is Copilot, OpenAI, Claude. It skips providers that are not set up and keeps providers whose last refresh failed, because their message tells you the fix.
- One second after your last click, the line returns to the provider of the model you are using. When that provider is not set up, it returns to the first provider in the rotation order that is.
- Run `/quota-next` to rotate from the keyboard. It is also in the command palette as "Next quota source".
- Run `/quota` to switch between the full and the compact format. OpenCode remembers the choice across restarts.

| | Full | Compact |
| --- | --- | --- |
| Monthly | `Copilot 55.8% left (27,943/50,000) · resets Nov 1` | `Copilot 55.8% left` |
| Weekly | `OpenAI 0% left · weekly · resets Oct 22` | `OpenAI 0% left` |

The color compares the share of quota left with the share of the period left.

- Green means you are on pace or ahead.
- Yellow means you are using quota faster than the period passes.
- Red means less than 10% is left, or a refresh failed and there is no earlier reading to show.
- Gray means the plan is unlimited, the first request is still loading and the text reads `Copilot …`, or a refresh failed and the text shows the last reading with "· stale".

When a refresh fails and there is no earlier reading, the line shows the provider and a short message, for example `OpenAI quota: Codex login expired`.

| Message | What to do |
| --- | --- |
| `not logged in` | Sign in to GitHub Copilot in OpenCode. |
| `Codex login expired` or `Codex login unreadable` | Run the Codex CLI once so that it refreshes `~/.codex/auth.json`. |
| `Claude Code login expired` or `Claude Code login unreadable` | Run Claude Code once so that it refreshes its Keychain entry. |
| `Keychain timed out` or `Keychain unavailable` | Answer the macOS Keychain dialog, then wait up to 10 minutes for the next read. |
| `offline` | Check your network connection. The plugin retries after 60 seconds. |
| `HTTP 401` or `HTTP 403` | The provider rejected the token. Sign in again. |
| Another `HTTP` code | The provider failed or rate-limited the request. The plugin retries after 60 seconds. |
| `bad body`, `no weekly window`, `no premium_interactions`, or `bad` followed by a field name | The provider changed its response, or the response was not JSON. Open an issue with the shape of the response, with secrets removed. |

The plugin has no options. To change the refresh interval or the snap-back delay, edit `REFRESH_MS` or `SNAP_BACK_MS` at the top of `src/tui.tsx`, then run `bun run compile`.

## Credentials and privacy

- The plugin only reads credentials. It never refreshes a token and never writes to `~/.codex`, the Keychain, or OpenCode's credential store. A refresh can rotate the refresh token and sign you out of Codex or Claude Code.
- Each token goes only to the provider's own host, listed in the table above. The plugin has no telemetry and writes no logs.
- It reads the Keychain only when Anthropic is connected in OpenCode. A read happens when no usable token is cached, and then at most once every 10 minutes. macOS may ask you to allow it. If the plugin cannot get the list of connected providers, it treats every provider as not connected and reads nothing.
- OpenCode stores one setting for the plugin, the compact flag.

## Limitations

- All three usage endpoints are undocumented. A provider can change or remove one without notice, and the line then shows an error.
- The Claude reader has never run against a live response. Its parser follows the response shape that `api.anthropic.com/api/oauth/usage` is expected to return, `seven_day.utilization` and `seven_day.resets_at`, and it is covered only by a fixture. If you use it, report whether the number matches Claude Code.
- Claude Code and the Codex CLI refresh their tokens only while you use them. The Claude and OpenAI lines read "login expired" once the token lapses, until you run the tool again.
- The OpenAI reader labels the longest window it finds as weekly. A plan with only a five-hour window would be labeled wrongly.
- The Copilot reader has been tested on a Copilot Enterprise seat. Other plans are untested.

## Develop

```sh
bun install
bun test
bun run typecheck
bun run compile
bun run live
bun run live anthropic
```

`bun test` runs offline against fixtures taken from real responses. `bun run live` reads your real Copilot and OpenAI logins and prints the footer text. `bun run live anthropic` also reads the Keychain.

OpenCode loads the compiled `tui.js`, not `src/tui.tsx`. Run `bun run compile` after every change to `src/` and commit the result. CI fails when `tui.js` is out of date. The plugin ships compiled because OpenCode compiles Solid JSX only for files outside `node_modules`, and `plugin add` installs packages there. See [anomalyco/opencode#39986](https://github.com/anomalyco/opencode/issues/39986). The compile leaves `solid-js`, `@opentui/*`, and `@opencode/plugin` as imports, and OpenCode supplies them when it loads the plugin.

The type-check does not catch a color from `theme.text.feedback` used without `.base`, because the `fg` prop accepts it and the text then renders white. Check visual changes in a real OpenCode session.

To add a provider, add its id to `SourceID` in `src/quota.ts`. The type-check then lists every place that needs the new key. Add an entry to `SOURCES`, a parser for the provider's response in the same file, and a loader in `src/sources.ts`. Add fixtures for the parser in `test/quota.test.ts`.

## License

[MIT](LICENSE)
