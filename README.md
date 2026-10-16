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

OpenCode loads plugins from plugin folders, so you clone this repository into one.

To install the plugin for one project, run this in the project root.

```sh
git clone https://github.com/frontendwizard/providers-quota .opencode/plugins/providers-quota
```

To install it for every project, clone it into your OpenCode config directory instead.

```sh
git clone https://github.com/frontendwizard/providers-quota ~/.config/opencode/plugins/providers-quota
```

To keep the clone somewhere else, add its path to `cli.json` in your OpenCode config directory.

```json
{
	"plugins": ["/path/to/providers-quota"]
}
```

Restart OpenCode. The plugin has no dependencies to install.

`opencode plugin add` does not work with this plugin. OpenCode compiles Solid JSX for every file except those under `node_modules`, and `plugin add` installs packages there. OpenCode 2.0.30 then fails to load `tui.tsx` with "Cannot find package 'react'".

## Supported providers

| Footer label | Limit shown | Reads usage from | Needs |
| --- | --- | --- | --- |
| Copilot | Premium requests per month | `api.github.com/copilot_internal/user`, with OpenCode's own GitHub Copilot login | `github-copilot` connected in OpenCode |
| OpenAI | Weekly | `chatgpt.com/backend-api/wham/usage`, with the token in `~/.codex/auth.json` | `openai` connected in OpenCode, and a Codex CLI signed in with ChatGPT |
| Claude | Weekly (seven days) | `api.anthropic.com/api/oauth/usage`, with the token in the macOS Keychain item `Claude Code-credentials` | `anthropic` connected in OpenCode, macOS, and Claude Code signed in |

The plugin asks OpenCode which providers are connected, either as a saved login or as an API key in an environment variable. It shows a provider only when OpenCode has it connected and the plugin has a reader for it. Other connected providers, such as OpenCode Go, expose no usage endpoint, so the plugin skips them. The plugin checks again every 60 seconds, so a newly connected provider appears on the next check.

OpenAI usage comes from your Codex CLI login and not from OpenCode's OpenAI login. OpenCode signs in to ChatGPT with a token that can call models but cannot read usage, and the usage endpoint rejects it with a 401.

## Use

The line sits in the prompt row inside a session and in the footer on the home screen.

- Click the line to show the next provider. Rotation order is Copilot, OpenAI, Claude. It skips providers that are not set up and keeps providers whose last refresh failed, because their message tells you the fix.
- Run `/quota-next` to do the same from the keyboard. It is also in the command palette as "Next quota source".
- Run `/quota` to switch between the full and the compact format. OpenCode remembers the choice across restarts.

| | Full | Compact |
| --- | --- | --- |
| Monthly | `Copilot 55.8% left (27,943/50,000) · resets Nov 1` | `Copilot 55.8% left` |
| Weekly | `OpenAI 0% left · weekly · resets Oct 22` | `OpenAI 0% left` |

The color compares the share of quota left with the share of the period left.

- Green means you are on pace or ahead.
- Yellow means you are using quota faster than the period passes.
- Red means less than 10% is left.
- Gray means the text is loading, the plan is unlimited, or a refresh failed and the text shows the last reading with "· stale".

When a provider has no earlier reading and its refresh fails, the line shows the provider and a short message, for example `OpenAI quota: Codex login expired`.

| Message | What to do |
| --- | --- |
| `not logged in` | Sign in to GitHub Copilot in OpenCode. |
| `Codex login expired` or `Codex login unreadable` | Run the Codex CLI once so that it refreshes `~/.codex/auth.json`. |
| `Claude Code login expired` or `Claude Code login unreadable` | Run Claude Code once so that it refreshes its Keychain entry. |
| `Keychain timed out` or `Keychain unavailable` | Answer the macOS Keychain dialog, then wait up to 10 minutes for the next read. |
| `offline` | Check your network connection. |
| `HTTP 401` or another `HTTP` code | The provider rejected the token. Sign in again. |
| `no weekly window`, `no premium_interactions`, `bad body` | The provider changed its response. Open an issue with the shape of the response, with secrets removed. |

The plugin has no options. To change the refresh interval or the snap-back delay, edit `REFRESH_MS` or `SNAP_BACK_MS` at the top of `tui.tsx`.

## Credentials and privacy

- The plugin only reads credentials. It never refreshes a token and never writes to `~/.codex`, the Keychain, or OpenCode's credential store. A refresh can rotate the refresh token and sign you out of Codex or Claude Code.
- Each token goes only to the provider's own host, listed in the table above. The plugin has no telemetry and writes no logs.
- It reads the Keychain only when Anthropic is connected in OpenCode. A read happens when no usable token is cached, and then at most once every 10 minutes. macOS may ask you to allow it.
- OpenCode stores one setting for the plugin, the compact flag.

## Limitations

- All three usage endpoints are undocumented. A provider can change or remove one without notice, and the line then shows an error.
- The Claude reader has never run against a live response. Its parser follows the response shape that `api.anthropic.com/api/oauth/usage` is expected to return, `seven_day.utilization` and `seven_day.resets_at`, and it is covered only by a fixture. If you use it, report whether the number matches Claude Code.
- Claude Code refreshes its token only when you use it, so the Claude line reads "Claude Code login expired" after a day without Claude Code. The same applies to the Codex CLI.
- The OpenAI reader labels the longest window it finds as weekly. A plan with only a five-hour window would be labeled wrongly.
- The Copilot reader has been tested on a Copilot Enterprise seat. Other plans are untested.

## Develop

```sh
bun install
bun test
bun run typecheck
bun run live
bun run live anthropic
```

`bun test` runs offline against fixtures taken from real responses. `bun run live` reads your real Copilot and OpenAI logins and prints the footer text. `bun run live anthropic` also reads the Keychain.

The type-check does not catch a theme color used without `.base`, because the `fg` prop accepts it and the text then renders white. Check visual changes in a real OpenCode session.

To add a provider, add an entry to `SOURCES` in `quota.ts`, a parser for its response in the same file, and a loader in `sources.ts`. Add fixtures for the parser in `test/quota.test.ts`.

## License

[MIT](LICENSE)
