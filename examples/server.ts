import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createMcpApp } from "../src/index";
import { analyzeData } from "./analysis-tool";

const env = z
  .object({
    MCP_TOKEN: z.string().min(24),
    API_TOKEN: z.string().min(24),
    API_BASE_URL: z.url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  })
  .parse(process.env);

const app = createMcpApp({
  name: "company-mcp-server",
  version: "0.1.0",
  tools: [analyzeData],
  allowedHosts: ["127.0.0.1", "localhost"],
  authenticate: async (token) => {
    const actual = Buffer.from(token);
    const expected = Buffer.from(env.MCP_TOKEN);
    return actual.length === expected.length &&
      timingSafeEqual(actual, expected)
      ? { subject: "demo-user", scopes: ["analysis:read"] }
      : null;
  },
  api: {
    baseUrl: env.API_BASE_URL,
    headers: () => ({ Authorization: `Bearer ${env.API_TOKEN}` }),
  },
});

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: env.PORT,
  fetch: app.fetch,
});
process.once("SIGINT", () => server.stop(true));
process.once("SIGTERM", () => server.stop(true));
