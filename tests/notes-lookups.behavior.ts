import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";
import { firstError } from "./harness/errors.js";

behavior(
  {
    id: "note-categories-are-a-bare-array",
    title: "Note categories come back as a bare array that ignores paging",
    claim:
      "The list is a bare JSON array, not the pagination envelope, and query parameters like " +
      "`$top` are ignored rather than applied or rejected. The sandbox committee has no " +
      "categories opted in, so the empty array is all it can answer.",
    spec: ["#/paths/~1notes~1categories/get"],
  },
  async ({ van, comment }) => {
    comment("No envelope: the body itself is the array.");
    const plain = await van.get("/notes/categories");

    expect(plain.status).toBe(200);
    expect(Array.isArray(plain.body)).toBe(true);
    expect(plain.body).toEqual([]);

    comment("Paging parameters are accepted and ignored — the response is identical.");
    const paged = await van.request({
      method: "GET",
      path: "/notes/categories",
      query: { $top: "1", $skip: "5" },
    });

    expect(paged.status).toBe(200);
    expect(paged.body).toEqual(plain.body);
  },
);

behavior(
  {
    id: "note-category-404s-come-in-two-shapes",
    title: "An unknown category 404s with the envelope; a non-int32 id gets HTML",
    claim:
      "Only ids in the int32 range route to the handler, which answers the standard 404 envelope " +
      "for a category that does not exist. An id above 2147483647 matches no route at all and " +
      "gets IIS's HTML 404 page instead — a different content type, not just a different body.",
    spec: ["#/paths/~1notes~1categories~1{noteCategoryId}/get"],
  },
  async ({ van, comment }) => {
    comment("A well-formed id that names no category — this committee has none at all.");
    const missing = await van.get("/notes/categories/{noteCategoryId}", {
      params: { noteCategoryId: 10 },
    });

    expect(missing.status).toBe(404);
    expect(firstError(missing.body).code).toBe("NOT_FOUND");

    comment("One past int32: the route no longer matches, and IIS answers with an HTML page.");
    const unroutable = await van.request({
      method: "GET",
      path: "/notes/categories/{noteCategoryId}",
      params: { noteCategoryId: 2_147_483_648 },
    });

    expect(unroutable.status).toBe(404);
    expect(unroutable.headers.get("content-type")).toContain("text/html");
    expect(typeof unroutable.body).toBe("string");
  },
);

behavior(
  {
    id: "note-category-types-restricted-for-this-key",
    title: "Listing category types is refused for this key",
    claim:
      "Every request from the research key is refused with 403 FORBIDDEN before anything else " +
      "happens, so the live vocabulary of assignableTypes has never been observed — the " +
      "documented 200 comes from the official docs alone.",
    spec: ["#/paths/~1notes~1categoryTypes/get"],
    // Key-specific, not a property of the API for every caller — assert it, don't publish it.
    render: false,
  },
  async ({ van }) => {
    const res = await van.get("/notes/categoryTypes");

    expect(res.status).toBe(403);
    expect(firstError(res.body).code).toBe("FORBIDDEN");
    expect(firstError(res.body).text).toBe("Access to this action is restricted");
  },
);
