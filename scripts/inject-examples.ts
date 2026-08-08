/**
 * transcripts/*.json → response examples + x-codeSamples in openapi.json.
 *
 * A code sample is the WHOLE recorded exchange, not one request: the setup
 * calls that built the world, the call the claim is about, and every response
 * as it came back. A reader can paste the script and reproduce the claim from
 * an empty database. Author `comment()` calls appear in the position they were
 * made, and the claim itself leads the script as a comment.
 *
 * Keyed examples are narrower — only `subject` exchanges, and only on the
 * operations the behavior declares in `spec`. A behavior often calls a second
 * endpoint to prove its claim (merge, then GET the record to show it survived);
 * that call is the claim's evidence, not documentation of the endpoint it hits,
 * so it stays in the code sample and contributes no examples. Each subject becomes
 * a request example and a response example filed under the SAME key, which is
 * what ties the two together: Scalar keeps one document-wide example key and
 * resolves the request snippet and the response card against it, so picking a
 * request selects the response it actually produced. That linkage runs through
 * the requestBody and stops there: parameter examples are never injected — see
 * the note at the injection site — so path and query values appear only in the
 * code sample.
 *
 * Usage: tsx scripts/inject-examples.ts [--out path] [--check]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { Transcript } from "../tests/harness/behavior.js";
import type { Entry, Exchange } from "../tests/harness/record.js";

const SPEC = new URL("../openapi.json", import.meta.url);
const TRANSCRIPTS = new URL("../transcripts/", import.meta.url);
const BASE_URL = "https://api.securevan.com/v4";
const COMMENT_WIDTH = 74;

/** The scope suffix keeps behaviors from seeing each other's records; it is
 *  noise to a reader, so published examples drop it. */
const present = <T,>(v: T): T =>
  JSON.parse(JSON.stringify(v).replaceAll("-{scope}", "").replaceAll("{scope}", ""));

function wrap(text: string, width = COMMENT_WIDTH): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

const comment = (text: string): string[] => wrap(text).map((l) => `# ${l}`);

/** Single-quote for the shell, escaping any embedded quote. */
const sq = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** Bodies sent more than once become shell variables. Three identical creates
 *  are the point of some behaviors, but printing the payload three times buries
 *  the one line that differs. */
function hoistRepeatedBodies(entries: Entry[]): Map<string, string> {
  const counts = new Map<string, { n: number; path: string }>();
  for (const e of entries) {
    if (e.kind !== "exchange" || e.request.body === undefined) continue;
    const json = JSON.stringify(e.request.body);
    const seen = counts.get(json);
    if (seen) seen.n++;
    else counts.set(json, { n: 1, path: e.request.path });
  }

  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const [json, { n, path }] of counts) {
    if (n < 2) continue;
    const stem = `${path.split("/").filter((s) => !s.startsWith("{")).at(-1) ?? "req"}_body`
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_");
    let name = stem;
    for (let i = 2; used.has(name); i++) name = `${stem}_${i}`;
    used.add(name);
    names.set(json, name);
  }
  return names;
}

function curlScript(t: Transcript): string {
  const out: string[] = [...comment(t.claim)];
  const entries = present(t.entries as Entry[]);
  const hoisted = hoistRepeatedBodies(entries);

  for (const [json, name] of hoisted) {
    const body = JSON.stringify(JSON.parse(json), null, 2);
    out.push("", `${name}='${body}'`);
  }

  for (const entry of entries) {
    out.push("");

    if (entry.kind === "comment") {
      out.push(...comment(entry.text));
      continue;
    }

    const { request, response } = entry;
    const variable = request.body === undefined ? undefined : hoisted.get(JSON.stringify(request.body));
    // An explicit `-X POST` pins the method across a redirect, which is exactly
    // what a following client must NOT do: curl only converts to GET when the
    // method was implied by `-d`. Spelling it out here would reproduce a 411
    // instead of the response this exchange recorded.
    const implied = request.followRedirect && request.method === "POST" && request.body !== undefined;
    const verb = implied ? "" : `-X ${request.method} `;
    out.push(`curl -sS ${request.followRedirect ? "-L " : ""}${verb}${sq(`${BASE_URL}${request.url}`)} \\`);
    out.push(`  -u "app-name:$NGP_API_KEY|1"${request.body === undefined ? "" : " \\"}`);
    if (variable !== undefined) {
      out.push(`  -H 'Content-Type: application/json' \\`);
      out.push(`  -d "$${variable}"`);
    } else if (request.body !== undefined) {
      out.push(`  -H 'Content-Type: application/json' \\`);
      const body = JSON.stringify(request.body, null, 2).split("\n");
      out.push(`  -d ${sq(body[0])}`.replace(/'$/, ""));
      for (const line of body.slice(1, -1)) out.push(`  ${line}`);
      out.push(`  ${body.at(-1)}'`);
    }

    // Responses are shown as comments so the script stays paste-runnable.
    const location = response.headers.location;
    out.push(`# → ${response.status}${location ? `  Location: ${location}` : ""}`);
    if (response.body !== undefined) {
      const body =
        typeof response.body === "string"
          ? [response.body]
          : JSON.stringify(response.body, null, 2).split("\n");
      out.push(...body.map((l) => `# ${l}`));
    }
  }

  return out.join("\n");
}

/** A subject exchange together with the narration that introduced it. That
 *  comment is the author's own one-line label for the case — which is exactly
 *  what an example picker wants — so it beats the behavior title whenever one
 *  behavior contributes several rows to the same operation. */
interface Subject {
  exchange: Exchange;
  note?: string;
}

function subjects(entries: Entry[]): Subject[] {
  const out: Subject[] = [];
  let note: string | undefined;
  for (const entry of entries) {
    if (entry.kind === "comment") {
      note = entry.text;
      continue;
    }
    // Any exchange consumes the pending note, so a comment written to explain a
    // setup call is never mistaken for a label on the subject that follows it.
    const taken = note;
    note = undefined;
    if (entry.role === "subject") out.push({ exchange: entry, note: taken });
  }
  return out;
}

/** Everything this script writes is stamped with the transcript it came from,
 *  which is what makes the run idempotent: generated entries are swept before
 *  anything is injected, so a renamed behavior or a changed keying scheme cannot
 *  leave an orphan behind, and hand-authored examples are never touched. */
const STAMP = "x-transcript";

function sweep(spec: any): void {
  const sweepExamples = (holder: any): void => {
    if (!holder?.examples) return;
    for (const [key, example] of Object.entries<any>(holder.examples)) {
      if (example?.[STAMP] !== undefined) delete holder.examples[key];
    }
    if (Object.keys(holder.examples).length === 0) delete holder.examples;
  };

  for (const item of Object.values<any>(spec.paths ?? {})) {
    for (const operation of Object.values<any>(item)) {
      if (!operation?.responses) continue;

      for (const media of Object.values<any>(operation.requestBody?.content ?? {})) sweepExamples(media);
      for (const parameter of operation.parameters ?? []) sweepExamples(parameter);
      for (const response of Object.values<any>(operation.responses)) {
        for (const media of Object.values<any>(response?.content ?? {})) sweepExamples(media);
      }

      if (operation["x-codeSamples"]) {
        operation["x-codeSamples"] = operation["x-codeSamples"].filter((s: any) => s?.[STAMP] === undefined);
        if (operation["x-codeSamples"].length === 0) delete operation["x-codeSamples"];
      }
    }
  }
}

function resolvePointer(doc: any, pointer: string): any {
  const parts = pointer
    .replace(/^#\//, "")
    .split("/")
    .map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"));
  return parts.reduce((node, part) => {
    if (node?.[part] === undefined) {
      throw new Error(`spec pointer does not resolve: ${pointer} (at "${part}")`);
    }
    return node[part];
  }, doc);
}

const spec = JSON.parse(readFileSync(SPEC, "utf8"));
sweep(spec);

const transcripts: Transcript[] = readdirSync(TRANSCRIPTS)
  .filter((f) => f.endsWith(".json"))
  .sort() // deterministic ordering, so the injected spec does not churn
  .map((f) => JSON.parse(readFileSync(new URL(f, TRANSCRIPTS), "utf8")));

const advisories: string[] = [];
let examples = 0;
let requests = 0;
let samples = 0;
/** Subject calls on operations no behavior declared. Expected — they are the
 *  evidence for a claim about a different endpoint — but worth surfacing, since
 *  the other reason for a non-zero count is a forgotten `spec` pointer. */
let undeclared = 0;

for (const t of transcripts) {
  // A pointer that no longer resolves means the spec moved under the test.
  const targets = t.spec.map((pointer) => ({ pointer, node: resolvePointer(spec, pointer) }));
  if (!t.render) continue;

  // Everything published goes on the operations the behavior declares it
  // documents, rather than on whichever operation happened to be called.
  const declared = new Set(targets.map(({ node }) => node));
  const script = curlScript(t);
  for (const { pointer, node } of targets) {
    if (!node.responses) {
      advisories.push(`${t.id}: ${pointer} is not an operation — no code sample attached`);
      continue;
    }
    (node["x-codeSamples"] ??= []).push({ lang: "Shell", label: t.title, source: script, [STAMP]: t.id });
    samples++;
  }

  // Grouped by operation because the label only has to tell rows apart within
  // one picker: a behavior that touches an operation once keeps its own title,
  // and only a behavior that contributes several rows needs per-row narration.
  const byOperation = new Map<string, Subject[]>();
  for (const subject of subjects(t.entries as Entry[])) {
    const key = `${subject.exchange.request.path} ${subject.exchange.request.method.toLowerCase()}`;
    const group = byOperation.get(key) ?? [];
    group.push(subject);
    byOperation.set(key, group);
  }

  for (const [operationKey, group] of byOperation) {
    const [path, method] = operationKey.split(" ");
    const operation = spec.paths?.[path]?.[method];
    if (!operation) throw new Error(`spec has no operation for ${operationKey}`);

    // A subject call on an operation the behavior does not claim to document is
    // there to prove something about the declared one — that the record survived,
    // that the id is gone. Publishing its response here would file a merge claim
    // under "what GET /people/{vanId} returns", which is not what it shows.
    if (!declared.has(operation)) {
      undeclared++;
      continue;
    }

    group.forEach((subject, i) => {
      const { request, response } = present(subject.exchange);
      const many = group.length > 1;
      // One row per operation keeps the behavior id as its key, so the common
      // case reads as a name rather than as an ordinal.
      const key = many ? `${t.id}/${i + 1}` : t.id;
      const label = { summary: (many ? subject.note : undefined) ?? t.title, description: t.claim, [STAMP]: t.id };

      // Parameter examples are never injected. Scalar's per-parameter example
      // dropdown is independent of the document-wide key: selecting an entry
      // shows neither its summary nor its description, and does not switch the
      // requestBody or response examples, so a keyed parameter row cannot carry
      // the claim it is labeled with. Path and query values live in the code
      // sample instead, where the surrounding exchange gives them meaning.
      const media = request.body === undefined ? undefined : operation.requestBody?.content?.["application/json"];
      if (request.body !== undefined && !media) {
        advisories.push(
          `${t.id}: ${operationKey} sent a JSON body but the spec declares no application/json requestBody — example not injected`,
        );
        return;
      }

      if (media) {
        (media.examples ??= {})[key] = { ...label, value: request.body };
        requests++;
      }

      const documented = operation.responses?.[String(response.status)];
      if (!documented) {
        advisories.push(
          `${t.id}: observed ${response.status} on ${path} but the spec documents no such response`,
        );
        return;
      }
      // A $ref'd response is shared. Siblings of $ref are ignored by OpenAPI, and
      // writing through to the component would put this example on every
      // operation that reuses it — so leave it to a human.
      if (documented.$ref) {
        advisories.push(
          `${t.id}: ${operationKey} ${response.status} resolves to the shared ${documented.$ref} — example not injected`,
        );
        return;
      }
      if (response.body === undefined) return;

      const content = (documented.content ??= {});
      const responseMedia = (content["application/json"] ??= {});
      (responseMedia.examples ??= {})[key] = { ...label, value: response.body };
      examples++;
    });
  }
}

const rendered = `${JSON.stringify(spec, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (readFileSync(SPEC, "utf8") !== rendered) {
    console.error("openapi.json is out of date with transcripts/ — run `make inject`");
    process.exit(1);
  }
  console.log("openapi.json is up to date with transcripts/");
} else {
  const outFlag = process.argv.indexOf("--out");
  const target = outFlag >= 0 ? new URL(process.argv[outFlag + 1], `file://${process.cwd()}/`) : SPEC;
  writeFileSync(target, rendered);
}

console.log(
  `${transcripts.length} transcripts → ${requests} request examples, ${examples} response examples, ${samples} code samples` +
    (undeclared ? `\n  ${undeclared} subject calls landed outside their behavior's declared operations` : ""),
);
for (const a of advisories) console.log(`  advisory: ${a}`);
