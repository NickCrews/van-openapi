import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";
import { firstError } from "./harness/errors.js";

behavior(
  {
    id: "person-collections-null-until-expanded",
    title: "Related collections are null until $expand asks for them",
    claim:
      "Emails, phones and addresses come back null — not empty — unless the request names them " +
      "in $expand. Expanded, a section the person actually has is an array of entries and a " +
      "section they lack is an empty array, so null always means 'not requested', never 'none'.",
    spec: ["#/paths/~1people~1{vanId}/get"],
  },
  async ({ van, scope, comment }) => {
    comment("A person with one email and nothing else.");
    const vanId = await van.create({
      firstName: "Nadia",
      lastName: `Okonkwo-${scope}`,
      emails: [{ email: `nadia.okonkwo-${scope}@example.com` }],
    });

    comment("Without $expand, every collection is null — including the email we just wrote.");
    const bare = await van.get("/people/{vanId}", { params: { vanId } });

    expect(bare.status).toBe(200);
    expect(bare.body).toMatchObject({ vanId, emails: null, phones: null, addresses: null });

    comment("Expanded, the email appears and the phones the person lacks are [] rather than null.");
    const expanded = await van.get("/people/{vanId}", {
      params: { vanId },
      query: { $expand: "emails,phones" },
    });

    expect(expanded.status).toBe(200);
    const person = expanded.body as { emails: { email: string }[]; phones: unknown[] };
    expect(person.emails).toHaveLength(1);
    expect(person.emails[0].email).toBe(`nadia.okonkwo-${scope}@example.com`);
    expect(person.phones).toEqual([]);
  },
);

behavior(
  {
    id: "person-expand-set-is-policed",
    title: "$expand values are policed, and two valid ones are refused here",
    claim:
      "A value outside the documented set is refused with INVALID_PARAMETER and a hint listing " +
      "every valid value. Two values inside the set are still refused in a My Campaign context: " +
      "`scores` with 403 and `pollingLocation` with 400.",
    spec: ["#/paths/~1people~1{vanId}/get"],
  },
  async ({ van, scope, comment }) => {
    const vanId = await van.create({ firstName: "Emeka", lastName: `Adeyemi-${scope}` });

    comment("An invented section. The hint in the refusal is the authoritative list.");
    const invented = await van.get("/people/{vanId}", {
      params: { vanId },
      query: { $expand: "frisbees" },
    });

    expect(invented.status).toBe(400);
    expect(firstError(invented.body).code).toBe("INVALID_PARAMETER");
    expect(firstError(invented.body).hint).toContain("emails");

    comment("`scores` is in the valid set, but this context is refused it outright.");
    const scores = await van.get("/people/{vanId}", {
      params: { vanId },
      query: { $expand: "scores" },
    });

    expect(scores.status).toBe(403);
    expect(firstError(scores.body).code).toBe("FORBIDDEN");

    comment("`pollingLocation` is also in the set, and also refused — but as a 400.");
    const polling = await van.get("/people/{vanId}", {
      params: { vanId },
      query: { $expand: "pollingLocation" },
    });

    expect(polling.status).toBe(400);
    expect(firstError(polling.body).code).toBe("BAD_REQUEST");
  },
);

behavior(
  {
    id: "person-unknown-ids-404-two-ways",
    title: "Unknown ids 404 with the envelope; a non-integer id gets HTML",
    claim:
      "An unknown, zero or negative vanId returns the standard 404 error envelope. A path " +
      "segment that is not an integer never reaches the handler — the route does not match, " +
      "and the answer is an HTML 404 page instead.",
    spec: ["#/paths/~1people~1{vanId}/get"],
  },
  async ({ van, comment }) => {
    comment("An id no record has ever had.");
    const unknown = await van.get("/people/{vanId}", { params: { vanId: 2_147_483_646 } });

    expect(unknown.status).toBe(404);
    expect(firstError(unknown.body).code).toBe("NOT_FOUND");

    comment("Zero is refused the same way.");
    const zero = await van.get("/people/{vanId}", { params: { vanId: 0 } });

    expect(zero.status).toBe(404);
    expect(firstError(zero.body).code).toBe("NOT_FOUND");

    comment("A non-integer segment matches no route: HTML, not the JSON envelope.");
    const html = await van.request({
      method: "GET",
      path: "/people/{vanId}",
      params: { vanId: "abc" },
    });

    expect(html.status).toBe(404);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(typeof html.body).toBe("string");
  },
);
