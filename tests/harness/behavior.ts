import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { redactEntries, type Entry } from "./record.js";
import { Aliaser } from "./redact.js";
import { VanClient } from "./van.js";

const TRANSCRIPT_DIR = new URL("../../transcripts/", import.meta.url);

export interface BehaviorMeta {
  /** Stable key. Names the transcript file, so renaming it churns the output. */
  id: string;
  /** Short imperative label. Becomes the vitest test name (so `-t` filters on
   *  it) and the code-sample label in the rendered docs. */
  title: string;
  /** The one sentence this behavior proves. Rendered as prose above the
   *  exchange, and drift-checked against the spec text at `spec`. */
  claim: string;
  /** JSON pointer(s) into openapi.json that this claim documents. */
  spec: string[];
  /** Costly or heavily rate-limited. Skipped unless VAN_SLOW=1, so the
   *  inner loop stays fast while agents iterate on a single behavior. */
  slow?: boolean;
  /** Set false for behaviors worth asserting but not worth publishing —
   *  the transcript is still written, but the injector ignores it. */
  render?: boolean;
}

export interface BehaviorContext {
  van: VanClient;
  /** Narrate the generated example. Recorded in place, so it lands between the
   *  calls it explains. The `claim` is emitted the same way, at the top. */
  comment: (text: string) => void;
  /** Random per run, and redacted out of the transcript. Every record a
   *  behavior creates carries it, so behaviors cannot see each other's data
   *  and "nothing matches" is a claim you can actually prove. */
  scope: string;
}

export interface Transcript extends Omit<BehaviorMeta, "slow"> {
  entries: Entry[];
}

export function behavior(meta: BehaviorMeta, fn: (ctx: BehaviorContext) => Promise<void>): void {
  const run = meta.slow && !process.env.VAN_SLOW ? test.skip : test;

  run(meta.title, { timeout: 120_000 }, async () => {
    const scope = randomBytes(3).toString("hex");
    const aliaser = new Aliaser(scope);
    const van = new VanClient(aliaser);

    await fn({ van, scope, comment: (text) => van.comment(text) });

    // Only on success. A transcript from a failed run would publish a
    // response that contradicts the claim printed above it.
    writeTranscript(meta, van.entries, aliaser);
  });
}

function writeTranscript(meta: BehaviorMeta, entries: Entry[], aliaser: Aliaser): void {
  const { slow: _slow, ...rest } = meta;
  // Redacted here rather than as each call is recorded, so every declaration
  // the behavior made is in hand — including ones made after the call.
  const transcript: Transcript = {
    ...rest,
    render: meta.render ?? true,
    entries: redactEntries(entries, aliaser),
  };
  const serialized = `${JSON.stringify(transcript, null, 2)}\n`;

  // Before writing, not after: an un-aliased value is invisible until the next
  // re-record, when it churns the committed spec for no reason.
  aliaser.assertRedacted(serialized);

  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  writeFileSync(new URL(`${meta.id}.json`, TRANSCRIPT_DIR), serialized);
}
