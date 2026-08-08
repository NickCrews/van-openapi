/**
 * Everything about this harness that is specific to the NGP VAN API: where it
 * lives, how it authenticates, and the one convenience the behaviors kept
 * asking for. The recording, typing, and redaction are in record.ts and
 * redact.ts, and know nothing about VAN.
 */

import { readFileSync } from "node:fs";
import type { Aliaser } from "./redact.js";
import type { paths } from "./schema.js";
import { RecordingClient, type JsonBody } from "./record.js";

const BASE_URL = "https://api.securevan.com/v4";
/** Matches the fuzz target in the Makefile. `|1` selects My Campaign mode. */
const DATABASE_MODE = "1";
/** The Makefile fuzzes at 10/s; behaviors are serial, so one gap is enough. */
const MIN_REQUEST_GAP_MS = 100;

function apiKey(): string {
  const fromEnv = process.env.NGP_API_KEY_SANDBOX;
  if (fromEnv) return fromEnv;
  // Same convention as the Makefile: a .env at the repo root.
  const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const match = env.match(/^NGP_API_KEY_SANDBOX=(.*)$/m);
  if (!match) throw new Error("NGP_API_KEY_SANDBOX not set and not found in .env");
  return match[1].trim();
}

/** Basic auth, where the username is an arbitrary app name and the password is
 *  `apiKey|databaseMode`. */
function authorization(): string {
  const credentials = `van-openapi-behaviors:${apiKey()}|${DATABASE_MODE}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

export class VanClient extends RecordingClient<paths> {
  constructor(aliaser: Aliaser) {
    super(
      {
        baseUrl: BASE_URL,
        headers: { Authorization: authorization() },
        minRequestGapMs: MIN_REQUEST_GAP_MS,
      },
      aliaser,
    );
  }

  /**
   * Creates a person and returns its real vanId, declared volatile — the id is
   * new this run by definition.
   *
   * Always setup, too: creating a record is never itself the claim under test.
   * Almost every behavior opens by putting a person in the database, so this
   * earns its place; a behavior that wants the create itself on the record can
   * still call `post("/people/create", …)` directly.
   */
  async create(body: JsonBody<paths, "/people/create", "post">): Promise<number> {
    const res = await this.setup(() => this.post("/people/create", body));
    if (res.status !== 201) {
      throw new Error(`setup: POST /people/create expected 201, got ${res.status}`);
    }
    return this.volatile((res.body as { vanId: number }).vanId);
  }
}
