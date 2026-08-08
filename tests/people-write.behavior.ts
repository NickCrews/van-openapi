import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";

/** Narrows the match-stub / created-stub bodies these endpoints answer with. */
function stub(body: unknown): { vanId: number; status: string } {
  return body as { vanId: number; status: string };
}

behavior(
  {
    id: "create-never-deduplicates",
    title: "An identical payload creates a second person record",
    claim:
      "No de-duplication happens: posting a payload identical to an existing person's — same " +
      "name, same email — returns 201 with a fresh vanId, and both person records now exist.",
    spec: ["#/paths/~1people~1create/post"],
  },
  async ({ van, scope, comment }) => {
    const payload = {
      firstName: "Beatrix",
      lastName: `Falkner-${scope}`,
      emails: [{ email: `beatrix.falkner-${scope}@example.com` }],
    };

    comment("Create a person.");
    const first = await van.post("/people/create", payload);

    expect(first.status).toBe(201);
    expect(stub(first.body).status).toBe("Stored");
    const firstId = van.volatile(stub(first.body).vanId);

    comment("Create them again, byte for byte. Nothing objects: a duplicate is born.");
    const second = await van.post("/people/create", payload);

    expect(second.status).toBe(201);
    expect(stub(second.body).status).toBe("Stored");
    const secondId = van.volatile(stub(second.body).vanId);
    expect(secondId).not.toBe(firstId);
  },
);

behavior(
  {
    id: "create-with-a-vanid-matches-instead",
    title: "A vanId that exists matches instead of creating",
    claim:
      "When the body carries a vanId that exists, nothing is created: the answer is the same " +
      "302 match stub findOrCreate gives, with a Location pointing at the existing person.",
    spec: ["#/paths/~1people~1create/post"],
  },
  async ({ van, scope, comment }) => {
    comment("An existing person to name in the body.");
    const vanId = await van.create({ firstName: "Soren", lastName: `Lindqvist-${scope}` });

    comment("A create request that names them. No record is created.");
    const res = await van.post("/people/create", { vanId, firstName: "Soren" });

    expect(res.status).toBe(302);
    expect(res.body).toEqual({ vanId, status: "Matched" });
    expect(res.headers.get("location")).toContain(`/people/${vanId}`);
  },
);

behavior(
  {
    id: "create-echoes-a-plausible-vanid-blindly",
    title: "A plausible vanId is echoed back as matched, existent or not",
    claim:
      "The vanId in the body is never checked against the database: any id in the range this " +
      "database has ever assigned answers 302 Matched with the id echoed straight back, even " +
      "when it names no one — the Location it points at answers 404. Nothing is created.",
    spec: ["#/paths/~1people~1create/post"],
  },
  async ({ van, comment }) => {
    comment("An id in the assigned range that names no person.");
    const before = await van.get("/people/{vanId}", { params: { vanId: 100_777_777 } });
    expect(before.status).toBe(404);

    comment("Create with that id: matched, apparently.");
    const res = await van.post("/people/create", { vanId: 100_777_777, firstName: "Phantom" });

    expect(res.status).toBe(302);
    expect(res.body).toEqual({ vanId: 100_777_777, status: "Matched" });
    expect(res.headers.get("location")).toContain("/people/100777777");

    comment("But the person the Location points at still does not exist.");
    const after = await van.get("/people/{vanId}", { params: { vanId: 100_777_777 } });
    expect(after.status).toBe(404);
  },
);

behavior(
  {
    id: "create-with-an-implausible-vanid-creates-anyway",
    title: "An implausible vanId hides a create behind the 302",
    claim:
      "A vanId outside the range the database has ever assigned is ignored — but the request " +
      "is not refused: the rest of the payload is stored as a new person record, and the " +
      "answer is still the 302 Matched stub, pointing at the person just created. Only the " +
      "unfamiliar vanId in the response betrays that something was written.",
    spec: ["#/paths/~1people~1create/post"],
  },
  async ({ van, scope, comment }) => {
    comment("An id no record has ever had, far beyond the assigned range.");
    const res = await van.post("/people/create", {
      vanId: 2_147_483_646,
      firstName: "Implausia",
      lastName: `Storedanyway-${scope}`,
    });

    expect(res.status).toBe(302);
    expect(stub(res.body).status).toBe("Matched");
    const created = van.volatile(stub(res.body).vanId);
    expect(created).not.toBe(2_147_483_646);
    expect(res.headers.get("location")).toContain(`/people/${created}`);

    comment("The 'match' is a person that did not exist a moment ago.");
    const person = await van.get("/people/{vanId}", { params: { vanId: created } });
    expect(person.status).toBe(200);
    expect((person.body as { firstName: string }).firstName).toBe("Implausia");
  },
);

behavior(
  {
    id: "findorcreate-ignores-an-unknown-vanid",
    title: "findOrCreate drops a vanId that matches nothing",
    claim:
      "Where create echoes a plausible unknown vanId back as a phantom match, findOrCreate " +
      "just drops it: the ordinary match runs on the rest of the payload — here finding the " +
      "existing person by name and email — and would have created a person had it found " +
      "nothing. The vanId only matters when it names a real person.",
    spec: ["#/paths/~1people~1findOrCreate/post"],
  },
  async ({ van, scope, comment }) => {
    const payload = {
      firstName: "Ignesia",
      lastName: `Vanidless-${scope}`,
      emails: [{ email: `ignesia.vanidless-${scope}@example.com` }],
    };
    comment("The person is in the database, under some other vanId.");
    const existing = await van.create(payload);

    comment("findOrCreate naming a vanId that exists nowhere, plus their real name and email.");
    const res = await van.post("/people/findOrCreate", { vanId: 100_777_777, ...payload });

    expect(res.status).toBe(302);
    expect(res.body).toEqual({ vanId: existing, status: "Matched" });
    expect(res.headers.get("location")).toContain(`/people/${existing}`);
  },
);

behavior(
  {
    id: "findorcreate-returns-the-existing-match",
    title: "Above the match threshold, findOrCreate returns the existing person",
    claim:
      "Name plus email clears the minimum match combination, so the existing person comes back " +
      "as a 302 match stub with a Location header, and nothing is written.",
    spec: ["#/paths/~1people~1findOrCreate/post"],
  },
  async ({ van, scope, comment }) => {
    const payload = {
      firstName: "Marisol",
      lastName: `Vega-${scope}`,
      emails: [{ email: `marisol.vega-${scope}@example.com` }],
    };
    comment("The person is already in the database.");
    const vanId = await van.create(payload);

    comment("findOrCreate with the same name and email: found, not created.");
    const res = await van.post("/people/findOrCreate", payload);

    expect(res.status).toBe(302);
    expect(res.body).toEqual({ vanId, status: "Matched" });
    expect(res.headers.get("location")).toContain(`/people/${vanId}`);
  },
);

behavior(
  {
    id: "findorcreate-below-threshold-creates-a-duplicate",
    title: "Below the match threshold, findOrCreate quietly creates a duplicate",
    claim:
      "A name alone never reaches the minimum match combination, so no match is attempted: the " +
      "payload is stored as a brand-new person record even though the person is already in the " +
      "database. There is no 'unmatched' to inspect — the no-match case is the create case.",
    spec: ["#/paths/~1people~1findOrCreate/post"],
  },
  async ({ van, scope, comment }) => {
    comment("The person is in the database, carrying identifiers a match could use.");
    const existing = await van.create({
      firstName: "Harriet",
      lastName: `Duplicata-${scope}`,
      emails: [{ email: `harriet.duplicata-${scope}@example.com` }],
    });

    comment("findOrCreate with the name alone. Below the threshold, so: created, not found.");
    const res = await van.post("/people/findOrCreate", {
      firstName: "Harriet",
      lastName: `Duplicata-${scope}`,
    });

    expect(res.status).toBe(201);
    expect(stub(res.body).status).toBe("UnmatchedStored");
    const duplicate = van.volatile(stub(res.body).vanId);
    expect(duplicate).not.toBe(existing);

    comment("Both person records now exist under the same name.");
    const both = await van.get("/people", { query: { lastName: `Duplicata-${scope}` } });
    expect(both.body).toMatchObject({ count: 2 });
  },
);

behavior(
  {
    id: "empty-bodies-create-blank-people",
    title: "An empty body creates a blank person record",
    claim:
      "Every field is optional, including the name, so `{}` is a valid payload on both create " +
      "endpoints: create answers 201 Stored, and findOrCreate — with no criteria to match on — " +
      "answers 201 UnmatchedStored. Each call leaves a nameless person record behind.",
    spec: ["#/paths/~1people~1create/post", "#/paths/~1people~1findOrCreate/post"],
  },
  async ({ van, comment }) => {
    comment("Create from nothing.");
    const created = await van.post("/people/create", {});

    expect(created.status).toBe(201);
    expect(stub(created.body).status).toBe("Stored");
    van.volatile(stub(created.body).vanId);

    comment("findOrCreate from nothing: no criteria means no match, which means create.");
    const foundOrCreated = await van.post("/people/findOrCreate", {});

    expect(foundOrCreated.status).toBe(201);
    expect(stub(foundOrCreated.body).status).toBe("UnmatchedStored");
    van.volatile(stub(foundOrCreated.body).vanId);
  },
);
