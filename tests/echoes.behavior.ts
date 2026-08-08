import { expect } from "vitest";
import { behavior } from "./harness/behavior.js";

behavior(
  {
    id: "echo-round-trips-the-message",
    title: "The message comes back verbatim, stamped with server time",
    claim:
      "The posted message is echoed back exactly, alongside `dateSent`, the server's own clock. " +
      "Every request field is optional — an empty body is a valid connectivity check and comes " +
      "back with `message: null`.",
    spec: ["#/paths/~1echoes/post"],
  },
  async ({ van, comment }) => {
    comment("The cheapest possible proof that the base URL, auth header and mode are right.");
    const echoed = await van.post("/echoes", { message: "Anybody out there?" });

    expect(echoed.status).toBe(200);
    expect(echoed.body).toMatchObject({ message: "Anybody out there?" });
    expect((echoed.body as { dateSent: string }).dateSent).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    comment("No field is required. An empty body echoes back a null message.");
    const empty = await van.post("/echoes", {});

    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ message: null });
  },
);
