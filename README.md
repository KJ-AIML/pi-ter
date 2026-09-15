# pi-ter

A Pi extension package with a Hello PI hands intro, a Workspace welcome screen,
a custom status bar, and `/fire` keep-awake mode.

## Run

```bash
git clone https://github.com/KJ-AIML/pi-ter.git
cd pi-ter
npm ci
npm start
```

`npm start` runs the bundled Pi **0.85.1** in its native fullscreen terminal mode.
To use your existing Pi installation and configuration:

```bash
pi --tui-mode fullscreen -e ./repos/pi-ter

# Or install once, then start Pi normally
pi install ./repos/pi-ter -l
pi --tui-mode fullscreen
```

Use your actual checkout path in place of `./repos/pi-ter`. Run Pi from the project
you want to work on; that directory supplies the Workspace name and path.

## Startup

The six-second Hello PI v2 intro uses the original detailed hand fields, moves
the hands inward, resolves **Hello PI**, then reveals the Workspace screen.
Its overlay paints an opaque black background across every terminal cell.
The existing editor and custom status bar return when the intro finishes.
Type to skip immediately; the first printable character is kept in the editor.
Escape or Enter also skips. Resizing recalculates the animation and layout.

The welcome screen uses two columns in wide terminals and a compact layout below
92 columns. Its accent is chosen once per session from lavender, cyan, mint,
pink and amber. Skills are grouped by name into Development, Review, Infrastructure,
Design and Other, with counts from the loaded inventory. Empty groups are hidden;
`/workspace skills` shows every name. The shaded Braille wordmark and spacing adapt to the
terminal height. Its baked beveled lettering has highlights and extruded shadows,
with no runtime fonts or graphics protocol required. Rebuild the art with
`python scripts/build-wordmark.py` (Pillow, NumPy, SciPy and DejaVu Sans Mono
Bold Oblique required only for rebuilding). Harness status is left to its own extension. Submitting a prompt collapses it into the compact header.
Resumed conversations skip the welcome body and automatic intro.

- `/workspace` — browse loaded resource names; also `/workspace skills`,
  `/workspace extensions`, `/workspace prompts`, `/workspace context`.
- `/hello-pi` — replay the intro.
- `/header` — toggle Workspace vs Pi's built-in header and resource listing.
- `/statusbar` — toggle the existing custom status bar.
- `/fire` — toggle keep-awake mode.
- `/piter ping` — check that the extension is loaded.

Optional environment variables (set before launching Pi):

| Variable | Default | Effect |
| --- | --- | --- |
| `PI_SPLASH` | `1` | Set to `0` to skip the intro |
| `PI_SPLASH_DURATION` | `6` | Duration in seconds, clamped to 0.2–30 |
| `PI_SPLASH_MODE` | `braille` | Set to `ascii` for fonts without Braille glyphs |

`NO_COLOR` and `TERM=dumb` skip animation. Noninteractive print, JSON and RPC
modes do not install the splash or Workspace UI. No terminal settings are written.

## Compatibility and implementation

Tested against Pi **0.85.1**. Pi does not expose loaded-resource inventory through
its extension API. `extensions/startup-resources.ts` therefore contains a small,
version-guarded adapter for its rendered resource sections. It replaces only
recognized inventory components; warnings, errors, themes and chat stay intact.
On other Pi versions it leaves the built-in listing intact. With `quietStartup`,
Pi omits that inventory; skill/prompt names fall back to registered commands,
while extension/context inventory is unavailable. Disable `quietStartup` for the
complete Workspace summary.

The overlay uses Pi's compositor, not direct writes to stdout or a separate
terminal process. Its timer and overlay are disposed on skip, completion,
header replacement and session shutdown. The hand assets are bundled locally;
startup makes no network request for animation assets.

## Development

Node.js 24 is used for the TypeScript test runner.

```bash
npm ci
npm run check
npm test
```

`extensions/index.ts` registers the extension; `workspace-view.ts` renders the
welcome screen; `hello-pi/` holds the animation and original v2 hand data.
The existing `skills/` and `prompts/` are still included in the Pi package.

## Background tasks and subagents

Pi-ter now adds a shared Tasks panel for commands and child Pi agents. Your
existing input and status bar stay in place. Open **`/tasks`** or **Ctrl+Alt+T**
while the main agent continues working. `/piter-tasks` is the namespaced alias
if another extension owns `/tasks`.

### Start work

Ask the agent normally, for example:

> Use piter_terminal to run the dev server in the background. Then use piter_agent
> to review the auth module without editing files. I'll watch both in /tasks.

Or launch directly:

```text
/piter-tasks run npm run dev
/piter-tasks agent Review the auth module. Read only; report concrete bugs and file paths.
/piter-tasks logs <task-id>
/piter-tasks stop <task-id>
```

On Windows the default shell is **Windows PowerShell**. For example:

```text
/piter-tasks run while ($true) { Write-Output "Tick $(Get-Date -Format HH:mm:ss)"; Start-Sleep -Seconds 1 }
```

On macOS/Linux the default is `sh`:

```text
/piter-tasks run while true; do date; sleep 1; done
```

These are **background commands with captured stdout/stderr**, not interactive
terminal emulators. There is no PTY or stdin attachment; commands which require a
password prompt or terminal input must be run interactively outside this viewer.
Closing the viewer does not stop work. Stop an infinite loop from Tasks when done.

### Viewer controls

| Key | Action |
| --- | --- |
| Up / Down | Select task, or scroll log |
| Tab | Filter all / terminals / agents in task list |
| Enter | Open selected task |
| PageUp / PageDown | Scroll log by page |
| End | Resume following live output |
| `/` then Enter | Search log lines; empty search clears it |
| `f` | Cycle stdout / stderr / agent / tool / system filter |
| `w` | Toggle line wrapping |
| `x`, then `y` | Stop selected active task; `n` cancels |
| Escape | Back to task list, then close |

### Agent tools

| Tool | Parameters and behavior |
| --- | --- |
| `piter_terminal` | `command`, optional `title`, `cwd`, `shell`, `timeout`; returns task ID immediately |
| `piter_agent` | `task`, optional `title`, `cwd`, `provider`, `model`, `timeout`; spawns a separate Pi process |
| `piter_tasks` | No ID lists tasks; `id`, optional `after_seq`, `limit` reads logs |
| `piter_task_stop` | `id`; stops this session's owned task and its process tree |

The default timeout is **1,800 seconds**. Tool callers may specify `timeout: 0`
for no timeout, or a timeout up to one day. Up to **4 tasks** run concurrently;
additional starts return a clear error. Finished tasks remain inspectable.
Completion sends a follow-up message with the result or output tail to the main
agent; this can start a new model turn. Stopping one task does not abort the parent.

Subagents inherit the selected provider/model and thinking level unless a model
is specified, and load the user's installed Pi configuration. A provider configured
only transiently inside the parent process may need persistent configuration for the
child to load it. Provider errors are surfaced as failed tasks. Parent conversation
history is not copied: include the context the subagent needs in `task`. Project
instructions and installed extensions load normally; Pi-ter's task tools are disabled
inside the child to prevent recursive Pi-ter spawning. Other extensions retain their
own behavior. Agents share workspace files, so assign disjoint edits or read-only
reviews when running concurrently.

### Lifetime, logs and limits

- Task processes belong to the current Pi session. Session switch, fork, reload and
  normal shutdown stop owned tasks. They are not a durable supervisor that survives
  force-killing Pi or an OS crash.
- Windows cancellation uses `taskkill /T /F`; POSIX sends the process group TERM,
  followed by KILL when needed. Stop failures remain visible rather than claiming
  success. Detached processes which deliberately escape their process group are
  outside this runtime's ownership model.
- Each task keeps a bounded live tail (256 KiB / 2,000 chunks) and a JSONL log file
  capped at 2 MiB. The viewer explicitly reports dropped live entries and disk caps.
  Terminal control sequences are stripped before display and persistence.
- Logs live under `~/.pi/agent/piter-tasks/` (or your configured Pi agent directory).
  Keep this directory private: command output can contain sensitive project data.
  Up to 50 task records are retained per active session; older completed records
  and their files are evicted. Logs left by ended sessions can be deleted manually.
  A restarted Pi does not reattach or list old process records.

### Validation

`npm test` includes real concurrent shell/process-tree tests, UI navigation and
search tests, bounded-output checks, and an actual child Pi CLI talking to a local
OpenAI-compatible fixture. This verifies provider configuration loading, a real
`read` tool round-trip, live event capture and final completion without paid requests.
GitHub Actions runs the suite on Linux, Windows and macOS. Live DashScope and
CLIProxy accounts still require testing with your own configuration.

Run commands in the foreground inside each managed task. Programs that deliberately detach into a new process group, Windows detached services, or scheduled jobs escape session ownership and cannot be stopped from Tasks. On Windows an owned supervisor preserves the process tree while inherited output remains open.

Standalone Windows Pi installations need `node` on PATH for the task supervisor; npm-based Pi installations reuse their running Node runtime.
