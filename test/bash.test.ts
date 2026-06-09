import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BashLog, renderLog } from "../log.ts";

// ── BashLog data model ────────────────────────────────────────────────────

describe("BashLog", () => {
	it("starts empty", () => {
		const log = new BashLog();
		assert.equal(log.entries.length, 0);
		assert.equal(log.cursor, -1);
		assert.equal(log.viewMode, "commands");
		assert.equal(log.searchMode, false);
	});

	it("add() appends a live entry with defaults", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "echo hi" });
		assert.equal(log.entries[0]!.command, "echo hi");
		assert.equal(log.entries[0]!.source, "live");
		assert.equal(log.entries[0]!.exitCode, null);
		assert.equal(log.entries[0]!.output, "");
		assert.ok(log.entries[0]!.timestamp > 0);
	});

	it("add() from session replay preserves source", () => {
		const log = new BashLog();
		log.add({
			id: "t1",
			command: "ls",
			exitCode: 0,
			output: "x",
			timestamp: 1000,
			source: "session",
		});
		assert.equal(log.entries[0]!.source, "session");
		assert.equal(log.entries[0]!.exitCode, 0);
		assert.equal(log.entries[0]!.output, "x");
	});

	it("setResult() updates exitCode and output by id", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "echo hi" });
		log.setResult("t1", { exitCode: 0, output: "hi\n" });
		assert.equal(log.entries[0]!.exitCode, 0);
		assert.equal(log.entries[0]!.output, "hi\n");
	});

	it("setResult() no-ops for unknown id", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "echo hi" });
		log.setResult("t999", { exitCode: 99, output: "nope" });
		assert.equal(log.entries[0]!.exitCode, null);
		assert.equal(log.entries[0]!.output, "");
	});

	it("reset() clears everything", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "a" });
		log.cursor = 1;
		log.toggleCommandView();
		log.reset();
		assert.equal(log.entries.length, 0);
		assert.equal(log.cursor, -1);
		assert.equal(log.viewMode, "commands");
	});
});

// ── Cursor navigation ─────────────────────────────────────────────────────

describe("Cursor navigation", () => {
	let log: BashLog;
	beforeEach(() => {
		log = new BashLog();
		log.add({ id: "t1", command: "a" });
		log.add({ id: "t2", command: "b" });
		log.add({ id: "t3", command: "c" });
	});

	it("cursorDown moves from -1 to 0", () => {
		log.cursorDown();
		assert.equal(log.cursor, 0);
	});
	it("cursorDown stops at last entry", () => {
		log.cursor = 2;
		log.cursorDown();
		assert.equal(log.cursor, 2);
	});
	it("cursorUp moves from 1 to 0", () => {
		log.cursor = 1;
		log.cursorUp();
		assert.equal(log.cursor, 0);
	});
	it("cursorUp stops at -1", () => {
		log.cursor = 0;
		log.cursorUp();
		assert.equal(log.cursor, -1);
	});
	it("no-op on empty", () => {
		const e = new BashLog();
		e.cursorDown();
		e.cursorUp();
		assert.equal(e.cursor, -1);
	});
});

// ── Command / output views ────────────────────────────────────────────────

describe("Views", () => {
	let log: BashLog;
	beforeEach(() => {
		log = new BashLog();
		log.add({ id: "t1", command: "echo hello" });
		log.cursor = 0;
	});

	it("starts in commands list", () => assert.equal(log.viewMode, "commands"));
	it("toggleCommandView enters command view", () => {
		log.toggleCommandView();
		assert.equal(log.viewMode, "command");
	});
	it("toggleCommandView toggles back", () => {
		log.toggleCommandView();
		log.toggleCommandView();
		assert.equal(log.viewMode, "commands");
	});
	it("toggleOutput enters output view", () => {
		log.toggleOutput();
		assert.equal(log.viewMode, "output");
	});
	it("toggleOutput toggles back", () => {
		log.toggleOutput();
		log.toggleOutput();
		assert.equal(log.viewMode, "commands");
	});
	it("exitDetailView returns from any view", () => {
		log.toggleCommandView();
		log.exitDetailView();
		assert.equal(log.viewMode, "commands");
		log.toggleOutput();
		log.exitDetailView();
		assert.equal(log.viewMode, "commands");
	});
});

// ── Search ────────────────────────────────────────────────────────────────

describe("Search", () => {
	let log: BashLog;
	beforeEach(() => {
		log = new BashLog();
		log.add({ id: "t1", command: "echo hello" });
		log.add({ id: "t2", command: "ls -la" });
		log.add({ id: "t3", command: "cat world" });
	});

	it("toggleSearch enters/exits search mode", () => {
		assert.equal(log.searchMode, false);
		log.toggleSearch();
		assert.equal(log.searchMode, true);
		log.toggleSearch();
		assert.equal(log.searchMode, false);
		assert.equal(log.searchQuery, "");
	});

	it("appendSearch filters entries", () => {
		log.toggleSearch();
		log.appendSearch("echo");
		assert.equal(log.searchQuery, "echo");
		assert.equal(log.filteredEntries.length, 1);
		assert.equal(log.filteredEntries[0]!.command, "echo hello");
	});

	it("backspaceSearch removes last char", () => {
		log.toggleSearch();
		log.appendSearch("ec");
		log.backspaceSearch();
		assert.equal(log.searchQuery, "e");
	});

	it("acceptSearch exits search mode", () => {
		log.toggleSearch();
		log.appendSearch("ls");
		log.acceptSearch();
		assert.equal(log.searchMode, false);
		assert.equal(log.filteredEntries.length, 1);
	});

	it("filteredEntries is case-insensitive", () => {
		log.toggleSearch();
		log.appendSearch("ECHO");
		assert.equal(log.filteredEntries.length, 1);
	});
});

// ── Scroll ────────────────────────────────────────────────────────────────

describe("Scroll", () => {
	it("scrollUp clamps to 0", () => {
		const log = new BashLog();
		log.scrollOffset = 0;
		log.scrollUp(10);
		assert.equal(log.scrollOffset, 0);
	});

	it("scrollDown increments", () => {
		const log = new BashLog();
		for (let i = 0; i < 50; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}
		log.scrollOffset = 0;
		log.scrollDown(10);
		assert.ok(log.scrollOffset > 0);
	});

	it("scrollPageUp decreases by page size", () => {
		const log = new BashLog();
		log.scrollOffset = 20;
		log.scrollPageUp(10);
		assert.equal(log.scrollOffset, 10);
	});

	it("scrollPageDown increases by page size", () => {
		const log = new BashLog();
		for (let i = 0; i < 50; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}
		log.scrollPageDown(10);
		assert.ok(log.scrollOffset > 0);
	});

	it("goToEnd moves cursor and scroll to last entry", () => {
		const log = new BashLog();
		for (let i = 0; i < 3; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}
		log.goToEnd(40);
		assert.equal(log.cursor, 2);
		assert.equal(log.scrollOffset, 0);
	});
});

// ── G/g navigation ───────────────────────────────────────────────────────

describe("G/g double-tap", () => {
	it("first g returns pending", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "a" });
		log.add({ id: "t2", command: "b" });
		log.cursor = 1;
		assert.equal(log.handleG(), "pending");
	});

	it("second g goes to top", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "a" });
		log.add({ id: "t2", command: "b" });
		log.cursor = 1;
		log.handleG();
		const result = log.handleG();
		assert.equal(result, "handled");
		assert.equal(log.cursor, 0);
		assert.equal(log.scrollOffset, 0);
	});

	it("resetGPending clears pending state", () => {
		const log = new BashLog();
		log.handleG();
		log.resetGPending();
		assert.equal(log.handleG(), "pending");
	});
});

// ── Scroll ensures cursor visible ────────────────────────────────────────

describe("Scroll ensures visibility", () => {
	it("cursor below viewport adjusts scroll", () => {
		const log = new BashLog();
		for (let i = 0; i < 50; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}
		log.scrollOffset = 0;
		log.cursor = 45;
		log.cursorDown();
		assert.ok(log.scrollOffset > 0);
	});
});

// ── Rendering (plain text) ───────────────────────────────────────────────

describe("Rendering", () => {
	it("empty log shows placeholder", () => {
		const lines = renderLog(new BashLog(), 40);
		assert.ok(lines[0]!.toLowerCase().includes("no"));
	});

	it("renders command with pending icon", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "echo hi" });
		assert.ok(renderLog(log, 40).some((l) => l.includes("echo hi")));
	});

	it("shows ✓ for exit 0, ✗ for non-zero", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "ls", exitCode: 0, source: "session" });
		log.add({ id: "t2", command: "cat no", exitCode: 1, source: "session" });
		const lines = renderLog(log, 40);
		assert.ok(lines.some((l) => l.includes("✓")));
		assert.ok(lines.some((l) => l.includes("✗")));
	});

	it("cursor line starts with >", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "a" });
		log.add({ id: "t2", command: "b" });
		log.cursor = 0;
		const lines = renderLog(log, 40);
		const cursorLine = lines.find((l) => l.includes("b"));
		assert.ok(cursorLine);
		assert.ok(cursorLine!.startsWith(">"));
	});

	it("live entries marked with ·, session entries not", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "old", source: "session", exitCode: 0 });
		log.add({ id: "t2", command: "new", source: "live" });
		const lines = renderLog(log, 40);
		const oldLine = lines.find((l) => l.includes("old"));
		const newLine = lines.find((l) => l.includes("new"));
		assert.ok(!oldLine!.includes("·"));
		assert.ok(newLine!.includes("·"));
	});

	it("command view shows full command", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "echo hello world" });
		log.cursor = 0;
		log.toggleCommandView();
		const lines = renderLog(log, 30);
		assert.ok(lines.some((l) => l.includes("hello") && l.includes("world")));
	});

	it("command view breaks on && with line prefix", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "make && make install" });
		log.cursor = 0;
		log.toggleCommandView();
		const lines = renderLog(log, 40);
		assert.ok(
			lines.some((l) => l.trimStart().startsWith("&&")),
			"should have &&-prefixed continuation line",
		);
	});

	it("output view shows output text", () => {
		const log = new BashLog();
		log.add({
			id: "t1",
			command: "ls",
			exitCode: 0,
			output: "file1\nfile2",
		});
		log.cursor = 0;
		log.toggleOutput();
		const lines = renderLog(log, 40);
		assert.ok(lines.some((l) => l.includes("file1")));
		assert.ok(!lines.some((l) => l.includes("ls")));
	});

	it("output view shows placeholder for no output", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "true", exitCode: 0, output: "" });
		log.cursor = 0;
		log.toggleOutput();
		const lines = renderLog(log, 40);
		assert.ok(lines.some((l) => l.includes("no output")));
	});

	it("truncates long commands", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "a".repeat(80) });
		assert.ok(renderLog(log, 20)[0]!.includes("…"));
	});

	it("search mode shows query bar", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "echo hi" });
		log.toggleSearch();
		log.appendSearch("echo");
		const lines = renderLog(log, 40);
		assert.ok(lines.some((l) => l.includes("/echo")));
	});
});

// ── Syntax Highlighting ──────────────────────────────────────────────────

describe("Syntax Highlighting", () => {
	function mockFg(color: string, text: string): string {
		return `\x1b[${color}m${text}\x1b[0m`;
	}
	const mockTheme = { fg: mockFg, bg: (_c: string, t: string) => t };

	it("list view: no ANSI codes without theme", () => {
		const log = new BashLog();
		log.add({ id: "t1", command: "echo hello" });
		const lines = renderLog(log, 80);
		const cmdLine = lines.find((l) => l.includes("echo"));
		assert.ok(cmdLine);
		assert.ok(!cmdLine!.includes("\x1b["), "should have no ANSI escapes");
	});

	it("list view: ANSI codes present with theme", () => {
		const log = new BashLog();
		log.setTheme(mockTheme);
		log.add({ id: "t1", command: "echo hello" });
		const lines = renderLog(log, 80);
		const cmdLine = lines.find((l) => l.includes("echo"));
		assert.ok(cmdLine);
		assert.ok(cmdLine!.includes("\x1b["), "should have ANSI escapes");
	});

	it("detail view: ANSI codes present with theme", () => {
		const log = new BashLog();
		log.setTheme(mockTheme);
		log.add({ id: "t1", command: "mkdir -p /tmp/test" });
		log.cursor = 0;
		log.toggleCommandView();
		const lines = renderLog(log, 80);
		assert.ok(
			lines.some((l) => l.includes("\x1b[")),
			"should have ANSI escapes",
		);
		assert.ok(
			lines.some((l) => l.includes("mkdir")),
			"should contain command",
		);
	});

	it("detail view: && operator highlighted in theme mode", () => {
		const log = new BashLog();
		log.setTheme(mockTheme);
		log.add({ id: "t1", command: "make && make install" });
		log.cursor = 0;
		log.toggleCommandView();
		const lines = renderLog(log, 40);
		// Continuation lines have "  && " prefix (with ANSI around &&)
		const stripAnsi = (l: string) => l.replace(/\x1b\[[^m]*m/g, "");
		const andLine = lines.find((l) =>
			stripAnsi(l).trimStart().startsWith("&&"),
		);
		assert.ok(andLine, "should have && continuation line");
		assert.ok(andLine!.includes("\x1b["), "&& should be ANSI-colored");
	});

	it("list view: ✓ green and ✗ red with theme", () => {
		const log = new BashLog();
		log.setTheme(mockTheme);
		log.add({ id: "t1", command: "echo ok", exitCode: 0 });
		log.add({ id: "t2", command: "cat no", exitCode: 1 });
		const lines = renderLog(log, 80);
		const okLine = lines.find((l) => l.includes("✓"));
		const errLine = lines.find((l) => l.includes("✗"));
		assert.ok(okLine, "should have success line");
		assert.ok(errLine, "should have error line");
		// ✓ should be colored with success token (contains ANSI)
		assert.ok(okLine!.includes("\x1b["), "✓ should be ANSI-colored");
		// ✗ should be colored with error token (contains ANSI)
		assert.ok(errLine!.includes("\x1b["), "✗ should be ANSI-colored");
	});

	it("list view: live dot is yellow bullet with theme", () => {
		const log = new BashLog();
		log.setTheme(mockTheme);
		log.add({ id: "t1", command: "echo hi", source: "live", exitCode: 0 });
		const lines = renderLog(log, 80);
		const line = lines.find((l) => l.includes("echo"));
		assert.ok(line, "should have command line");
		assert.ok(line!.includes("•"), "should use bullet dot");
		assert.ok(line!.includes("\x1b["), "bullet should be ANSI-colored");
		assert.ok(!line!.includes("·"), "should not use middle dot with theme");
	});

	it("detail view: ✓ green and ✗ red with theme", () => {
		const log = new BashLog();
		log.setTheme(mockTheme);
		log.add({ id: "t1", command: "echo ok", exitCode: 0 });
		log.cursor = 0;
		log.toggleCommandView();
		const lines = renderLog(log, 80);
		const firstLine = lines[0]!;
		assert.ok(firstLine.includes("✓"), "should show success icon");
		assert.ok(firstLine.includes("\x1b["), "✓ should be ANSI-colored");
	});
});
