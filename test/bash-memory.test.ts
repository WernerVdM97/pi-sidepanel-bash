/**
 * Memory-safety tests for BashLog
 *
 * Verifies that BashLog enforces caps on:
 * - Stored output size per entry (max 10KB)
 * - Total number of entries (max 250)
 * - Entry eviction (LRU, oldest dropped first)
 *
 * Run: node --test test/bash-memory.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BashLog } from "../log.ts";

// ── Output truncation ────────────────────────────────────────────────────

describe("BashLog output truncation", () => {
	it("truncates output exceeding MAX_OUTPUT_BYTES (10KB)", () => {
		const log = new BashLog();
		// Generate 100KB of output (well over 10KB cap)
		const bigOutput = "x".repeat(100_000);

		log.add({ id: "t1", command: "cat huge.txt" });
		log.setResult("t1", { exitCode: 0, output: bigOutput });

		const stored = log.entries[0]!.output;
		assert.ok(
			stored.length <= log.MAX_OUTPUT_BYTES,
			`stored output ${stored.length} exceeds cap ${log.MAX_OUTPUT_BYTES}`,
		);
		assert.ok(
			stored.endsWith("…"),
			"truncated output should end with ellipsis indicator",
		);
	});

	it("stores output under cap without truncation", () => {
		const log = new BashLog();
		const smallOutput = "hello world";

		log.add({ id: "t1", command: "echo hi" });
		log.setResult("t1", { exitCode: 0, output: smallOutput });

		assert.equal(log.entries[0]!.output, smallOutput);
	});

	it("handles exactly-at-cap output without ellipsis", () => {
		const log = new BashLog();
		const exactOutput = "x".repeat(log.MAX_OUTPUT_BYTES);

		log.add({ id: "t1", command: "cat exact.txt" });
		log.setResult("t1", { exitCode: 0, output: exactOutput });

		assert.equal(log.entries[0]!.output, exactOutput);
		assert.ok(
			!log.entries[0]!.output.endsWith("…") ||
				exactOutput.endsWith("…"),
			"at-cap output should not add extra truncation marker",
		);
	});

	it("does not split a surrogate pair at the truncation point", () => {
		const log = new BashLog();
		// Fill so that the cut at MAX_OUTPUT_BYTES - 1 lands between the two
		// halves of an astral-plane character (🎉 = 🎉).
		const filler = "x".repeat(log.MAX_OUTPUT_BYTES - 2);
		log.add({ id: "t1", command: "emoji", exitCode: 0, output: `${filler}🎉🎉` });

		const stored = log.entries[0]!.output;
		const beforeEllipsis = stored.charCodeAt(stored.length - 2);
		assert.ok(
			!(beforeEllipsis >= 0xd800 && beforeEllipsis <= 0xdbff),
			"truncated output must not end in a lone high surrogate",
		);
		assert.ok(stored.endsWith("…"));
	});

	it("truncates output stored directly via add()", () => {
		const log = new BashLog();
		const bigOutput = "y".repeat(100_000);

		log.add({
			id: "t1",
			command: "cat huge.txt",
			exitCode: 0,
			output: bigOutput,
		});

		const stored = log.entries[0]!.output;
		assert.ok(stored.length <= log.MAX_OUTPUT_BYTES);
	});
});

// ── Entry cap and eviction ───────────────────────────────────────────────

describe("BashLog entry cap and eviction", () => {
	it("caps entries at MAX_ENTRIES (250)", () => {
		const log = new BashLog();
		// Add 300 entries
		for (let i = 0; i < 300; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}

		assert.ok(
			log.entries.length <= log.MAX_ENTRIES,
			`entries ${log.entries.length} exceeds max ${log.MAX_ENTRIES}`,
		);
	});

	it("evicts oldest entries when cap exceeded (unshift = newest first)", () => {
		const log = new BashLog();
		// Add 251 entries — newest unshifted to front, oldest popped
		for (let i = 0; i < 251; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}

		// Newest (cmd 250) should be at index 0
		assert.equal(log.entries[0]!.command, "cmd 250");
		// With MAX_ENTRIES=250, cmd 0 was evicted, oldest surviving is cmd 1
		const oldest = log.entries[log.entries.length - 1]!;
		assert.equal(oldest.command, "cmd 1"); // cmd 0 should be evicted
		// Verify evicted entry is gone
		assert.ok(
			!log.entries.some((e) => e.command === "cmd 0"),
			"cmd 0 should be evicted",
		);
	});

	it("does not evict when under cap", () => {
		const log = new BashLog();
		for (let i = 0; i < 10; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}
		assert.equal(log.entries.length, 10);
	});

	it("maintains cursor correctness after eviction", () => {
		const log = new BashLog();
		// Add entries, move cursor
		for (let i = 0; i < 10; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}
		log.cursor = 5;

		// Add more to trigger eviction via cap (temporarily lower for test)
		const originalCap = log.MAX_ENTRIES;
		(log as any).MAX_ENTRIES = 8;
		log.add({ id: "t10", command: "cmd 10" });
		log.add({ id: "t11", command: "cmd 11" });
		(log as any).MAX_ENTRIES = originalCap;

		// Cursor should still be valid
		assert.ok(log.cursor >= -1 && log.cursor < log.entries.length);
	});

	it("eviction does not drift the cursor off the selected entry", () => {
		// Regression: eviction removes the LAST index, so earlier indices are
		// unchanged — the cursor used to be decremented anyway, creeping the
		// selection upward once the cap was hit.
		const log = new BashLog();
		(log as any).MAX_ENTRIES = 5;
		for (let i = 0; i < 5; i++) {
			log.add({ id: `t${i}`, command: `cmd ${i}` });
		}
		log.cursor = 2; // cmd 2
		const selected = log.selectedEntry;

		log.add({ id: "t5", command: "cmd 5" }); // evicts cmd 0 (last index)
		// Cursor shifted by the unshift at the front, not by the eviction.
		assert.equal(log.selectedEntry, selected);
	});

	it("output of evicted entries is freed (no leak)", () => {
		const log = new BashLog();
		// Add entry with big output
		log.add({
			id: "big",
			command: "cat huge.json",
			exitCode: 0,
			output: "x".repeat(50_000),
		});

		// Fill up to trigger eviction
		const originalCap = log.MAX_ENTRIES;
		(log as any).MAX_ENTRIES = 1;
		log.add({ id: "t2", command: "echo evict" });
		(log as any).MAX_ENTRIES = originalCap;

		// Big entry should be evicted
		assert.equal(log.entries.length, 1);
		assert.equal(log.entries[0]!.id, "t2");
	});
});
