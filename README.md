# pi-ter

Experimental Pi (`pi-coding-agent`) plugin and package.

## Structure

- `extensions/`: TypeScript extensions, custom tools, and event hooks
  - `index.ts`: Main entrypoint registering commands (`/piter`) and tools (`piter_inspect`)
- `skills/`: Custom agent skills following the Agent Skills standard
  - `piter-exp/`: Starter experimentation skill
- `prompts/`: Custom prompt templates
  - `piter-help.md`: Template for quick status & experiment checks (`/piter-help`)

## Usage with Pi

To test this package with Pi:
```bash
# Test for one session without installing
pi -e ./repos/pi-ter

# Or install locally into project settings
pi install ./repos/pi-ter -l
```
