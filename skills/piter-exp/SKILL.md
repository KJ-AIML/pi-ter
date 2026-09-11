---
name: piter-exp
description: Run experiments and diagnostics for the pi-ter plugin package inside Pi.
---

# Pi-ter Experimentation Skill

Use this skill when testing custom Pi capabilities, extensions, hooks, or prompt templates within the `pi-ter` plugin repo.

## Capabilities

- Testing custom slash commands (`/piter`)
- Testing custom Pi tools (`piter_inspect`)
- Verifying extension event lifecycle hooks
- Testing prompt templates and skill invocations

## Workflow

1. Check that `pi-ter` is linked or loaded in `.pi/settings.json` or as an active package.
2. Run test commands or invoke tools.
3. Validate output in the transcript or UI notification stream.
