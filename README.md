# pi-sidepanel-bash

Bash command history tab for [pi-sidepanel](https://github.com/WernerVdM97/pi-sidepanel). Session-persistent, vim-style cursor navigation, expand/collapse command details, output viewer, search, syntax highlighting, and full theme color support. Most recent commands appear at the top.

## Keybindings

| Key | Mode | Action |
|-----|------|--------|
| `j` / `↓` | Normal | Move cursor down |
| `k` / `↑` | Normal | Move cursor up |
| `Enter` | Normal | Toggle command detail view (expand) |
| `o` | Normal | Toggle output view |
| `Escape` | Detail / Output | Return to command list |
| `/` | Normal | Enter search mode |
| `Escape` | Search | Exit search mode |
| `Enter` | Search | Accept search (exit search, keep filter) |
| `Backspace` | Search | Delete last search character |
| Type chars | Search | Append to search query (live filtering) |
| `gg` | Normal | Jump to top of list |
| `G` | Normal | Jump to bottom of list |
| `PgUp` | Normal | Scroll up one page |
| `PgDn` | Normal | Scroll down one page |

## Views

### Command list (default)
Shows all bash commands with status icons and session markers. Newest commands at the top.

```
> • ✓ echo "just ran"
  • … mkdir -p /tmp/out
  · ✓ ls -la
  · ✗ cat nonexistent
```

- `>` — cursor position (highlighted with **bold accent** color)
- `•` — live entry, just executed this session (**yellow** bullet)
- `✓` — exit code 0 (**green**)
- `✗` — non-zero exit code (**red**)
- `…` — still running / pending (**dimmed**)
- No dot — session entry replayed from history

### Command detail (`Enter`)
Expands the selected command to show the full command text with **syntax highlighting** (commands, flags, strings, variables, operators, paths). Word-wrapped to the available width, with `&&` chains split into separate indented blocks.

### Output viewer (`o`)
Shows the stdout/stderr output of the selected command, scrollable with arrow keys and PgUp/PgDn.

```
file1.txt
file2.txt
file3.txt
```

## Syntax Highlighting

Commands are parsed into tokens and colored using pi's theme syntax tokens:

| Token type | Example | Theme token |
|-----------|---------|-------------|
| Command | `git`, `mkdir` | `syntaxFunction` |
| Flag | `--force`, `-p` | `syntaxKeyword` |
| String | `"hello"`, `'world'` | `syntaxString` |
| Variable | `$HOME`, `${PATH}` | `syntaxVariable` |
| Operator | `&&`, `\|\|`, `\|`, `;`, `>`, `>>` | `syntaxOperator` |
| Number | `42`, `3.14` | `syntaxNumber` |
| Comment | `# this is a note` | `syntaxComment` |
| Path | `/tmp/out`, `./script.sh` | `syntaxString` |

Both the command list and the expanded detail view use syntax highlighting.

## Search (`/`)

Real-time filtering as you type. Case-insensitive, matches against command text.

```
 /git
 ─────────────────
> · ✓ git status
  · ✗ git push --force
```

- Press `/` to enter search mode, type to filter
- `Escape` cancels search and returns to full list
- `Enter` accepts the filter and returns to normal mode

## Theme colors

The tab respects pi's active theme via `setTheme()`. All status icons, cursor markers, session indicators, search UI, and syntax highlighting are rendered with theme colors:

| Element | Theme call |
|---------|-----------|
| Success icon `✓` | `fg("success", ...)` |
| Error icon `✗` | `fg("error", ...)` |
| Pending icon `…` | `fg("dim", ...)` |
| Live dot `•` | `fg("warning", ...)` |
| Cursor `>` | `fg("accent", bold(">"))` |
| Command on cursor line | `bold(...)` |
| Search bar | `fg("accent", bold("/query"))` |
| Placeholder / "no output" | `fg("dim", ...)` |

Syntax highlighting tokens map to pi's built-in syntax color tokens (`syntaxFunction`, `syntaxKeyword`, `syntaxString`, `syntaxVariable`, `syntaxOperator`, `syntaxNumber`, `syntaxComment`).

## Session persistence

On `session_start`, the tab replays all bash commands from the current session's history (via `sessionManager.getEntries()`). Replayed entries show the stored exit code. New commands during the session are marked with `•` (live) and update in real time via `tool_call` / `tool_result` events.

## Architecture

```
pi-sidepanel-bash
  ├── index.ts       — event wiring, component registration, keyboard routing
  └── log.ts         — data model (BashLog), rendering (renderLog), ANSI utils
```

`log.ts` is a pure library with zero pi imports — testable in isolation with Node's built-in test runner. `index.ts` connects it to pi's extension API, event bus, and sidepanel registration.

## License

MIT
