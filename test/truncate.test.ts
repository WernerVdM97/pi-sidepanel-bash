import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ansiTruncate, ansiLen, renderLog, BashLog } from "../log.ts";

// ── Bug 1: ansiTruncate ellipsis overflow ────────────────────────────────

describe("ansiTruncate", () => {
	it("does not exceed maxW for plain text", () => {
		const result = ansiTruncate("hello world this is long", 10);
		const visible = ansiLen(result);
		assert.ok(
			visible <= 10,
			`BUG: visible width ${visible} exceeds maxW 10. Result: "${result}"`,
		);
	});

	it("does not exceed maxW for ANSI-colored text", () => {
		// Simulate grep --color output: ANSI codes around matches
		const colored =
			"\x1b[32mgreen\x1b[0m \x1b[31mred\x1b[0m with trailing text that overflows";
		const result = ansiTruncate(colored, 15);
		const visible = ansiLen(result);
		assert.ok(
			visible <= 15,
			`BUG: visible width ${visible} exceeds maxW 15. Result: "${result}"`,
		);
	});

	it("handles text shorter than maxW (no ellipsis)", () => {
		const result = ansiTruncate("short", 20);
		const visible = ansiLen(result);
		assert.equal(visible, 5, "should not add ellipsis for short text");
	});

	it("handles maxW of 0", () => {
		const result = ansiTruncate("hello", 0);
		assert.equal(result, "");
	});

	it("handles ANSI-only string (no visible chars)", () => {
		const result = ansiTruncate("\x1b[32m\x1b[0m", 10);
		const visible = ansiLen(result);
		assert.equal(visible, 0);
	});

	it("does not exceed maxW when ANSI codes at truncation boundary", () => {
		// ANSI reset right at the truncation point
		const text = "123456789\x1b[0mABCDEFGHIJKLMNOP";
		const result = ansiTruncate(text, 10);
		const visible = ansiLen(result);
		assert.ok(
			visible <= 10,
			`BUG: visible width ${visible} exceeds maxW 10 at ANSI boundary`,
		);
	});

	it("close ANSI on truncated output (no color bleed)", () => {
		const colored = "\x1b[32mhello world this is very long green text\x1b[0m";
		const result = ansiTruncate(colored, 5);
		// Must end with reset to prevent color bleed into borders
		assert.ok(
			result.endsWith("\x1b[0m"),
			"truncated ANSI output must end with reset",
		);
	});
});

// ── Bug 2: No line from renderLog exceeds panel width ────────────────────

describe("renderLog output width constraint", () => {
	it("output view: no line exceeds panel width for long plain text", () => {
		const log = new BashLog();
		// A line longer than the panel width
		log.add({
			id: "t1",
			command: "cat file",
			exitCode: 0,
			output:
				"this is a very long line that should be truncated to fit within the panel width because otherwise it would break the box borders and cause screen corruption",
		});
		log.cursor = 0;
		log.toggleOutput();

		const width = 30;
		const lines = renderLog(log, width);

		for (const line of lines) {
			const visible = ansiLen(line);
			assert.ok(
				visible <= width,
				`BUG: output line visible width ${visible} exceeds panel width ${width}. Line: "${line}"`,
			);
		}
	});

	it("output view: no line exceeds panel width for ANSI-colored text", () => {
		const log = new BashLog();
		// Simulate grep --color=always output
		log.add({
			id: "t1",
			command: "grep -n pattern file",
			exitCode: 0,
			output:
				"\x1b[32m42:\x1b[0m\x1b[31mpattern\x1b[0m found here in a very long line that should wrap correctly with ANSI codes present throughout the output",
		});
		log.cursor = 0;
		log.toggleOutput();

		const width = 40;
		const lines = renderLog(log, width);

		for (const line of lines) {
			const visible = ansiLen(line);
			assert.ok(
				visible <= width,
				`BUG: ANSI output line visible width ${visible} exceeds panel width ${width}`,
			);
		}
	});

	it("output view: lines use available width (not double-subtracted)", () => {
		const log = new BashLog();
		// Line of width-1 chars: should fit without ellipsis if maxW=width,
		// but would be truncated with ellipsis if maxW=width-2
		const width = 40;
		const exactLine = "x".repeat(width - 1); // 39 chars
		log.add({
			id: "t1",
			command: "echo",
			exitCode: 0,
			output: exactLine,
		});
		log.cursor = 0;
		log.toggleOutput();

		const lines = renderLog(log, width);

		// Find the output line (skip header/separator)
		const outputLine = lines.find((l) => l.includes("xxx"));
		assert.ok(outputLine, "should have output line with 'xxx'");

		const visible = ansiLen(outputLine!);
		// 39 chars should display in full (not truncated to 37 + ellipsis)
		assert.equal(
			visible,
			width - 1,
			`BUG: output line visible width ${visible} should be ${width - 1} (full line), double subtraction suspected`,
		);
	});
});

// ── ansiLen (visible width counter) ──────────────────────────────────────

describe("ansiLen", () => {
	it("counts plain text correctly", () => {
		assert.equal(ansiLen("hello"), 5);
		assert.equal(ansiLen(""), 0);
	});

	it("excludes ANSI escape sequences", () => {
		assert.equal(ansiLen("\x1b[32mgreen\x1b[0m"), 5);
		assert.equal(ansiLen("\x1b[1m\x1b[31mbold red\x1b[0m"), 8);
	});

	it("handles text with no ANSI correctly", () => {
		assert.equal(ansiLen("hello world"), 11);
	});
});

// ── Bug 3: Git diff output suppressed ──────────────────────────────────

describe("renderLog git diff suppression", () => {
	it("suppresses output for 'git diff' command", () => {
		const log = new BashLog();
		log.add({
			id: "t1",
			command: "cd repo && git diff",
			exitCode: 0,
			output:
				"diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n old\n+new",
		});
		log.cursor = 0;
		log.toggleOutput();

		const lines = renderLog(log, 40);

		// Should contain suppression message, not raw diff lines
		assert.ok(
			lines.some((l) => l.includes("git diff output suppressed")),
			"should show suppression message",
		);
		assert.ok(
			!lines.some((l) => l.includes("diff --git")),
			"should NOT contain raw git diff header",
		);
	});

	it("suppresses output for 'git --no-pager diff' command", () => {
		const log = new BashLog();
		log.add({
			id: "t1",
			command: "cd ~/dotVault && git --no-pager diff",
			exitCode: 0,
			output: "diff --git a/index.ts b/index.ts\n@@ -29,6 +29,8 @@ interface",
		});
		log.cursor = 0;
		log.toggleOutput();

		const lines = renderLog(log, 40);

		assert.ok(
			lines.some((l) => l.includes("git diff output suppressed")),
			"should show suppression message",
		);
		assert.ok(
			!lines.some((l) => l.includes("diff --git")),
			"should NOT contain raw git diff output",
		);
	});

	it("does NOT suppress output for non-git-diff commands", () => {
		const log = new BashLog();
		log.add({
			id: "t1",
			command: "git status",
			exitCode: 0,
			output: "On branch main\nnothing to commit",
		});
		log.cursor = 0;
		log.toggleOutput();

		const lines = renderLog(log, 40);

		assert.ok(
			!lines.some((l) => l.includes("suppressed")),
			"should not suppress non-git-diff commands",
		);
		assert.ok(
			lines.some((l) => l.includes("nothing to commit")),
			"should show actual output",
		);
	});

	it("does NOT suppress output for 'git log' command", () => {
		const log = new BashLog();
		log.add({
			id: "t1",
			command: "git log --oneline -5",
			exitCode: 0,
			output: "abc123 feat: add thing\ndef456 fix: bug",
		});
		log.cursor = 0;
		log.toggleOutput();

		const lines = renderLog(log, 40);

		assert.ok(
			!lines.some((l) => l.includes("suppressed")),
			"should not suppress git log",
		);
		assert.ok(
			lines.some((l) => l.includes("abc123")),
			"should show git log output",
		);
	});

	it("output view height never exceeds 40 lines", () => {
		const log = new BashLog();
		// Generate enough output lines to fill the viewport
		const manyLines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join(
			"\n",
		);
		log.add({
			id: "t1",
			command: "cat many-lines.txt",
			exitCode: 0,
			output: manyLines,
		});
		log.cursor = 0;
		log.toggleOutput();

		const lines = renderLog(log, 40);

		assert.ok(
			lines.length <= 40,
			`BUG: output view returned ${lines.length} lines, should be <= 40`,
		);
	});
});
