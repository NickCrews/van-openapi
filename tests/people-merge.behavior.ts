import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";

/** Narrows the standard `{errors: [{code, text}]}` envelope. Response bodies are
 *  typed as the union of everything the operation documents, so a refusal has
 *  to be narrowed before its text can be read. */
function errorText(body: unknown): string | undefined {
  const errors = (body as { errors?: { text?: string }[] }).errors;
  return errors?.[0]?.text;
}

behavior(
  {
    id: "merge-deletes-secondary-and-answers-with-primary",
    title: "A merge keeps the primary, deletes the secondary, and answers with the survivor",
    claim:
      "The secondary named in the path is merged into the primary named in the body. The 200 " +
      "carries the primary's vanId — the survivor, not the id from the path — with a Location " +
      "pointing at it, and the secondary answers 404 from then on.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    comment("Two duplicates of one person. The primary survives; the secondary is consumed.");
    const primary = await van.create({ firstName: "Lena", lastName: `Voss-${scope}` });
    const secondary = await van.create({ firstName: "Lena", lastName: `Voss-${scope}` });

    comment("The secondary goes in the path; the body names the primary that survives.");
    const merged = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: primary },
      { params: { vanId: secondary } },
    );

    expect(merged.status).toBe(200);
    expect(merged.body).toEqual({ vanId: primary });
    expect(merged.headers.get("location")).toContain(`/people/${primary}`);

    comment("The primary is still there under its own vanId.");
    const survivor = await van.get("/people/{vanId}", { params: { vanId: primary } });
    expect(survivor.status).toBe(200);
    expect(survivor.body).toMatchObject({ vanId: primary });

    comment("The secondary is not, and never will be — merges cannot be undone.");
    const consumed = await van.get("/people/{vanId}", { params: { vanId: secondary } });
    expect(consumed.status).toBe(404);
  },
);

behavior(
  {
    id: "merge-keeps-primary-values-and-fills-its-gaps",
    title: "Conflicting fields keep the primary's value; the primary's gaps fill from the secondary",
    claim:
      "Scalar fields the two people disagree on keep the primary's value, and fields the " +
      "primary left empty are filled in from the secondary — so the primary can come out of " +
      "a merge holding more data than it went in with.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    comment(
      "The two disagree on firstName, and the primary lacks the middleName and occupation " +
        "the secondary holds.",
    );
    const primary = await van.create({ firstName: "Beatriz", lastName: `Fontaine-${scope}` });
    const secondary = await van.create({
      firstName: "Bea",
      middleName: "Lucia",
      lastName: `Fontaine-${scope}`,
      occupation: "Archivist",
    });

    const merged = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: primary },
      { params: { vanId: secondary } },
    );
    expect(merged.status).toBe(200);

    comment(
      "The disputed firstName kept the primary's value; the middleName and occupation the " +
        "primary lacked were filled in from the secondary.",
    );
    const person = await van.get("/people/{vanId}", { params: { vanId: primary } });
    expect(person.status).toBe(200);
    expect(person.body).toMatchObject({
      firstName: "Beatriz",
      middleName: "Lucia",
      occupation: "Archivist",
    });
  },
);

behavior(
  {
    id: "merge-combines-emails-and-moves-reachability",
    title: "Emails are combined onto the primary, and shared ones are not doubled",
    claim:
      "The two people's emails are pooled onto the primary. An address both held is collapsed " +
      "to one entry — matched case-insensitively, keeping the primary's copy — and an email " +
      "that belonged only to the secondary now resolves to the primary through POST /people/find.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    comment(
      "Each person holds one email of their own, plus one they share — spelled with " +
        "different case on each side.",
    );
    const primaryOnly = `fern.primary-${scope}@example.com`;
    const secondaryOnly = `fern.secondary-${scope}@example.com`;
    const shared = `fern.shared-${scope}@example.com`;
    const primary = await van.create({
      firstName: "Fern",
      lastName: `Aldana-${scope}`,
      emails: [{ email: primaryOnly }, { email: shared }],
    });
    const secondary = await van.create({
      firstName: "Fern",
      lastName: `Aldana-${scope}`,
      emails: [{ email: secondaryOnly }, { email: `FERN.SHARED-${scope}@example.com` }],
    });

    const merged = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: primary },
      { params: { vanId: secondary } },
    );
    expect(merged.status).toBe(200);

    comment(
      "Three emails, not four: the shared address collapsed to a single entry, in the " +
        "primary's spelling.",
    );
    const person = await van.get("/people/{vanId}", {
      params: { vanId: primary },
      query: { $expand: "emails" },
    });
    expect(person.status).toBe(200);
    const emails = ((person.body as { emails?: { email: string }[] }).emails ?? [])
      .map((e) => e.email)
      .sort();
    expect(emails).toEqual([primaryOnly, secondaryOnly, shared].sort());

    comment("Reachability moved too: the secondary's own email now finds the primary.");
    const found = await van.post("/people/find", { emails: [{ email: secondaryOnly }] });
    expect(found.status).toBe(302);
    expect(found.body).toEqual({ vanId: primary, status: "Matched" });
  },
);

behavior(
  {
    id: "merge-whatif-requires-literal-true",
    title: "whatIf only simulates for the literal string 'true'",
    claim:
      "Only the exact value `true` simulates. Every other non-empty value — including `1` and " +
      "`yes` — is read as false and performs the merge for real, and the response is identical " +
      "either way, so nothing in it reveals which one happened.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    comment("Two records to merge: the primary survives, the secondary is consumed.");
    const primary = await van.create({
      firstName: "Rosa",
      lastName: `Delgado-${scope}`,
      emails: [{ email: `rosa.delgado-${scope}@example.com` }],
    });
    const secondary = await van.create({
      firstName: "Rosa",
      lastName: `Delgado-${scope}`,
      emails: [{ email: `rdelgado-${scope}@example.com` }],
    });

    comment(
      "Ask for a simulation with whatIf=yes — truthy in every language a caller might " +
      "write this in. The 200 below is exactly what a real simulation returns.",
    );
    const merge = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: primary },
      { params: { vanId: secondary }, query: { whatIf: "yes" } },
    );

    expect(merge.status).toBe(200);

    comment(
      "But nothing was simulated. The secondary is gone for good — only the literal " +
      "string `true` suppresses the write.",
    );
    const gone = await van.get("/people/{vanId}", { params: { vanId: secondary } });
    expect(gone.status).toBe(404);
  },
);

behavior(
  {
    id: "merge-whatif-true-simulates-without-writing",
    title: "whatIf=true returns the completed-merge response without merging",
    claim:
      "A simulation answers exactly as a real merge does — same 200, same body, same Location " +
      "pointing at the primary — while both records survive. The response is therefore no " +
      "evidence that a merge happened.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    comment("Two records to merge: the primary would survive, the secondary would be consumed.");
    const { primary, secondary } = await van.setup(async () => ({
      primary: await van.create({ firstName: "Miles", lastName: `Okafor-${scope}` }),
      secondary: await van.create({ firstName: "Miles", lastName: `Okafor-${scope}` }),
    }));

    comment("Simulate with the literal string `true` — the only value that suppresses the write.");
    const simulated = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: primary },
      { params: { vanId: secondary }, query: { whatIf: "true" } },
    );

    expect(simulated.status).toBe(200);
    expect(simulated.body).toEqual({ vanId: primary });
    expect(simulated.headers.get("location")).toContain(`/people/${primary}`);

    comment("Nothing was written: the secondary is still there, unlike after a real merge.");
    const stillThere = await van.get("/people/{vanId}", { params: { vanId: secondary } });
    expect(stillThere.status).toBe(200);
  },
);

behavior(
  {
    id: "merge-refuses-unusable-bodies",
    title: "A body without a usable vanId is refused, with two different messages",
    claim:
      "A well-formed object that simply has no vanId is refused differently from a body that is " +
      "not an object at all, so the message distinguishes 'you forgot the id' from 'I could not " +
      "read this'.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    const secondary = await van.create({ firstName: "Priya", lastName: `Raman-${scope}` });

    comment("A JSON object that parses fine but names no counterpart.");
    const missing = await van.request({
      method: "PUT",
      path: "/people/{vanId}/mergeInto",
      params: { vanId: secondary },
      body: {},
    });
    expect(missing.status).toBe(400);
    expect(errorText(missing.body)).toBe("Must specify VanIDs for merging");

    comment("A body that is valid JSON but not an object at all.");
    const unparseable = await van.request({
      method: "PUT",
      path: "/people/{vanId}/mergeInto",
      params: { vanId: secondary },
      body: "nope",
    });
    expect(unparseable.status).toBe(400);
    expect(errorText(unparseable.body)).toBe("The body of the request is null or cannot be parsed.");
  },
);

behavior(
  {
    id: "merge-empty-whatif-is-rejected",
    title: "An empty whatIf is rejected outright",
    claim:
      "`?whatIf=` is the one value that neither simulates nor merges: it is refused with a bare " +
      "BAD_REQUEST. Every other non-empty value performs the merge, so the empty string is the " +
      "only typo here that is safe.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    const { primary, secondary } = await van.setup(async () => ({
      primary: await van.create({ firstName: "Dana", lastName: `Whitfield-${scope}` }),
      secondary: await van.create({ firstName: "Dana", lastName: `Whitfield-${scope}` }),
    }));

    comment("Send the parameter with no value. Nothing is merged and nothing is simulated.");
    const res = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: primary },
      { params: { vanId: secondary }, query: { whatIf: "" } },
    );

    expect(res.status).toBe(400);
    expect(errorText(res.body)).toBe("The request is invalid.");

    comment("Both records survive, confirming the request was refused before anything was written.");
    const survivor = await van.get("/people/{vanId}", { params: { vanId: secondary } });
    expect(survivor.status).toBe(200);
  },
);

behavior(
  {
    id: "merge-refuses-mismatched-contact-modes",
    title: "A person and an organization cannot be merged",
    claim:
      "Both records must be the same kind of contact. The refusal names both vanIds and tells " +
      "the caller to change the contactMode in the UI first, so it is the only 400 here that " +
      "identifies which records were at fault.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    comment("One person and one organization — the same database, two kinds of contact.");
    const { organization, individual } = await van.setup(async () => ({
      organization: await van.create({
        contactMode: "Organization",
        lastName: `Harborview Tenants Union-${scope}`,
      }),
      individual: await van.create({ firstName: "Theo", lastName: `Marsh-${scope}` }),
    }));

    comment(
      "Simulate the merge, so the refusal is the only thing this behavior can possibly do. " +
      "The kinds are checked before anything else about the pair.",
    );
    const res = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: organization },
      { params: { vanId: individual }, query: { whatIf: "true" } },
    );

    expect(res.status).toBe(400);
    expect(errorText(res.body)).toContain("not the same type of Contact");
  },
);

behavior(
  {
    id: "merge-remembers-merged-away-ids",
    title: "A merged-away vanId is refused forever, with its own message",
    claim:
      "A vanId that has been merged away is refused on either side of any later merge with a " +
      "different message from the one an id that never existed gets. Since GET /people/{vanId} " +
      "answers 404 for both, this endpoint is the only way to tell them apart.",
    spec: ["#/paths/~1people~1{vanId}~1mergeInto/put"],
  },
  async ({ van, scope, comment }) => {
    comment("Three records: two to merge now, one to attempt a second merge against later.");
    const { primary, secondary, third } = await van.setup(async () => ({
      primary: await van.create({ firstName: "Ivy", lastName: `Calloway-${scope}` }),
      secondary: await van.create({ firstName: "Ivy", lastName: `Calloway-${scope}` }),
      third: await van.create({ firstName: "Omar", lastName: `Haddad-${scope}` }),
    }));

    comment("Merge the secondary away. Its vanId now 404s on GET /people/{vanId}.");
    await van.setup(() =>
      van.put(
        "/people/{vanId}/mergeInto",
        { vanId: primary },
        { params: { vanId: secondary } },
      ),
    );

    comment("Reuse that merged-away id in a fresh merge. It is remembered, permanently.");
    const reused = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: third },
      { params: { vanId: secondary } },
    );
    expect(reused.status).toBe(400);
    expect(errorText(reused.body)).toBe(
      "One or more of these contacts has already been merged.",
    );

    comment(
      "An id that never existed is refused too, but with different text. That difference " +
      "is the only way to tell the two apart — GET /people/{vanId} answers 404 for both.",
    );
    const neverExisted = await van.put(
      "/people/{vanId}/mergeInto",
      { vanId: third },
      { params: { vanId: 2_147_483_646 } },
    );
    expect(neverExisted.status).toBe(400);
    expect(errorText(neverExisted.body)).toBe(
      "You must have access to both contacts to merge them.",
    );
  },
);
