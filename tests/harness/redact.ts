/**
 * Turns a live exchange into a byte-stable one.
 *
 * Every run creates brand-new records, so raw traffic changes on every run: new
 * record ids, a new per-test scope suffix, fresh timestamps. Committing that would
 * churn the spec on every re-record and make the CI drift check meaningless.
 *
 * Which values are volatile is the *behavior's* call, not this module's. A
 * behavior already holds every id it caused to exist, in a local variable, so
 * it can say so exactly — `van.volatile()` names one, and `van.create()`
 * declares the id it returns. Guessing from field names would only be a worse
 * version of what the caller already knows.
 *
 * Anything declared is then rewritten by *value*, wherever it later turns up:
 * a path, a Location header, a request body, an error message that names it in
 * prose. Nothing here knows an endpoint, a field name, or an id format, so a
 * new endpoint needs no change to this file.
 *
 * The two rules that do live here are about recording live traffic rather than
 * about VAN: per-run response headers are dropped, and a datetime stamped while
 * the run was in flight is a clock reading. Neither can be delegated, because
 * both cover values sitting in parts of a response no behavior ever reads.
 */

/** Stand-ins count up from here. Not real ids — see the header comment. */
const ALIAS_BASE = 100_000_001;

/** Response headers worth keeping. Everything else (date, cf-ray, rate-limit
 *  counters, server) changes per run and carries no documentary value. */
export const STABLE_RESPONSE_HEADERS = new Set(["content-type", "location"]);

/**
 * A datetime is treated as a server clock reading when it lands within this
 * much of the recording — recognized by *being ~now*, since a behavior cannot
 * name values it never reads. Matching on key names instead was the brittle
 * part: `dateOfBirth` comes back as a full ISO datetime too, so that rule would
 * destroy the value the example exists to show, while the
 * `dateAcquired: 0001-01-01T00:00:00Z` sentinel has to survive. Neither is
 * anywhere near now; a real `dateCreated` is.
 */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const STABLE_TIMESTAMP = "2026-01-01T00:00:00Z";

/** Full ISO-8601 datetimes only. A date-only value (`1975-03-14`) is data the
 *  caller supplied, never a clock reading. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export class Aliaser {
  private readonly aliases = new Map<number, number>();
  private next = ALIAS_BASE;
  private readonly recordedAt = Date.now();

  constructor(private readonly scope: string) {}

  /**
   * Declare a server-assigned value volatile, and hand it straight back so the
   * call can be wrapped around the value it names.
   *
   * Only declared values are ever rewritten. That is what lets an id the
   * server never handed out — a sentinel for "no such record", typically —
   * keep its literal value instead of being renumbered into the sequence and
   * disguised as a real record.
   */
  volatile<T extends number>(value: T): T {
    if (!this.aliases.has(value)) this.aliases.set(value, this.next++);
    return value;
  }

  /** Rewrite volatile substrings: the scope suffix, and any declared value, in
   *  whatever surrounds it. Whole digit runs are matched, so a declared id is
   *  never swapped out of the middle of a longer number. */
  text(s: string): string {
    const out = s.split(this.scope).join("{scope}");
    if (this.aliases.size === 0) return out;
    return out.replace(/\d+/g, (run) => String(this.aliases.get(Number(run)) ?? run));
  }

  /**
   * Recursively rewrite a JSON value.
   *
   * `clock` flattens server clock readings, and is set only for values the
   * server sent: a datetime the *caller* wrote is an input the example is
   * meant to show, however recent it happens to be.
   */
  value(v: unknown, { clock = false } = {}): unknown {
    if (typeof v === "string") {
      return clock && this.isClockReading(v) ? STABLE_TIMESTAMP : this.text(v);
    }
    if (typeof v === "number") return this.aliases.get(v) ?? v;
    if (Array.isArray(v)) return v.map((item) => this.value(item, { clock }));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, this.value(val, { clock })]));
    }
    return v;
  }

  /**
   * Refuse to publish a transcript that still contains something declared
   * volatile. Substitution should make this vacuous; it is here because the
   * failure it guards against is silent — a value that slips through does not
   * break anything until the next re-record, when it churns the committed spec
   * and the drift check starts crying wolf.
   */
  assertRedacted(serialized: string): void {
    const leaked = [...this.aliases.keys()].filter((real) => hasNumber(serialized, real));
    if (leaked.length > 0) {
      throw new Error(
        `transcript still contains volatile value(s) ${leaked.join(", ")} — ` +
          `some value reached the transcript without passing through the Aliaser`,
      );
    }
    if (serialized.includes(this.scope)) {
      throw new Error(`transcript still contains the run's scope suffix ${this.scope}`);
    }
  }

  private isClockReading(s: string): boolean {
    if (!ISO_DATETIME.test(s)) return false;
    const t = Date.parse(s);
    return Number.isFinite(t) && Math.abs(t - this.recordedAt) < CLOCK_SKEW_MS;
  }
}

/** Whether `n` appears in `text` as a whole digit run, so that 42 is not found
 *  inside 4200. */
function hasNumber(text: string, n: number): boolean {
  const digits = String(n);
  for (let i = text.indexOf(digits); i !== -1; i = text.indexOf(digits, i + 1)) {
    if (!isDigit(text[i - 1]) && !isDigit(text[i + digits.length])) return true;
  }
  return false;
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
