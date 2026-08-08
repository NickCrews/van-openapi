import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";
import { firstError } from "./harness/errors.js";

interface NoteItem {
  noteId: number;
  text: string | null;
  isPinned: boolean;
  isViewRestricted: boolean;
  contactHistory: unknown;
  category: unknown;
}

/** Narrows the `{items, count}` page of notes out of the response union. */
function notesPage(body: unknown): { items: NoteItem[]; count: number } {
  return body as { items: NoteItem[]; count: number };
}

behavior(
  {
    id: "note-create-is-silent",
    title: "Creating a note returns nothing — the id has to be read back",
    claim:
      "Success is a bare 204: no body, no Location header, no noteId. The only way to learn " +
      "the new id is GET /people/{vanId}/notes. The read-back also shows `isPinned` was " +
      "accepted and ignored, and that an uncategorized note reads as the " +
      "`{noteCategoryId: 0, name: null}` stub.",
    spec: ["#/paths/~1people~1{vanId}~1notes/post", "#/paths/~1people~1{vanId}~1notes/get"],
  },
  async ({ van, scope, comment }) => {
    const vanId = await van.create({ firstName: "Lucinda", lastName: `Farrow-${scope}` });

    comment("Create a note, asking for a pin the API will ignore.");
    const created = await van.post(
      "/people/{vanId}/notes",
      { text: "Spoke at the door; wants a yard sign.", isViewRestricted: false, isPinned: true },
      { params: { vanId } },
    );

    expect(created.status).toBe(204);
    expect(created.body).toBeUndefined();
    expect(created.headers.get("location")).toBeNull();

    comment("Reading the list back is the only way to learn the noteId.");
    const list = await van.get("/people/{vanId}/notes", { params: { vanId } });

    expect(list.status).toBe(200);
    const { items, count } = notesPage(list.body);
    expect(count).toBe(1);
    van.volatile(items[0].noteId);
    expect(items[0]).toMatchObject({
      text: "Spoke at the door; wants a yard sign.",
      isPinned: false,
      isViewRestricted: false,
      contactHistory: null,
      category: { noteCategoryId: 0, name: null },
    });
  },
);

behavior(
  {
    id: "restricted-notes-vanish-from-the-api",
    title: "A view-restricted note can be written but never read back",
    claim:
      "`isViewRestricted: true` is accepted with the same 204 as any other note, and the note " +
      "is then withheld from API keys entirely: absent from items and not counted in count, " +
      "so every note the API ever shows has the flag false.",
    spec: ["#/paths/~1people~1{vanId}~1notes/post", "#/paths/~1people~1{vanId}~1notes/get"],
  },
  async ({ van, scope, comment }) => {
    const vanId = await van.create({ firstName: "Barnaby", lastName: `Quill-${scope}` });

    comment("One ordinary note, one restricted. Both are accepted identically.");
    const ordinary = await van.post(
      "/people/{vanId}/notes",
      { text: "Volunteered at the phone bank.", isViewRestricted: false },
      { params: { vanId } },
    );
    const restricted = await van.post(
      "/people/{vanId}/notes",
      { text: "Do not publish this.", isViewRestricted: true },
      { params: { vanId } },
    );

    expect(ordinary.status).toBe(204);
    expect(restricted.status).toBe(204);

    comment("The list has one note. The restricted one is not hidden — it is simply not there.");
    const list = await van.get("/people/{vanId}/notes", { params: { vanId } });

    const { items, count } = notesPage(list.body);
    expect(count).toBe(1);
    van.volatile(items[0].noteId);
    expect(items[0]).toMatchObject({
      text: "Volunteered at the phone bank.",
      isViewRestricted: false,
    });
  },
);

behavior(
  {
    id: "notes-list-tuning-parameters-are-inert",
    title: "$orderby and $expand are validated, then change nothing",
    claim:
      "`$orderby=CreatedDate desc` and `$expand=noteDetails` both pass validation and both " +
      "return a body identical to the plain request — the sort never reorders and the expand " +
      "never populates `contactHistory`. Values outside the accepted sets are refused with " +
      "INVALID_PARAMETER, so the parameters are checked strictly and then ignored.",
    spec: ["#/paths/~1people~1{vanId}~1notes/get"],
  },
  async ({ van, scope, comment }) => {
    comment("A person with one note to list.");
    const vanId = await van.create({ firstName: "Prudence", lastName: `Ashby-${scope}` });
    await van.setup(() =>
      van.post(
        "/people/{vanId}/notes",
        { text: "Interested in canvassing.", isViewRestricted: false },
        { params: { vanId } },
      ),
    );

    const plain = await van.get("/people/{vanId}/notes", { params: { vanId } });
    expect(plain.status).toBe(200);
    van.volatile(notesPage(plain.body).items[0].noteId);

    comment("Descending sort: accepted, and the body comes back identical to the plain call.");
    const sorted = await van.get("/people/{vanId}/notes", {
      params: { vanId },
      query: { $orderby: "CreatedDate desc" },
    });
    expect(sorted.body).toEqual(plain.body);

    comment("The one accepted $expand value: also identical, contactHistory still null.");
    const expanded = await van.get("/people/{vanId}/notes", {
      params: { vanId },
      query: { $expand: "noteDetails" },
    });
    expect(expanded.body).toEqual(plain.body);

    comment("Anything outside the accepted sets is refused, not ignored.");
    const badOrder = await van.get("/people/{vanId}/notes", {
      params: { vanId },
      query: { $orderby: "Text" },
    });
    expect(badOrder.status).toBe(400);
    expect(firstError(badOrder.body).code).toBe("INVALID_PARAMETER");

    const badExpand = await van.get("/people/{vanId}/notes", {
      params: { vanId },
      query: { $expand: "contactHistory" },
    });
    expect(badExpand.status).toBe(400);
    expect(firstError(badExpand.body).code).toBe("INVALID_PARAMETER");
  },
);

behavior(
  {
    id: "note-update-restricted-for-this-key",
    title: "Updating a note is refused for this key, before the note is looked up",
    claim:
      "Every request from the research key is refused with 403 FORBIDDEN whether or not the " +
      "note exists, so the success path documented for this operation comes from the official " +
      "docs alone.",
    spec: ["#/paths/~1people~1{vanId}~1notes~1{noteId}/put"],
    // Key-specific, not a property of the API for every caller — assert it, don't publish it.
    render: false,
  },
  async ({ van, scope, comment }) => {
    comment("A real person with a real note, so the 403 cannot be blamed on a missing target.");
    const vanId = await van.create({ firstName: "Ezra", lastName: `Thistlewood-${scope}` });
    const noteId = await van.setup(async () => {
      await van.post(
        "/people/{vanId}/notes",
        { text: "Original text.", isViewRestricted: false },
        { params: { vanId } },
      );
      const list = await van.get("/people/{vanId}/notes", { params: { vanId } });
      return van.volatile(notesPage(list.body).items[0].noteId);
    });

    const real = await van.put(
      "/people/{vanId}/notes/{noteId}",
      { text: "Updated text." },
      { params: { vanId, noteId } },
    );

    expect(real.status).toBe(403);
    expect(firstError(real.body).text).toBe("Access to this action is restricted");

    comment("A noteId that cannot exist is refused identically — the check runs first.");
    const imaginary = await van.put(
      "/people/{vanId}/notes/{noteId}",
      { text: "Updated text." },
      { params: { vanId, noteId: 2_147_483_646 } },
    );

    expect(imaginary.status).toBe(403);
    expect(firstError(imaginary.body).text).toBe("Access to this action is restricted");
  },
);
