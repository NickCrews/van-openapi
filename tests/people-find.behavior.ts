import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";

/** A person carrying every identifier the match threshold can ask for, scoped
 *  so no other behavior — or any earlier run — can match them. */
const person = (scope: string) => ({
  firstName: "Harriet",
  lastName: `Kowalski-${scope}`,
  dateOfBirth: "1975-03-14",
  emails: [{ email: `harriet.kowalski-${scope}@example.com` }],
  phones: [{ phoneNumber: "9075554242" }],
  addresses: [
    {
      addressLine1: "742 Evergreen Terrace",
      city: "Springfield",
      stateOrProvince: "AK",
      zipOrPostalCode: "99501",
    },
  ],
});

behavior(
  {
    id: "find-below-threshold-is-unmatched",
    title: "A name alone returns 404 Unmatched even when the person exists",
    claim:
      "A 404 Unmatched does not mean the person is absent. Criteria that fall short of " +
      "the minimum combination are never matched at all, and the answer is indistinguishable " +
      "from a genuine no-match.",
    spec: ["#/paths/~1people~1find/post"],
  },
  async ({ van, scope, comment }) => {
    const p = person(scope);
    comment("Put a person in the database, carrying every identifier the match can ask for.");
    await van.create(p);

    comment(
      "Now look for them by name alone. The person is unambiguously there — we just " +
        "created them — but name alone is below the minimum combination, so no match is " +
        "attempted at all.",
    );
    const res = await van.post("/people/find", {
      firstName: p.firstName,
      lastName: p.lastName,
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ vanId: null, status: "Unmatched" });
  },
);

behavior(
  {
    id: "find-returns-first-created-duplicate",
    title: "With duplicates, name-based criteria return the first-created record",
    claim:
      "When several records match, exactly one vanId comes back and nothing in the response " +
      "says the match was ambiguous. Criteria including a name resolve to the oldest record.",
    spec: ["#/paths/~1people~1find/post"],
  },
  async ({ van, scope, comment }) => {
    const p = person(scope);
    comment("Create three records that are identical in every field.");
    const first = await van.create(p);
    await van.create(p);
    await van.create(p);

    comment(
      "All three match these criteria equally well. Exactly one vanId comes back, with " +
        "nothing to say the other two exist — and it is the first one created.",
    );
    const res = await van.post("/people/find", {
      firstName: p.firstName,
      lastName: p.lastName,
      emails: p.emails,
    });

    expect(res.status).toBe(302);
    expect(res.body).toEqual({ vanId: first, status: "Matched" });
    expect(res.headers.get("location")).toContain(`/people/${first}`);
  },
);

behavior(
  {
    id: "find-by-vanid-overrides-criteria",
    title: "A vanId in the body wins over every other criterion",
    claim:
      "When the body carries a vanId, the rest of the criteria are not used to search — they " +
      "are not even checked for agreement. A name that belongs to nobody still matches, so a " +
      "caller who sends a stale vanId alongside fresh details gets the stale record back.",
    spec: ["#/paths/~1people~1find/post"],
  },
  async ({ van, scope, comment }) => {
    const p = person(scope);
    comment("One person to aim at.");
    const vanId = await van.create(p);

    comment(
      "Ask for that vanId while giving a name that matches no record at all. The " +
        "contradiction is ignored: the vanId decides the answer by itself.",
    );
    const res = await van.post("/people/find", {
      vanId,
      firstName: "Desmond",
      lastName: `Pemberton-${scope}`,
    });

    expect(res.status).toBe(302);
    expect(res.body).toEqual({ vanId, status: "Matched" });
  },
);

behavior(
  {
    id: "find-followed-redirect-returns-the-person",
    title: "Following the 302 returns the whole person, not the match stub",
    claim:
      "A client that follows the redirect never sees the `{vanId, status}` stub — it ends up on " +
      "GET /people/{vanId} and receives the full record with 200. This only works if the client " +
      "converts to GET, as fetch and browsers do; `curl -X POST -L` keeps the method and gets 411.",
    spec: ["#/paths/~1people~1find/post"],
  },
  async ({ van, scope, comment }) => {
    const p = person(scope);
    comment("A person to match, carrying enough identifiers to clear the threshold.");
    const vanId = await van.create(p);

    comment(
      "Same find as ever, but this client follows the redirect. The 200 below came from " +
        "GET /people/{vanId} at the end of the chain, which is why it is a whole person.",
    );
    const res = await van.post(
      "/people/find",
      { firstName: p.firstName, lastName: p.lastName, emails: p.emails },
      { redirect: "follow" },
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ vanId, firstName: p.firstName, lastName: p.lastName });
  },
);

behavior(
  {
    id: "find-minimum-match-combinations",
    title: "Only certain criteria combinations are matched at all",
    claim:
      "The endpoint does not attempt a match until the criteria reach one of a fixed set of " +
      "combinations. Below that it answers 404 Unmatched rather than 400, so an under-specified " +
      "query is silently indistinguishable from a person who is not there.",
    spec: ["#/paths/~1people~1find/post"],
    // ~12 requests behind a 10/s throttle. Off the inner loop by default.
    slow: true,
  },
  async ({ van, scope, comment }) => {
    const p = person(scope);
    comment("One person, holding every identifier, so only the criteria vary below.");
    await van.create(p);

    const { firstName, lastName, dateOfBirth, emails, phones, addresses } = p;
    const zipOnly = [{ zipOrPostalCode: addresses[0].zipOrPostalCode }];

    const table: [label: string, criteria: object, expected: number][] = [
      ["name + email", { firstName, lastName, emails }, 302],
      ["name + phone", { firstName, lastName, phones }, 302],
      ["name + zip + dateOfBirth", { firstName, lastName, dateOfBirth, addresses: zipOnly }, 302],
      ["name + street + zip", { firstName, lastName, addresses }, 302],
      ["email alone", { emails }, 302],
      ["phone alone", { phones }, 302],
      ["name alone", { firstName, lastName }, 404],
      ["name + dateOfBirth", { firstName, lastName, dateOfBirth }, 404],
      ["name + zip", { firstName, lastName, addresses: zipOnly }, 404],
      ["street + zip, no name", { addresses }, 404],
      // Extra criteria narrow, they never widen: a wrong name kills a good email.
      ["wrong name + right email", { firstName: "Gregory", lastName, emails }, 404],
    ];

    for (const [label, criteria, expected] of table) {
      comment(`${label} → ${expected === 302 ? "matched" : "unmatched"}`);
      const res = await van.post("/people/find", criteria);
      // soft: report every row of the table in one run, not just the first failure
      expect.soft(res.status, label).toBe(expected);
    }
  },
);
