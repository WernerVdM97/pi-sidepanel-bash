/**
 * pi-sidepanel-bash — Core data model and rendering (no pi imports)
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface BashEntry {
	id: string;
	command: string;
	exitCode: number | null;
	output: string;
	timestamp: number;
	source: "session" | "live";
}

export interface BashEntryInput {
	id: string;
	command: string;
	exitCode?: number | null;
	output?: string;
	timestamp?: number;
	source?: "session" | "live";
}

// ── BashLog ───────────────────────────────────────────────────────────────

export class BashLog {
	/** Max stored output bytes per entry. Larger outputs clipped with `…`. */
	MAX_OUTPUT_BYTES = 10_000;
	/** Max entries in log. Oldest evicted when exceeded. */
	MAX_ENTRIES = 250;

	entries: BashEntry[] = [];
	/** Cursor index into `filteredEntries` (the list as displayed). -1 = none. */
	cursor = -1;
	viewMode: "commands" | "command" | "output" = "commands";
	scrollOffset = 0;
	searchQuery = "";
	searchMode = false;
	/** Last viewport height reported by renderLog — keeps paging and
	 *  cursor-visibility math in sync with what's actually on screen. */
	viewportH = 40;
	private _pendingG = false;
	_theme: ThemeColors | null = null;

	/** Truncate output to MAX_OUTPUT_BYTES. Appends `…` if clipped. */
	private trimOutput(raw: string): string {
		if (raw.length <= this.MAX_OUTPUT_BYTES) return raw;
		let clipped = raw.slice(0, this.MAX_OUTPUT_BYTES - 1);
		// Don't cut a surrogate pair in half — a lone high surrogate renders
		// as a replacement character.
		const last = clipped.charCodeAt(clipped.length - 1);
		if (last >= 0xd800 && last <= 0xdbff) clipped = clipped.slice(0, -1);
		return clipped + "…";
	}

	setTheme(theme: ThemeColors): void {
		this._theme = theme;
	}

	add(input: BashEntryInput): void {
		// Defensive: ensure command is a valid string
		const cmd = typeof input.command === "string" ? input.command : String(input.command ?? "");
		if (!cmd) return;

		const entry: BashEntry = {
			id: input.id,
			command: cmd,
			exitCode: input.exitCode ?? null,
			output: this.trimOutput(input.output ?? ""),
			timestamp: input.timestamp ?? Date.now(),
			source: input.source ?? "live",
		};
		this.entries.unshift(entry);
		// The cursor indexes the filtered view — only shift it when the new
		// entry actually appears there (it lands at index 0 when it does).
		if (this.cursor >= 0 && this.matchesFilter(entry)) this.cursor++;
		// Evict oldest entries when over cap. Eviction removes the LAST
		// index, so existing indices are unchanged — just clamp to bounds.
		while (this.entries.length > this.MAX_ENTRIES) {
			this.entries.pop();
		}
		const max = this.filteredEntries.length - 1;
		if (this.cursor > max) this.cursor = max;
	}

	setResult(id: string, result: { exitCode: number; output: string }): void {
		const entry = this.entries.find((e) => e.id === id);
		if (!entry) return;
		entry.exitCode = result.exitCode;
		entry.output = this.trimOutput(result.output);
	}

	reset(): void {
		this.entries = [];
		this.cursor = -1;
		this.viewMode = "commands";
	}

	/** The entry under the cursor, in the filtered (displayed) list. */
	get selectedEntry(): BashEntry | undefined {
		return this.cursor >= 0 ? this.filteredEntries[this.cursor] : undefined;
	}

	private matchesFilter(entry: BashEntry): boolean {
		if (!this.searchQuery) return true;
		return entry.command
			.toLowerCase()
			.includes(this.searchQuery.toLowerCase());
	}

	cursorDown(): void {
		const total = this.filteredEntries.length;
		if (total === 0) return;
		if (this.cursor < total - 1) {
			this.cursor++;
			this.ensureVisible();
		}
	}

	cursorUp(): void {
		if (this.cursor > -1) {
			this.cursor--;
			this.ensureVisible();
		}
	}

	private ensureVisible(viewportH = this.viewportH): void {
		if (this.cursor < 0) return;
		if (this.cursor < this.scrollOffset) this.scrollOffset = this.cursor;
		else if (this.cursor >= this.scrollOffset + viewportH)
			this.scrollOffset = this.cursor - viewportH + 1;
	}

	toggleCommandView(): void {
		if (this.cursor < 0) return;
		if (this.viewMode === "command") {
			this.viewMode = "commands";
			this.scrollOffset = Math.max(0, this.cursor - 5);
		} else {
			this.viewMode = "command";
			this.scrollOffset = 0;
		}
	}

	toggleOutput(): void {
		if (this.cursor < 0) return;
		if (this.viewMode === "output") {
			this.viewMode = "commands";
			this.scrollOffset = Math.max(0, this.cursor - 5);
		} else {
			this.viewMode = "output";
			this.scrollOffset = 0;
		}
	}

	exitDetailView(): void {
		if (this.viewMode !== "commands") {
			this.viewMode = "commands";
			this.scrollOffset = Math.max(0, this.cursor - 5);
		}
	}

	// In output view the scroll methods move through the selected entry's
	// output lines and must NOT touch the cursor — the cursor selects an
	// entry, not an output line.

	scrollUp(_vh: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - 1);
		if (this.viewMode === "commands") {
			this.cursor = Math.max(-1, this.cursor - 1);
		}
	}

	scrollDown(vh: number): void {
		const total =
			this.viewMode === "output"
				? (this.selectedEntry?.output.split("\n").length ?? 0)
				: this.filteredEntries.length;
		const maxS = Math.max(0, total - vh);
		if (this.scrollOffset < maxS) {
			this.scrollOffset++;
			if (
				this.viewMode === "commands" &&
				this.cursor >= 0 &&
				this.cursor < total - 1
			) {
				this.cursor++;
			}
		}
	}

	scrollPageUp(vh = this.viewportH): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - vh);
		if (this.viewMode === "commands") {
			this.cursor = Math.max(-1, this.cursor - vh);
		}
	}

	scrollPageDown(vh = this.viewportH): void {
		const total =
			this.viewMode === "output"
				? (this.selectedEntry?.output.split("\n").length ?? 0)
				: this.filteredEntries.length;
		const maxS = Math.max(0, total - vh);
		this.scrollOffset = Math.min(maxS, this.scrollOffset + vh);
		if (this.viewMode === "commands" && this.cursor >= 0) {
			this.cursor = Math.min(total - 1, this.cursor + vh);
		}
	}

	handleG(): "handled" | "pending" {
		if (this._pendingG) {
			this._pendingG = false;
			this.scrollOffset = 0;
			if (this.viewMode === "commands") {
				this.cursor = this.filteredEntries.length > 0 ? 0 : -1;
			}
			return "handled";
		}
		this._pendingG = true;
		return "pending";
	}

	resetGPending(): void {
		this._pendingG = false;
	}

	goToEnd(viewportH = this.viewportH): void {
		if (this.viewMode === "output") {
			const total = this.selectedEntry?.output.split("\n").length ?? 0;
			this.scrollOffset = Math.max(0, total - viewportH);
			return;
		}
		const total = this.filteredEntries.length;
		if (total === 0) return;
		this.cursor = total - 1;
		this.scrollOffset = Math.max(0, total - viewportH);
	}

	get filteredEntries(): BashEntry[] {
		if (!this.searchQuery) return this.entries;
		try {
			const q = this.searchQuery.toLowerCase();
			return this.entries.filter(
				(e) => e.command && e.command.toLowerCase().includes(q),
			);
		} catch {
			return this.entries;
		}
	}

	/** The query changed, so cursor indices into the filtered list shifted.
	 *  Keep the same entry selected when it's still visible; otherwise snap
	 *  to the top of the (new) filtered list. */
	private reanchorCursor(previous: BashEntry | undefined): void {
		const filtered = this.filteredEntries;
		if (previous) {
			const idx = filtered.indexOf(previous);
			if (idx >= 0) {
				this.cursor = idx;
				this.ensureVisible();
				return;
			}
		}
		this.cursor = filtered.length > 0 ? 0 : -1;
		this.scrollOffset = 0;
	}

	toggleSearch(): void {
		this.searchMode = !this.searchMode;
		if (!this.searchMode) {
			const previous = this.selectedEntry;
			this.searchQuery = "";
			this.reanchorCursor(previous);
		}
	}

	appendSearch(char: string): void {
		const previous = this.selectedEntry;
		this.searchQuery += char;
		this.reanchorCursor(previous);
	}

	backspaceSearch(): void {
		const previous = this.selectedEntry;
		this.searchQuery = this.searchQuery.slice(0, -1);
		this.reanchorCursor(previous);
	}

	acceptSearch(): void {
		this.searchMode = false;
	}
}

// ── Theme ────────────────────────────────────────────────────────────────

export interface ThemeColors {
	fg: (color: string, text: string) => string;
	bg: (color: string, text: string) => string;
}

// ── Bash Tokenizer ───────────────────────────────────────────────────────

type TokenType =
	| "command"
	| "flag"
	| "string"
	| "variable"
	| "operator"
	| "number"
	| "comment"
	| "path"
	| "plain"
	| "space";

interface Token {
	text: string;
	type: TokenType;
}

const TOKEN_COLOR: Record<TokenType, string | null> = {
	command: "syntaxFunction",
	flag: "syntaxKeyword",
	string: "syntaxString",
	variable: "syntaxVariable",
	operator: "syntaxOperator",
	number: "syntaxNumber",
	comment: "syntaxComment",
	path: "syntaxString",
	plain: null,
	space: null,
};

/**
 * Tokenize a bash command into colored tokens.
 * Handles: commands, flags, strings, variables, operators, redirects, paths.
 * SAFETY: maxIter prevents infinite loops on malformed input.
 */
function tokenizeBash(command: string): Token[] {
	const MAX_ITER = command.length * 4 + 100; // generous but bounded
	const tokens: Token[] = [];
	let i = 0;
	let isFirstWord = true;
	let iter = 0;

	while (i < command.length && iter < MAX_ITER) {
		iter++;
		// Whitespace
		if (command[i] === " " || command[i] === "\t") {
			tokens.push({ text: command[i]!, type: "space" });
			i++;
			continue;
		}

		// Comment
		if (command[i] === "#") {
			tokens.push({ text: command.slice(i), type: "comment" });
			break;
		}

		// Multi-char operators: &&, ||
		if (command.slice(i, i + 2) === "&&" || command.slice(i, i + 2) === "||") {
			tokens.push({ text: command.slice(i, i + 2), type: "operator" });
			i += 2;
			isFirstWord = true;
			continue;
		}

		// Redirect operators: >>, 2>, &>, 1>
		if (/^[12&]?>/.test(command.slice(i, i + 2))) {
			const start = i;
			i++;
			if (i < command.length && (command[i] === ">" || command[i] === "&")) i++;
			tokens.push({ text: command.slice(start, i), type: "operator" });
			isFirstWord = true;
			continue;
		}

		// Single-char operators: | ; > < &
		if ("|;><&".includes(command[i]!)) {
			tokens.push({ text: command[i]!, type: "operator" });
			i++;
			isFirstWord = true;
			continue;
		}

		// Variable
		if (command[i] === "$") {
			const start = i;
			i++;
			if (i < command.length && command[i] === "{") {
				while (i < command.length && command[i] !== "}") i++;
				if (i < command.length) i++;
			} else {
				while (i < command.length && /[a-zA-Z0-9_]/.test(command[i]!)) i++;
			}
			tokens.push({ text: command.slice(start, i), type: "variable" });
			isFirstWord = false;
			continue;
		}

		// Double-quoted string
		if (command[i] === '"') {
			const start = i;
			i++;
			while (i < command.length && command[i] !== '"') {
				if (command[i] === "\\") i++;
				i++;
			}
			if (i < command.length) i++;
			tokens.push({ text: command.slice(start, i), type: "string" });
			isFirstWord = false;
			continue;
		}

		// Single-quoted string
		if (command[i] === "'") {
			const start = i;
			i++;
			while (i < command.length && command[i] !== "'") {
				if (command[i] === "\\") i++;
				i++;
			}
			if (i < command.length) i++;
			tokens.push({ text: command.slice(start, i), type: "string" });
			isFirstWord = false;
			continue;
		}

		// Regular word
		const start = i;
		while (i < command.length && !/[\s|&;><$"'#]/.test(command[i]!)) i++;
		const word = command.slice(start, i);

		if (isFirstWord) {
			tokens.push({ text: word, type: "command" });
			isFirstWord = false;
		} else if (word.startsWith("-")) {
			tokens.push({ text: word, type: "flag" });
		} else if (/^\d+(\.\d+)?$/.test(word)) {
			tokens.push({ text: word, type: "number" });
		} else if (/^[~./]/.test(word)) {
			tokens.push({ text: word, type: "path" });
		} else {
			tokens.push({ text: word, type: "plain" });
		}
	}

	return tokens;
}

/** Apply theme colors to tokens, returning a string with ANSI codes. */
function colorize(tokens: Token[], theme: ThemeColors | null): string {
	if (!theme) return tokens.map((t) => t.text).join("");
	let out = "";
	for (const t of tokens) {
		const c = TOKEN_COLOR[t.type];
		out += c ? theme.fg(c, t.text) : t.text;
	}
	return out;
}

// ── ANSI-aware helpers ───────────────────────────────────────────────────
//
// These mirror pi-tui's `visibleWidth`/`truncateToWidth` width model so the
// Bash tab agrees with the framework's safety clamp: graphemes are the unit
// (not UTF-16 code units, which would split emoji/CJK surrogate pairs), and
// wide East-Asian / emoji clusters count as 2 cells. Kept dependency-free so
// log.ts stays importable in unit tests without resolving @earendil-works/*.

// Grapheme segmentation via Intl.Segmenter when available. Created lazily and
// guarded: a runtime built without full ICU throws on construction, and doing
// that at module load would take the whole Bash tab down. When unavailable we
// fall back to code-point iteration (still wide-char aware, just no clustering
// of ZWJ emoji sequences).
let _segmenter: Intl.Segmenter | null | undefined;
function segmentGraphemes(str: string): string[] {
	if (_segmenter === undefined) {
		try {
			_segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
		} catch {
			_segmenter = null;
		}
	}
	if (_segmenter) {
		const out: string[] = [];
		for (const { segment } of _segmenter.segment(str)) out.push(segment);
		return out;
	}
	return [...str]; // code-point fallback (astral-safe)
}

/** Matches a single CSI escape sequence (e.g. SGR color codes). */
const ANSI_RE = /\x1b\[[0-9;?=]*[A-Za-z]/g;

/** Display width of a single code point: 0 (combining/zero-width), 2 (wide
 *  East-Asian / emoji), or 1 (everything else, incl. "ambiguous"). */
function codePointWidth(cp: number): number {
	// Combining marks and common zero-width characters.
	if (
		cp === 0x200b || // zero-width space
		(cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
		(cp >= 0x200c && cp <= 0x200f) // ZWNJ, ZWJ, LRM, RLM
	) {
		return 0;
	}
	// Wide ranges: CJK, Hangul, Kana, fullwidth forms, emoji, etc.
	if (
		(cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
		(cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals … Kangxi
		(cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK compat
		(cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
		(cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
		(cp >= 0xa000 && cp <= 0xa4cf) || // Yi
		(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
		(cp >= 0xf900 && cp <= 0xfaff) || // CJK Compat Ideographs
		(cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compatibility Forms
		(cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
		(cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
		(cp >= 0x1f1e6 && cp <= 0x1f1ff) || // Regional indicators
		(cp >= 0x1f300 && cp <= 0x1faff) || // Emoji, pictographs, symbols
		(cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B and beyond
	) {
		return 2;
	}
	return 1;
}

/** Width of one grapheme cluster (the leading code point decides; ZWJ emoji
 *  sequences thus count once, as 2). */
function graphemeCells(segment: string): number {
	const cp = segment.codePointAt(0);
	return cp === undefined ? 0 : codePointWidth(cp);
}

/** Split a string into ordered ANSI / text tokens, preserving sequence. */
function tokenizeAnsi(str: string): { ansi: boolean; value: string }[] {
	const tokens: { ansi: boolean; value: string }[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	ANSI_RE.lastIndex = 0;
	while ((m = ANSI_RE.exec(str)) !== null) {
		if (m.index > last) {
			tokens.push({ ansi: false, value: str.slice(last, m.index) });
		}
		tokens.push({ ansi: true, value: m[0] });
		last = ANSI_RE.lastIndex;
	}
	if (last < str.length) tokens.push({ ansi: false, value: str.slice(last) });
	return tokens;
}

/** Count visible cells, skipping ANSI escape sequences and respecting
 *  wide-character / grapheme width. */
export function ansiLen(str: string): number {
	const clean = str.replace(ANSI_RE, "");
	let n = 0;
	for (const segment of segmentGraphemes(clean)) {
		n += graphemeCells(segment);
	}
	return n;
}

/** Truncate an ANSI-string to max visible width, appending ellipsis and
 *  closing any open SGR so colors don't bleed into the panel borders. */
export function ansiTruncate(str: string, maxW: number, ellip = "…"): string {
	if (maxW <= 0) return "";

	// Text fits without truncation — just close any open SGR codes.
	if (ansiLen(str) <= maxW) {
		return str.includes("\x1b[") ? str + "\x1b[0m" : str;
	}

	// Truncate, leaving room for the ellipsis.
	const targetW = Math.max(0, maxW - ansiLen(ellip));
	let out = "";
	let vis = 0;
	for (const tok of tokenizeAnsi(str)) {
		if (tok.ansi) {
			out += tok.value; // zero-width — always keep style codes
			continue;
		}
		for (const segment of segmentGraphemes(tok.value)) {
			const w = graphemeCells(segment);
			if (vis + w > targetW) {
				return out + ellip + "\x1b[0m";
			}
			out += segment;
			vis += w;
		}
	}
	return out + ellip + "\x1b[0m";
}

/** Word-wrap an ANSI-colored string to a max visible width. */
function ansiWrap(str: string, maxW: number): string[] {
	if (!str || maxW <= 0) return [str];
	const lines: string[] = [];
	let line = "";
	let lineW = 0;
	const words = str.split(" ");
	for (let wi = 0; wi < words.length; wi++) {
		const w = words[wi]!;
		const wLen = ansiLen(w);
		if (line && lineW + 1 + wLen > maxW) {
			lines.push(line);
			line = w;
			lineW = wLen;
		} else {
			line = line ? line + " " + w : w;
			lineW = line ? lineW + 1 + wLen : wLen;
		}
	}
	if (line) lines.push(line);
	return lines.length > 0 ? lines : [""];
}

// ── Rendering ────────────────────────────────────────────────────────────

export function renderLog(
	log: BashLog,
	width: number,
	height = 40,
): string[] {
	// Defensive: guard against NaN / negative / enormous dimensions
	width = Math.max(1, Math.min(500, Math.floor(width) || 1));
	height = Math.max(3, Math.min(200, Math.floor(height) || 3));

	try {
		const theme = log._theme;
		const lines: string[] = [];

		// Content area height (passed by the framework; falls back to 40).
		// The footer occupies the last row, so it's pinned at `height - 1`.
		const H = Math.max(3, Math.floor(height));
		const footerRow = H - 1;

		// Keymap footers (pinned to bottom of the viewport)
		const footer1 =
			theme?.fg(
				"dim",
				ansiTruncate(
					" j/k navigate │ Enter detail │ o output │ / search │ g/G top/bot",
					width,
					"",
				),
			) ??
			ansiTruncate(
				" j/k navigate │ Enter detail │ o output │ / search │ g/G top/bot",
				width,
				"",
			);

		// Command detail view (Enter)
		if (log.viewMode === "command" && log.cursor >= 0) {
			const entry = log.selectedEntry;
			if (entry) {
				const icon =
					entry.exitCode === null
						? "…"
						: entry.exitCode === 0
							? theme
								? theme.fg("success", "✓")
								: "✓"
							: theme
								? theme.fg("error", "✗")
								: "✗";
				const preview =
					entry.command.length > 30
						? entry.command.slice(0, 29) + "…"
						: entry.command;
				lines.push(` ${icon}  ${preview}`);
				lines.push(" ─".repeat(Math.max(1, Math.floor(width / 2))));

				// Tokenize and split on && for detail highlighting
				const allTokens = tokenizeBash(entry.command);
				const segments: Token[][] = [];
				let current: Token[] = [];
				for (const t of allTokens) {
					if (t.type === "operator" && t.text === "&&") {
						if (current.length) segments.push(current);
						current = [];
					} else {
						current.push(t);
					}
				}
				if (current.length) segments.push(current);

				for (let si = 0; si < segments.length; si++) {
					const segTokens = segments[si]!;
					const segText = colorize(segTokens, theme);
					const prefix =
						si === 0
							? "  "
							: theme
								? `  ${theme.fg("syntaxOperator", "&&")} `
								: "  && ";
					const cmdLines = ansiWrap(segText, Math.max(5, width - 4));
					for (let li = 0; li < cmdLines.length; li++) {
						const l = cmdLines[li]!;
						const linePrefix = li === 0 ? prefix : "     ";
						lines.push(linePrefix + l);
					}
				}
			}
			while (lines.length < footerRow) lines.push("");
			lines.push(footer1);
			return lines;
		}

		// Output view mode (o)
		if (log.viewMode === "output" && log.cursor >= 0) {
			const entry = log.selectedEntry;
			if (entry) {
				// Command header — same as detail view
				const icon =
					entry.exitCode === null
						? "…"
						: entry.exitCode === 0
							? theme
								? theme.fg("success", "✓")
								: "✓"
							: theme
								? theme.fg("error", "✗")
								: "✗";
				const preview =
					entry.command.length > 30
						? entry.command.slice(0, 29) + "…"
						: entry.command;
				lines.push(` ${icon}  ${preview}`);
				lines.push(" ─".repeat(Math.max(1, Math.floor(width / 2))));

				// Git diff output has box-drawing chars and ANSI artifacts
				// that break the panel — suppress and show a note instead.
				// Match `git … diff` only at a command position (start of line
				// or after a shell separator) so quoted/substring uses like
				// `echo "git diff"` are not falsely suppressed.
				const isGitDiff =
					/(?:^|&&|\|\||[;|\n])\s*git\b[^|;&\n]*\bdiff\b/.test(entry.command);
				if (entry.output) {
					if (isGitDiff) {
						lines.push(
							theme?.fg("dim", " (git diff output suppressed") ??
								" (git diff output suppressed",
						);
						lines.push(
							theme?.fg("dim", "  to avoid breaking the panel") ??
								"  to avoid breaking the panel",
						);
					} else {
						const rawLines = entry.output.split("\n");
						// Reserve 3 lines for header + separator + footer
						const viewH = Math.max(1, H - 3);
						// Remember the real viewport so paging in handleInput
						// (which has no height parameter) matches the screen.
						log.viewportH = viewH;
						const maxS = Math.max(0, rawLines.length - viewH);
						if (log.scrollOffset > maxS) log.scrollOffset = maxS;
						const end = Math.min(rawLines.length, log.scrollOffset + viewH);
						const maxW = Math.max(1, width);
						for (let i = log.scrollOffset; i < end; i++) {
							let line = rawLines[i]!;
							// Close any open SGR so colors don't bleed into borders
							// (framework sanitizeLine strips dangerous sequences but
							//  preserves SGR colors — we must close them per line)
							if (line.includes("\x1b[")) line += "\x1b[0m";
							lines.push(ansiTruncate(line, maxW));
						}
					}
				} else {
					lines.push(" (no output)");
				}
			}
			while (lines.length < footerRow) lines.push("");
			lines.push(footer1);
			return lines;
		}

		// Commands mode
		const displayEntries = log.filteredEntries;
		const total = displayEntries.length;
		// Reserve the last row for the footer (and account for the 2-row search
		// header when active) so the list never overruns the footer.
		const viewH = Math.max(1, footerRow - (log.searchMode ? 2 : 0));
		// Remember the real viewport so paging/visibility in handleInput
		// (which has no height parameter) matches the screen.
		log.viewportH = viewH;

		if (total === 0 && !log.searchMode) {
			lines.push(" No bash commands yet");
			while (lines.length < footerRow) lines.push("");
			lines.push(footer1);
			return lines;
		}

		if (log.searchMode) {
			lines.push(` /${log.searchQuery}`);
			lines.push(" ─".repeat(Math.max(1, width - 2)));
		}

		const maxScroll = Math.max(0, total - viewH);
		if (log.scrollOffset > maxScroll) log.scrollOffset = maxScroll;
		if (log.scrollOffset < 0) log.scrollOffset = 0;

		const end = Math.min(total, log.scrollOffset + viewH);
		for (let i = log.scrollOffset; i < end; i++) {
			const entry = displayEntries[i]!;
			// Cursor indexes the filtered (displayed) list directly.
			const isCursor = i === log.cursor;
			const isSession = entry.source === "session";

			const icon =
				entry.exitCode === null
					? " … "
					: entry.exitCode === 0
						? theme
							? theme.fg("success", " ✓ ")
							: " ✓ "
						: theme
							? theme.fg("error", " ✗ ")
							: " ✗ ";

			const prefix = isSession ? " " : theme ? theme.fg("warning", "•") : "·";
			const cursor = isCursor ? ">" : " ";

			// Highlight and truncate command
			const cmdSpace = Math.max(3, width - 7);
			const tokens = tokenizeBash(entry.command);
			const colored = colorize(tokens, theme);
			const cmd =
				ansiLen(colored) > cmdSpace ? ansiTruncate(colored, cmdSpace) : colored;
			lines.push(`${cursor}${prefix}${icon}${cmd}`);
		}

		while (lines.length < footerRow) lines.push("");
		lines.push(footer1);
		return lines;
	} catch (err) {
		// Surface the real error so a recurrence is diagnosable rather than
		// an opaque "Error rendering bash tab". The framework truncates lines
		// to the panel width, so a long message can't break the box.
		const msg = err instanceof Error ? err.message : String(err);
		return [` bash render error: ${msg}`];
	}
}
