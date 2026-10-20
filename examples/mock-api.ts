import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";

const { API_TOKEN: token } = z
  .object({ API_TOKEN: z.string().min(24) })
  .parse(process.env);
const input = z.object({
  datasetId: z.string(),
  question: z.string(),
  requestedBy: z.string(),
});
const app = new Hono();
app.post("/api/analysis", async (c) => {
  const actual = Buffer.from(c.req.header("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const parsed = input.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  return c.json({
    datasetId: parsed.data.datasetId,
    summary: `Demo only: received question for ${parsed.data.datasetId} from ${parsed.data.requestedBy}. No analysis was performed.`,
  });
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4000,
  fetch: app.fetch,
});
process.once("SIGINT", () => server.stop(true));
process.once("SIGTERM", () => server.stop(true));
