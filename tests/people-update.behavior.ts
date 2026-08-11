import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";
import { firstError } from "./harness/errors.js";

/** Person carries a long tail of properties the spec leaves untyped — they were
 *  only ever observed as null. Reading one back is the point of the field-set
 *  behaviors below, so they index the body rather than going through `Person`. */
function fields(body: unknown): Record<string, unknown> {
  return body as Record<string, unknown>;
}

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

behavior(
  {
    id: "update-writes-every-scalar-field",
    title: "The whole scalar field set, written in one update",
    claim:
      "Every scalar field PersonInput documents is writeable through an update, in a single " +
      "payload: the name parts, the derived-by-default salutation and envelopeName, nickname, " +
      "website, party, sex, dateOfBirth, the three job fields, contactMethodPreferenceCode and " +
      "contactMode. Four of them — nickname, website, jobTitle and " +
      "contactMethodPreferenceCode — read back null on a plain GET and only surface under " +
      "`$expand=preferences`, so a round-trip without it looks like the write was dropped. " +
      "Three genuinely are dropped: collectedLocationId, electionType and cycle are accepted " +
      "and leave no trace anywhere the API will show you. The organizationContact names are " +
      "conditional — discarded while the record is in Person mode, stored once contactMode is " +
      "Organization.",
    spec: ["#/paths/~1people~1{vanId}/post"],
  },
  async ({ van, scope, comment }) => {
    comment("A blank person, so every field below arrives by way of the update.");
    const vanId = await van.create({});

    comment("One update carrying every scalar field the payload documents.");
    const res = await van.post(
      "/people/{vanId}",
      {
        firstName: "Ottoline",
        middleName: "Quill",
        lastName: `Fieldwright-${scope}`,
        suffix: "Jr.",
        title: "Dr.",
        salutation: "Hey Otto",
        envelopeName: "O. Q. Fieldwright",
        nickname: "Otto",
        website: "https://ottoline.example",
        party: "D",
        contactMethodPreferenceCode: "E",
        employer: "Ship Creek Group",
        occupation: "Cartographer",
        jobTitle: "Chief Mapper",
        sex: "F",
        dateOfBirth: "1985-03-04",
        collectedLocationId: 12_345,
        electionType: "G",
        cycle: "2024",
        organizationContactCommonName: "Fieldwright Cartography",
        organizationContactOfficialName: "Fieldwright Cartography LLC",
        contactMode: "Person",
      },
      { params: { vanId } },
    );

    expect(res.status).toBe(302);

    comment(
      "Read it back plainly. Most of it landed — but nickname, website, jobTitle and " +
      "contactMethodPreferenceCode come back null, as if the write had been ignored.",
    );
    const plain = await van.get("/people/{vanId}", { params: { vanId } });

    expect(plain.body).toMatchObject({
      firstName: "Ottoline",
      middleName: "Quill",
      lastName: `Fieldwright-${scope}`,
      // "Jr." reads back as "Jr": suffix is normalized against a lookup.
      suffix: "Jr",
      title: "Dr.",
      salutation: "Hey Otto",
      envelopeName: "O. Q. Fieldwright",
      party: "D",
      employer: "Ship Creek Group",
      occupation: "Cartographer",
      sex: "F",
      dateOfBirth: "1985-03-04T00:00:00Z",
      contactMode: "Person",
    });

    for (const hidden of ["nickname", "website", "jobTitle", "contactMethodPreferenceCode"]) {
      expect(fields(plain.body)[hidden]).toBeNull();
    }

    comment("They did land. `$expand=preferences` is what makes those four readable.");
    const expanded = await van.get("/people/{vanId}", {
      params: { vanId },
      query: { $expand: "preferences,electionRecords" },
    });

    expect(expanded.body).toMatchObject({
      nickname: "Otto",
      website: "https://ottoline.example",
      jobTitle: "Chief Mapper",
      contactMethodPreferenceCode: "E",
    });

    comment(
      "collectedLocationId, electionType and cycle are the ones really discarded: the person " +
      "record has nowhere to carry them, and the election records they name stay empty.",
    );
    expect(fields(expanded.body).electionRecords).toEqual([]);

    comment(
      "The organization names were dropped too — the record is in Person mode. Send them " +
      "again with contactMode Organization and they stick.",
    );
    expect(fields(plain.body).organizationContactCommonName).toBeNull();

    await van.post(
      "/people/{vanId}",
      {
        contactMode: "Organization",
        organizationContactCommonName: "Fieldwright Cartography",
        organizationContactOfficialName: "Fieldwright Cartography LLC",
      },
      { params: { vanId } },
    );
    const asOrganization = await van.get("/people/{vanId}", { params: { vanId } });

    expect(asOrganization.body).toMatchObject({
      contactMode: "Organization",
      organizationContactCommonName: "Fieldwright Cartography",
      organizationContactOfficialName: "Fieldwright Cartography LLC",
      // Still the same person record, name and all.
      firstName: "Ottoline",
    });
  },
);

behavior(
  {
    id: "update-suffix-is-matched-against-a-lookup",
    title: "A suffix is matched against a lookup, not stored as written",
    claim:
      "Unlike every other name part, `suffix` is not free text: it is matched case- and " +
      "punctuation-insensitively against a known list, so \"jr\" and \"Jr.\" both read back as " +
      "\"Jr\". A value the list does not recognize, eg \"Esq.\", is neither stored nor refused — the request " +
      "succeeds and the previous suffix is left standing.",
    spec: ["#/paths/~1people~1{vanId}/post"],
  },
  async ({ van, scope, comment }) => {
    const vanId = await van.create({ firstName: "Thaddeus", lastName: `Suffixon-${scope}` });

    comment("Lowercase, with no period. Stored in the lookup's own spelling.");
    await van.post("/people/{vanId}", { suffix: "jr" }, { params: { vanId } });
    const normalized = await van.get("/people/{vanId}", { params: { vanId } });
    expect(normalized.body).toMatchObject({ suffix: "Jr" });

    comment("An honorific the list does not hold. Accepted, and quietly ignored.");
    const unknown = await van.post("/people/{vanId}", { suffix: "Esq." }, { params: { vanId } });
    expect(unknown.status).toBe(302);

    const after = await van.get("/people/{vanId}", { params: { vanId } });
    expect(after.body).toMatchObject({ suffix: "Jr" });
  },
);
