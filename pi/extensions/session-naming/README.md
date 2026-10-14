# Session naming

Automatically generates a short session title from the first user prompt, using the active model. The request runs in the background and does not add messages to the conversation. Existing names are preserved.

Run `/reload` once after installing, or start a new pi process. The extension is automatically discovered through `~/.pi/agent/extensions`.

## Rename

`/rename` opens a keyboard-navigable menu:

- **Custom title**: enter your own session name.
- **Auto from whole conversation**: generate a new title from the entire active branch, including history before compaction, summaries and tool activity.

Shortcuts: `/rename My custom title` and `/rename auto`. The built-in `/name` still works.

Generated titles are limited to 80 characters. Very long conversations are trimmed across messages to bound the naming request. System prompts, hidden thinking and image data are excluded. Full-context naming respects context edits. Naming uses your current provider credentials and makes an additional model request.

Manual naming, session switching, reload and shutdown cancel pending generation. Failures leave the previous name intact. To title an older unnamed session, use `/rename`, or continue it to trigger naming from its first prompt.

## Tests

```bash
node --experimental-strip-types --test pi/extensions/session-naming/index.test.ts
```
