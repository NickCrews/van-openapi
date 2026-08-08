import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";
import { firstError } from "./harness/errors.js";

behavior(
  {
    id: "update-merges-fields-and-answers-with-a-stub",
    title: "An update merges the payload and answers 302 with a match stub",
    claim:
      "The payload is merged into the record: fields in the body are overwritten, fields left " +
      "out keep their values. The response is a 302 whose Location points back at the person " +
      "and whose body is the same match stub find returns — not the updated person.",
    spec: ["#/paths/~1people~1{vanId}/post"],
  },
  async ({ van, scope, comment }) => {
    comment("A person whose first name is about to change.");
    const vanId = await van.create({ firstName: "Corazon", lastName: `Ellsworth-${scope}` });

    comment("Send only the new first name.");
    const updated = await van.post("/people/{vanId}", { firstName: "Cora" }, { params: { vanId } });

    expect(updated.status).toBe(302);
    expect(updated.body).toEqual({ vanId, status: "Matched" });
    expect(updated.headers.get("location")).toContain(`/people/${vanId}`);

    comment("The first name changed; the last name, absent from the body, survived.");
    const after = await van.get("/people/{vanId}", { params: { vanId } });

    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ firstName: "Cora", lastName: `Ellsworth-${scope}` });
  },
);

behavior(
  {
    id: "update-appends-contact-methods",
    title: "Contact methods are appended, never replaced — and identical ones dedupe",
    claim:
      "Emails, phones and addresses in an update are added to what is already there; there is " +
      "no way to remove one through this endpoint. The append is idempotent for an identical " +
      "value: re-sending an email the person already has does not create a second entry.",
    spec: ["#/paths/~1people~1{vanId}/post"],
  },
  async ({ van, scope, comment }) => {
    const original = `imani.oyelaran-${scope}@example.com`;
    const extra = `imani.o-${scope}@example.org`;

    comment("A person with one email address.");
    const vanId = await van.create({
      firstName: "Imani",
      lastName: `Oyelaran-${scope}`,
      emails: [{ email: original }],
    });

    comment("Update with a second address. The first is not replaced — the list grows.");
    await van.post("/people/{vanId}", { emails: [{ email: extra }] }, { params: { vanId } });
    const afterAppend = await van.get("/people/{vanId}", {
      params: { vanId },
      query: { $expand: "emails" },
    });

    const appended = (afterAppend.body as { emails: { email: string }[] }).emails;
    expect(appended.map((e) => e.email).sort()).toEqual([extra, original].sort());

    comment("Send the second address again, unchanged. Nothing is duplicated: still two entries.");
    await van.post("/people/{vanId}", { emails: [{ email: extra }] }, { params: { vanId } });
    const afterRepeat = await van.get("/people/{vanId}", {
      params: { vanId },
      query: { $expand: "emails" },
    });

    const repeated = (afterRepeat.body as { emails: { email: string }[] }).emails;
    expect(repeated.map((e) => e.email).sort()).toEqual([extra, original].sort());
  },
);

behavior(
  {
    id: "update-empty-body-is-accepted-and-unknown-ids-404",
    title: "An empty body is a successful no-op; an unknown vanId is 404",
    claim:
      "`{}` is accepted and answered with the same 302 as a real update, changing nothing. " +
      "The failure mode is the id, not the body: an unknown vanId returns 404 whatever the " +
      "payload says.",
    spec: ["#/paths/~1people~1{vanId}/post"],
  },
  async ({ van, scope, comment }) => {
    const vanId = await van.create({ firstName: "Otis", lastName: `Renwick-${scope}` });

    comment("An update that updates nothing. Accepted all the same.");
    const noop = await van.post("/people/{vanId}", {}, { params: { vanId } });

    expect(noop.status).toBe(302);
    expect(noop.body).toEqual({ vanId, status: "Matched" });

    comment("The record is untouched.");
    const after = await van.get("/people/{vanId}", { params: { vanId } });
    expect(after.body).toMatchObject({ firstName: "Otis", lastName: `Renwick-${scope}` });

    comment("A perfectly good payload aimed at an id nobody has: 404.");
    const missing = await van.post(
      "/people/{vanId}",
      { firstName: "Nobody" },
      { params: { vanId: 2_147_483_646 } },
    );

    expect(missing.status).toBe(404);
    expect(firstError(missing.body).code).toBe("NOT_FOUND");
  },
);
