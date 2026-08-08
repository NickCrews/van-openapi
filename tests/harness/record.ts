/**
 * Records live HTTP exchanges as a byte-stable, publishable transcript.
 *
 * Nothing here knows which API is under test. Give it a base URL and the
 * `paths` type openapi-typescript generated from that API's spec, and calls are
 * checked against the spec as they are recorded — asking for an undocumented
 * path, or reading a field off a response shape that operation never returns,
 * is a compile error rather than a runtime surprise.
 *
 * See van.ts for the adapter this repo uses: a base URL, an auth header, and
 * the one convenience its behaviors kept asking for.
 */

import { Aliaser, STABLE_RESPONSE_HEADERS } from "./redact.js";

export interface ClientConfig {
  /** Prefixed to every path, e.g. `https://api.example.com/v1`. */
  baseUrl: string;
  /** Sent with every request — authentication, typically. */
  headers?: Record<string, string>;
  /** Floor on the gap between requests. Shared across every client in the
   *  process, so a serial suite keeps to one overall rate. */
  minRequestGapMs?: number;
}

// --- typed surface, derived from the spec ------------------------------------

/** The path templates on which the spec documents method `M`. */
export type PathWith<S, M extends string> = {
  [P in keyof S]: S[P] extends Record<M, unknown> ? P : never;
}[keyof S] &
  keyof S &
  string;

export type JsonBody<S, P extends keyof S, M extends string> = S[P] extends {
  [K in M]: { requestBody?: { content: { "application/json": infer B } } };
}
  ? B
  : never;

/** Union of every documented JSON response body for an operation. Assertions
 *  land on this union, so reaching for a field that only exists on one shape
 *  (or on no shape at all) is a compile error. */
type ResponseBodies<R> = {
  [C in keyof R]: R[C] extends { content: { "application/json": infer B } } ? B : never;
}[keyof R];

export type ResponseBody<S, P extends keyof S, M extends string> = S[P] extends {
  [K in M]: { responses: infer R };
}
  ? ResponseBodies<R>
  : never;

export interface RecordedResponse<B> {
  status: number;
  headers: Headers;
  body: B;
}

// --- recorded exchanges ------------------------------------------------------

/** `setup` calls build the world the claim is about; `subject` calls are the
 *  claim itself. Only subjects are rendered into the spec — see emit.ts. */
export type Role = "setup" | "subject";

/** The recorded stream is ordered and interleaved: an author's `comment()` sits
 *  between the calls it explains, and codegen emits it in that position. */
export type Entry = { kind: "comment"; text: string } | ({ kind: "exchange" } & Exchange);

export interface Exchange {
  role: Role;
  request: {
    method: string;
    /** OpenAPI path template, e.g. `/orders/{orderId}/cancel` — this is what
     *  ties an exchange back to an operation when injecting examples. */
    path: string;
    /** Concrete path with params substituted and ids aliased, for display. */
    url: string;
    body?: unknown;
    /** The call let fetch follow the redirect, so `response` below is what came
     *  back from the *end* of the chain. Recorded because the generated snippet
     *  has to opt in the same way to reproduce it. */
    followRedirect?: true;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
  };
}

export interface RequestSpec {
  method: string;
  path: string;
  params?: Record<string, string | number>;
  query?: Record<string, string>;
  body?: unknown;
  /** Opt out of `redirect: "manual"` for the rare claim that is *about* what a
   *  redirect-following client ends up with. Note that fetch converts POST to
   *  GET across a 302, so such a client can end up somewhere a reader of the
   *  transcript would not predict. */
  redirect?: "follow";
}

type CallOpts = Omit<RequestSpec, "method" | "path" | "body">;

let lastRequestAt = 0;

async function throttle(gapMs: number): Promise<void> {
  const wait = lastRequestAt + gapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export class RecordingClient<S> {
  readonly entries: Entry[] = [];
  private role: Role = "subject";

  constructor(
    private readonly config: ClientConfig,
    private readonly aliaser: Aliaser,
  ) {}

  /** Narration for the generated example, recorded in place. Use it to say why
   *  a call is being made — the calls themselves already say what. */
  comment(text: string): void {
    this.entries.push({ kind: "comment", text });
  }

  /**
   * Declare a server-assigned value volatile, returning it unchanged so the
   * call wraps the value it names:
   *
   *     const noteId = client.volatile(body.noteId);
   *
   * Anything a run caused to exist needs this, or the transcript churns on the
   * next re-record. Declaring late is fine — nothing is redacted until the
   * transcript is written.
   */
  volatile<T extends number>(value: T): T {
    return this.aliaser.volatile(value);
  }

  /** Calls made inside `fn` are recorded but marked as setup, not as the claim. */
  async setup<T>(fn: () => Promise<T>): Promise<T> {
    this.role = "setup";
    try {
      return await fn();
    } finally {
      this.role = "subject";
    }
  }

  /** Untyped escape hatch, for claims about requests the spec does not (and
   *  should not) describe — a malformed body, an undocumented parameter. */
  async request(spec: RequestSpec): Promise<{ status: number; headers: Headers; body: unknown }> {
    let concrete = spec.path;
    for (const [k, v] of Object.entries(spec.params ?? {})) {
      concrete = concrete.replace(`{${k}}`, String(v));
    }
    const qs = spec.query ? `?${new URLSearchParams(spec.query)}` : "";

    await throttle(this.config.minRequestGapMs ?? 0);
    const res = await fetch(`${this.config.baseUrl}${concrete}${qs}`, {
      method: spec.method,
      headers: {
        ...this.config.headers,
        ...(spec.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      // A redirect is itself part of what the API did. Following it would hide
      // the status and Location a claim may be entirely about, so a caller has
      // to ask for anything else explicitly.
      redirect: spec.redirect ?? "manual",
    });

    const text = await res.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text; // e.g. an HTML rejection from a proxy in front of the API
      }
    }

    // Recorded raw. Redaction is deferred to redactEntries so that a caller can
    // declare a value *after* the call that produced it — which is the only
    // order available, since a server-assigned id arrives in the response.
    this.entries.push({
      kind: "exchange",
      role: this.role,
      request: {
        method: spec.method,
        path: spec.path,
        url: `${concrete}${qs}`,
        ...(spec.body === undefined ? {} : { body: spec.body }),
        ...(spec.redirect === "follow" ? { followRedirect: true as const } : {}),
      },
      response: {
        status: res.status,
        headers: stableHeaders(res.headers),
        ...(body === undefined ? {} : { body }),
      },
    });

    return { status: res.status, headers: res.headers, body };
  }

  post<P extends PathWith<S, "post">>(path: P, body: JsonBody<S, P, "post">, opts?: CallOpts) {
    return this.request({ method: "POST", path, body, ...opts }) as Promise<
      RecordedResponse<ResponseBody<S, P, "post">>
    >;
  }

  put<P extends PathWith<S, "put">>(path: P, body: JsonBody<S, P, "put">, opts?: CallOpts) {
    return this.request({ method: "PUT", path, body, ...opts }) as Promise<
      RecordedResponse<ResponseBody<S, P, "put">>
    >;
  }

  get<P extends PathWith<S, "get">>(path: P, opts?: CallOpts) {
    return this.request({ method: "GET", path, ...opts }) as Promise<
      RecordedResponse<ResponseBody<S, P, "get">>
    >;
  }
}

/** Keep the headers that document the exchange, drop the per-run ones. Pure
 *  selection — the surviving values are redacted later, with everything else. */
function stableHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...STABLE_RESPONSE_HEADERS].sort()) {
    const raw = h.get(name);
    if (raw !== null) out[name] = raw;
  }
  return out;
}

/**
 * Apply the caller's declarations to everything it recorded.
 *
 * Requests are redacted without the clock rule: a datetime the caller wrote is
 * an input the example exists to show, not a server reading.
 */
export function redactEntries(entries: Entry[], aliaser: Aliaser): Entry[] {
  return entries.map((entry) => {
    if (entry.kind === "comment") return { ...entry, text: aliaser.text(entry.text) };
    const { request, response } = entry;
    return {
      ...entry,
      request: {
        ...request,
        url: aliaser.text(request.url),
        ...(request.body === undefined ? {} : { body: aliaser.value(request.body) }),
      },
      response: {
        ...response,
        headers: aliaser.value(response.headers) as Record<string, string>,
        ...(response.body === undefined
          ? {}
          : { body: aliaser.value(response.body, { clock: true }) }),
      },
    };
  });
}
