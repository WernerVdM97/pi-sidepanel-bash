/**
 * pi-sidepanel-bash integration tests
 *
 * Loads the REAL extension entry point (index.ts) against the FakePi
 * harness and a stubbed pi-tui, covering the event wiring that unit
 * tests of BashLog cannot: registration, the sidepanel:ready recovery
 * handshake, session replay, live tool events, and busy signalling.
 *
 * Run: node --test test/integration.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import {
	FakePi,
	captureBusy,
	captureRegistrations,
	sessionCtx,
} from "./_harness/fake-pi.ts";

register("./_harness/stub-hooks.mjs", import.meta.url);
const extension = (await import("../index.ts")).default;

// ── Session fixture builders ──────────────────────────────────────────────

function bashCall(id: string, command: string) {
	return {
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", name: "bash", id, arguments: { command } }],
		},
	};
}

function bashResult(id: string, text: string, isError = false) {
	return {
		type: "message",
		message: {
			role: "toolResult",
			toolName: "bash",
			toolCallId: id,
			isError,
			content: [{ type: "text", text }],
		},
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("registration", () => {
	it("registers the bash tab on session_start", async () => {
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);

		await pi.fire("session_start", {}, sessionCtx());
		assert.equal(regs.length, 1);
		assert.equal(regs[0].id, "bash");
		assert.equal(regs[0].label, "Bash");
	});

	it("re-registers on sidepanel:ready (load-order recovery)", async () => {
		// If the framework's session_start handler runs AFTER this
		// extension's, the registration is wiped; the ready event is the
		// documented recovery signal and must re-register unconditionally.
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);

		await pi.fire("session_start", {}, sessionCtx());
		assert.equal(regs.length, 1);

		pi.events.emit("sidepanel:ready", {});
		assert.equal(regs.length, 2, "ready must trigger a fresh registration");
		assert.equal(regs[1].id, "bash");
	});
});

describe("session replay", () => {
	it("replays bash commands and results from session history", async () => {
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);

		const ctx = sessionCtx([
			bashCall("t1", "echo hello"),
			bashResult("t1", "hello\n"),
			bashCall("t2", "false"),
			bashResult("t2", "", true),
		]);
		await pi.fire("session_start", {}, ctx);

		const lines: string[] = regs[0].component.render(60, 20);
		assert.ok(lines.some((l) => l.includes("echo hello")));
		assert.ok(lines.some((l) => l.includes("✓")), "success icon expected");
		assert.ok(lines.some((l) => l.includes("✗")), "error icon expected");
	});

	it("flags the tab busy (with message) during replay, then clears", async () => {
		const pi = new FakePi();
		const busy = captureBusy(pi);
		extension(pi as any);

		await pi.fire("session_start", {}, sessionCtx([bashCall("t1", "ls")]));
		assert.equal(busy.length, 2);
		assert.equal(busy[0].busy, true);
		assert.equal(busy[0].message, "replaying session…");
		assert.equal(busy[1].busy, false);
	});

	it("survives a broken session manager (registers with empty state)", async () => {
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);

		const ctx = {
			sessionManager: {
				getEntries() {
					throw new Error("boom");
				},
			},
		};
		await pi.fire("session_start", {}, ctx);
		assert.equal(regs.length, 1);
		const lines: string[] = regs[0].component.render(60, 20);
		assert.ok(lines.some((l) => l.includes("No bash commands yet")));
	});
});

describe("live events", () => {
	async function freshTab(pi: FakePi) {
		const regs = captureRegistrations(pi);
		extension(pi as any);
		await pi.fire("session_start", {}, sessionCtx());
		return regs[0].component;
	}

	it("adds live tool calls to the list", async () => {
		const pi = new FakePi();
		const comp = await freshTab(pi);

		await pi.fire("tool_call", {
			toolName: "bash",
			toolCallId: "x1",
			input: { command: "git status" },
		});
		const lines: string[] = comp.render(60, 20);
		assert.ok(lines.some((l) => l.includes("git status")));
	});

	it("updates exit state from tool results", async () => {
		const pi = new FakePi();
		const comp = await freshTab(pi);

		await pi.fire("tool_call", {
			toolName: "bash",
			toolCallId: "x1",
			input: { command: "ls" },
		});
		await pi.fire("tool_result", {
			toolName: "bash",
			toolCallId: "x1",
			isError: false,
			content: [{ type: "text", text: "file.txt\n" }],
		});
		const lines: string[] = comp.render(60, 20);
		assert.ok(lines.some((l) => l.includes("✓")));
	});

	it("ignores non-bash tools", async () => {
		const pi = new FakePi();
		const comp = await freshTab(pi);

		await pi.fire("tool_call", {
			toolName: "read",
			toolCallId: "r1",
			input: { path: "/x" },
		});
		const lines: string[] = comp.render(60, 20);
		assert.ok(lines.some((l) => l.includes("No bash commands yet")));
	});
});

describe("input handling through the registered component", () => {
	it("captures digits into the search query while in search mode", async () => {
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);
		await pi.fire("session_start", {}, sessionCtx([bashCall("t1", "ls 22")]));
		const comp = regs[0].component;

		assert.equal(comp.capturesText(), false);
		comp.handleInput("/"); // enter search mode
		assert.equal(
			comp.capturesText(),
			true,
			"framework must not steal digits during search",
		);
		comp.handleInput("2");
		comp.handleInput("2");
		const lines: string[] = comp.render(60, 20);
		assert.ok(lines.some((l) => l.includes("/22")));
	});

	it("accepts '/' inside a search query (paths are searchable)", async () => {
		const pi = new FakePi();
		const regs = captureRegistrations(pi);
		extension(pi as any);
		await pi.fire(
			"session_start",
			{},
			sessionCtx([bashCall("t1", "cat src/app.ts")]),
		);
		const comp = regs[0].component;

		comp.handleInput("/");
		for (const ch of "src/app") comp.handleInput(ch);
		const lines: string[] = comp.render(60, 20);
		assert.ok(lines.some((l) => l.includes("/src/app")));
		assert.ok(lines.some((l) => l.includes("cat src/app.ts")));
	});
});
