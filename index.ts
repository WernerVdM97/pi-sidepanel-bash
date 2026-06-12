/**
 * pi-sidepanel-bash — Bash command history tab for pi-sidepanel
 *
 * Session-persistent, vim-style cursor, expand/collapse, output viewer,
 * search, and theme support. Purely event wiring — all data model and
 * rendering logic lives in ./log.ts.
 */

import type {
	BashToolCallEvent,
	BashToolResultEvent,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { BashLog, renderLog } from "./log.ts";

// ── ANSI text helpers for session replay ────────────────────────────────

interface SessionBlock {
	type: string;
	name?: string;
	id?: string;
	arguments?: { command?: string };
}

interface SessionMessage {
	role: string;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	content?: string | SessionBlock[];
}

interface SessionEntry {
	type: string;
	message?: SessionMessage;
}

function extractTextContent(blocks: SessionBlock[] | undefined): string {
	if (!blocks) return "";
	return blocks
		.filter((b) => b.type === "text")
		.map((b) => (b as any).text ?? "")
		.join("");
}

// ── Extension ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const log = new BashLog();
	let registered = false;

	function registerTab(): void {
		if (registered) return;
		registered = true;
		try {
			pi.events.emit("sidepanel:register", {
				id: "bash",
				label: "Bash",
				component: {
					setTheme(theme: any): void {
						log.setTheme(theme);
					},
					// While search mode is active the framework must NOT steal
					// digit keys for tab-switching — they belong to the query.
					capturesText(): boolean {
						return log.searchMode;
					},
					// NOTE: no "sidepanel:invalidate" emits here — the framework
					// invalidates the active tab after delegating input to it.
					handleInput(data: string): void {
						// ── Search mode ──────────────────────────────
						if (log.searchMode) {
							if (matchesKey(data, "escape")) {
								log.toggleSearch();
							} else if (matchesKey(data, "backspace")) {
								log.backspaceSearch();
							} else if (matchesKey(data, "enter")) {
								log.acceptSearch();
							} else if (data.length === 1 && data >= " ") {
								// "/" is allowed: it only toggles search from
								// normal mode, and paths need to be searchable.
								log.appendSearch(data);
							}
							return;
						}

						// ── Normal mode ──────────────────────────────
						// Paging calls use the viewport height recorded by the
						// last render, so pages match what's on screen.
						if (data === "j" || matchesKey(data, "down")) {
							log.cursorDown();
						} else if (data === "k" || matchesKey(data, "up")) {
							log.cursorUp();
						} else if (matchesKey(data, "enter")) {
							log.toggleCommandView();
						} else if (data === "o") {
							log.toggleOutput();
						} else if (matchesKey(data, "escape")) {
							log.exitDetailView();
						} else if (data === "/") {
							log.toggleSearch();
						} else if (matchesKey(data, "pageup")) {
							log.scrollPageUp();
						} else if (matchesKey(data, "pagedown")) {
							log.scrollPageDown();
						} else if (data === "g") {
							const result = log.handleG();
							if (result === "pending") {
								setTimeout(() => log.resetGPending(), 500);
							}
						} else if (data === "G") {
							log.goToEnd();
						}
					},

					render(width: number, height?: number): string[] {
						try {
							return renderLog(log, width, height);
						} catch (err: any) {
							// If render crashes, show error instead of freezing the panel
							const msg = err?.message || String(err);
							return [` bash render error: ${msg}`, "", " resetting view…"];
						}
					},

					invalidate(): void {},
				},
			});
		} catch {
			// Registration failed — tab won't show, but panel stays usable
		}
	}

	// ── Session start — replay history, then register tab ────────────

	pi.on("session_start", async (_event: any, ctx: any) => {
		log.reset();
		registered = false;

		// Register immediately, then flag the tab busy so the framework shows a
		// loading placeholder while we replay. Replay is synchronous and can
		// block on large sessions; yield one frame first so the placeholder
		// actually paints instead of the previous/frozen view.
		registerTab();
		pi.events.emit("sidepanel:busy", {
			tabId: "bash",
			busy: true,
			message: "replaying session…",
		});
		await new Promise((resolve) => setTimeout(resolve, 24));

		try {
			const entries: SessionEntry[] = ctx.sessionManager.getEntries();

			// Cap: max 250 entries to prevent memory blowup on large sessions
			const capped = entries.slice(-250);
			for (const e of capped) {
				if (e.type !== "message") continue;
				const m = e.message;
				if (!m) continue;

				if (m.role === "assistant") {
					const blocks: SessionBlock[] = (m.content ?? []) as SessionBlock[];
					for (const b of blocks) {
						if (b.type !== "toolCall" || b.name !== "bash") continue;
						const rawCmd = b.arguments?.command;
						if (typeof rawCmd !== "string" || rawCmd.length === 0) continue;
						try {
							log.add({
								id: b.id ?? "",
								command: rawCmd,
								exitCode: null,
								source: "session",
							});
						} catch {
							// skip malformed entry
						}
					}
				} else if (m.role === "toolResult" && m.toolName === "bash") {
					const blocks: SessionBlock[] = Array.isArray(m.content)
						? (m.content as SessionBlock[])
						: [];
					try {
						log.setResult(m.toolCallId ?? "", {
							exitCode: m.isError ? 1 : 0,
							output: extractTextContent(blocks),
						});
					} catch {
						// skip malformed result
					}
				}
			}

		} catch {
			// Replay failed — tab already registered with empty state
		} finally {
			// Clear the busy flag and re-render with the replayed data.
			pi.events.emit("sidepanel:busy", { tabId: "bash", busy: false });
			pi.events.emit("sidepanel:invalidate", { tabId: "bash" });
		}
	});

	// ── Framework ready — re-register (load-order fallback) ──────────
	//
	// The framework resets its tab registry on its own session_start. If
	// THIS extension's session_start handler ran first (handler order
	// follows extension load order), our registration was wiped. The
	// framework emits "sidepanel:ready" after its reset precisely so tabs
	// can recover — re-register unconditionally: a guard on `registered`
	// would skip this (it's already true), and re-registration is
	// idempotent (the framework dedups by id).
	pi.events.on("sidepanel:ready", () => {
		registered = false;
		registerTab();
	});

	// ── Tool call — add live entry ────────────────────────────────────

	pi.on("tool_call", (event: BashToolCallEvent) => {
		if (event.toolName !== "bash") return;
		const cmd = event.input.command;
		if (!cmd) return;
		log.add({
			id: event.toolCallId,
			command: cmd,
			exitCode: null,
			source: "live",
		});
		pi.events.emit("sidepanel:invalidate", { tabId: "bash" });
	});

	// ── Tool result — update exit code and output ────────────────────

	pi.on("tool_result", (event: BashToolResultEvent) => {
		if (event.toolName !== "bash") return;
		const textBlocks = (event.content ?? []).filter(
			(c: any): c is { type: "text"; text: string } => c.type === "text",
		);
		const output = textBlocks.map((c: any) => c.text).join("");
		log.setResult(event.toolCallId, {
			exitCode: event.isError ? 1 : 0,
			output,
		});
		pi.events.emit("sidepanel:invalidate", { tabId: "bash" });
	});
}
