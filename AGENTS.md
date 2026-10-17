# Agent instructions

providers-quota is an OpenCode 2 plugin that shows subscription limits in the footer. It reads other tools' credentials, so read "Credentials" before you change `src/sources.ts`.

## Open a pull request for every fix or improvement

When you find a bug, a wrong README claim, a missing test, or an improvement, open a pull request for it. Do this even when it is not the task you were given. Do not only mention it in your reply.

- Branch from `main`. Name the branch `fix/<topic>`, `feat/<topic>`, `docs/<topic>`, or `test/<topic>`.
- Open one pull request for each fix or improvement. Do not bundle unrelated changes.
- Open the pull request as ready for review, not as a draft.
- Never merge a pull request, including your own. The owner reviews and merges.
- Never force-push a branch you did not create.
- After you push, run `gh pr checks`. Fix a failing check before you report the pull request as done.
- If you cannot finish a fix, open an issue that describes the problem and what you tried.

## Before you open the pull request

Run these three commands from a clean `bun install`. All three must pass.

```sh
bun run typecheck
bun test
bun run compile
```

OpenCode loads `tui.js`, not `src/tui.tsx`. If you change anything under `src/`, run `bun run compile` and commit the new `tui.js` in the same pull request. CI fails when `tui.js` differs from a fresh compile. CI pins Bun 1.3.11. Use that version, or the compiled bytes can differ.

Do not add a script named `build`, `prepare`, or `prepack` to `package.json`. A script named `build` made `opencode plugin add` fail, because npm then prepares the git dependency with a nested install. The script is named `compile` for that reason.

Add or update a test in `test/quota.test.ts` for each behavior you change. Build fixtures from real responses, with ids, emails, and tokens removed.

If you change behavior, change the README in the same pull request. Every claim in the README must match the code.

A change to what the footer shows or does needs a check in a real OpenCode 2 session. The type-check misses some rendering bugs. For example, a `theme.text.feedback` color used without `.base` type-checks and renders white. Run OpenCode in tmux, click the footer with a real mouse event, and capture the screen.

```sh
tmux send-keys -t <session> -l $'\e[<0;<col>;<row>M'
tmux send-keys -t <session> -l $'\e[<0;<col>;<row>m'
```

Do not send a model prompt while you test. Every prompt spends the owner's subscription quota.

## Write the pull request

- Write the title in Conventional Commits form, for example `fix(sources): show bad body for an unreadable response`. Use `feat`, `fix`, `docs`, `test`, `refactor`, or `chore`. Add no trailing period.
- Use these headings in the body, and drop a heading that has nothing to say: `## Why`, `## What changed`, `## Verification`, `## Not verified`.
- Under Verification, list each command or manual check you ran and its result. List what you did not check under Not verified. Never claim a check you did not run.
- Keep commits small and ordered. Each commit message says what changed and why in plain words.

## Credentials

The plugin reads logins that belong to other tools. These rules always apply.

- Read credentials only. Never refresh a token. Never write to `~/.codex`, the macOS Keychain, or OpenCode's credential store. A refresh can rotate the refresh token and sign the user out of Codex or Claude Code.
- Never print, log, or commit a token, a JWT, an email address, or an account id. That includes test output, fixtures, pull request bodies, and screenshots.
- Send each token only to its own provider's host. Add no other network call and no telemetry.
- Read the macOS Keychain only when Anthropic is connected in OpenCode. Keep the 10 minute throttle in `src/sources.ts`.
- A new provider reader needs the owner's approval. Put the credential it reads and the endpoint it calls in the pull request title and in `## Why`.
- If you find a way to leak a credential, do not describe it in a public pull request or issue. Tell the owner.

## Where things live

- `src/quota.ts` holds the types, the parsers, and the pure functions that decide the footer text and color. It does no I/O.
- `src/sources.ts` holds the loaders. It is the only file that reads credentials or calls the network.
- `src/tui.tsx` is the OpenCode shell. It holds the signals, the click handling, the commands, and the refresh timer.
- `tui.js` is generated from `src/`. Do not edit it by hand.
- `scripts/live.ts` prints the footer text from the user's real logins. `bun run live` reads Copilot, OpenAI, xAI, and Go. It does not touch the Keychain. `bun run live anthropic` also reads the Keychain and can raise a macOS dialog. Run it only when you need it.
