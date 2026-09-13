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
`/workspace skills` shows every name. The connected-line wordmark and spacing adapt to the
terminal height. Harness status is left to its own extension. Submitting a prompt collapses it into the compact header.
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
