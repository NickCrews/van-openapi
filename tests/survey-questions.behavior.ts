import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";
import { firstError } from "./harness/errors.js";

behavior(
  {
    id: "survey-questions-list-is-an-empty-page-here",
    title: "The list arrives in the pagination envelope — empty in this committee",
    claim:
      "Survey questions come back in the standard `{items, count, nextPageLink}` envelope. " +
      "The sandbox committee has no survey questions (and none can be created — every `type` " +
      "is rejected), so the empty page is the only response this database can produce.",
    spec: ["#/paths/~1surveyQuestions/get"],
  },
  async ({ van, comment }) => {
    comment("No filters: the default is Active questions, of which this committee has none.");
    const res = await van.get("/surveyQuestions");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], count: 0 });
  },
);

behavior(
  {
    id: "survey-questions-top-bounds-come-from-the-api",
    title: "$top is bounded 1–200, and the API's own hint says so",
    claim:
      "A `$top` outside 1–200 is refused with INVALID_PARAMETER, and the refusal states the " +
      "real bounds — maximum 200 in the text, default 50 in the hint — contradicting the " +
      "official docs' claimed default of 40.",
    spec: ["#/paths/~1surveyQuestions/get"],
  },
  async ({ van, comment }) => {
    comment("One over the maximum. The refusal itself is where the true bounds come from.");
    const over = await van.get("/surveyQuestions", { query: { $top: "201" } });

    expect(over.status).toBe(400);
    expect(firstError(over.body).code).toBe("INVALID_PARAMETER");
    expect(firstError(over.body).text).toContain("maximum result size for this end point: 200");
    expect(firstError(over.body).hint).toContain("a default top size of 50 will be used");

    comment("Zero is out of range on the other side.");
    const zero = await van.get("/surveyQuestions", { query: { $top: "0" } });

    expect(zero.status).toBe(400);
    expect(firstError(zero.body).code).toBe("INVALID_PARAMETER");
  },
);
