import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";
import { firstError } from "./harness/errors.js";

behavior(
  {
    id: "search-requires-a-search-parameter",
    title: "At least one search parameter must be set, and filters don't count",
    claim:
      "A request with no search parameter is refused outright — even one that sets paging or " +
      "filter parameters. `contactMode` is a filter, not a search parameter, so it alone does " +
      "not satisfy the requirement either.",
    spec: ["#/paths/~1people/get"],
  },
  async ({ van, comment }) => {
    comment("Paging alone is not a search.");
    const pagingOnly = await van.get("/people", { query: { $top: "5" } });

    expect(pagingOnly.status).toBe(400);
    expect(firstError(pagingOnly.body).code).toBe("INVALID_PARAMETER");
    expect(firstError(pagingOnly.body).text).toBe(
      "This endpoint requires at least one search parameter to be set.",
    );

    comment("contactMode filters results but does not count as a search parameter.");
    const filterOnly = await van.get("/people", { query: { contactMode: "Person" } });

    expect(filterOnly.status).toBe(400);
    expect(firstError(filterOnly.body).text).toBe(
      "This endpoint requires at least one search parameter to be set.",
    );
  },
);

behavior(
  {
    id: "search-is-a-case-insensitive-prefix-match",
    title: "Text criteria match case-insensitive prefixes, never substrings",
    claim:
      "Matching runs from the start of the field, ignoring case: `wilhel` finds Wilhelmina, " +
      "`helmina` finds nothing. Hits come back as full person records in the pagination " +
      "envelope, with collections null unless $expand asks for them.",
    spec: ["#/paths/~1people/get"],
  },
  async ({ van, scope, comment }) => {
    comment("One person to search for. The scoped last name keeps other data out of the results.");
    const vanId = await van.create({
      firstName: "Wilhelmina",
      lastName: `Prefixling-${scope}`,
      emails: [{ email: `wilhelmina.prefixling-${scope}@example.com` }],
    });

    comment("A lowercase prefix of the first name is enough.");
    const prefix = await van.get("/people", {
      query: { firstName: "wilhel", lastName: `Prefixling-${scope}` },
    });

    expect(prefix.status).toBe(200);
    const page = prefix.body as { count: number; items: { vanId: number; emails: unknown }[] };
    expect(page.count).toBe(1);
    expect(page.items[0]).toMatchObject({ vanId, firstName: "Wilhelmina", emails: null });

    comment("The same characters from the middle of the name match nothing: prefix, not contains.");
    const substring = await van.get("/people", {
      query: { firstName: "helmina", lastName: `Prefixling-${scope}` },
    });

    expect(substring.status).toBe(200);
    expect(substring.body).toMatchObject({ count: 0, items: [] });
  },
);

behavior(
  {
    id: "search-phone-must-be-bare-digits",
    title: "Only a bare 10-digit phone number finds anyone",
    claim:
      "The comparison is against the stored 10-digit string, so `(907) 555-0137` is accepted " +
      "as valid input and then silently matches no one. There is no error to catch — a " +
      "formatted number just looks like a person who is not there.",
    spec: ["#/paths/~1people/get"],
  },
  async ({ van, scope, comment }) => {
    comment("A person reachable at one phone number.");
    const vanId = await van.create({
      firstName: "Dashiell",
      lastName: `Dialtest-${scope}`,
      phones: [{ phoneNumber: "9075550137" }],
    });

    comment("Bare 10 digits: found.");
    const bare = await van.get("/people", {
      query: { lastName: `Dialtest-${scope}`, phoneNumber: "9075550137" },
    });

    expect(bare.status).toBe(200);
    expect(bare.body).toMatchObject({ count: 1, items: [{ vanId }] });

    comment("The same number formatted: accepted, no error — and no results.");
    const formatted = await van.get("/people", {
      query: { lastName: `Dialtest-${scope}`, phoneNumber: "(907) 555-0137" },
    });

    expect(formatted.status).toBe(200);
    expect(formatted.body).toMatchObject({ count: 0, items: [] });
  },
);
