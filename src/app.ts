import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import {
  type ApiConfig,
  ApiFailure,
  createApiClient,
  type Principal,
} from "./api";
import type { ApiTool } from "./tool";

export type FrameworkConfig = {
  readonly name: string;
  readonly version: string;
  readonly tools: readonly ApiTool[];
  readonly api: ApiConfig;
  readonly authenticate: (token: string) => Promise<Principal | null>;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins?: readonly string[];
};

export function createMcpApp(config: FrameworkConfig) {
  const names = new Set(config.tools.map((tool) => tool.name));
  if (names.size !== config.tools.length)
    throw new ApiFailure("DUPLICATE_TOOL_NAME");
  const api = createApiClient(config.api);
  const app = new Hono();
  app.all("/mcp", async (c) => {
    if (!config.allowedHosts.includes(new URL(c.req.url).hostname)) {
      return c.json({ error: "invalid_host" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin && !config.allowedOrigins?.includes(origin)) {
      return c.json({ error: "invalid_origin" }, 403);
    }
    const match = /^Bearer (\S+)$/i.exec(c.req.header("authorization") ?? "");
    const token = match?.[1];
    const principal = token ? await config.authenticate(token) : null;
    if (!principal) {
      c.header("WWW-Authenticate", 'Bearer realm="mcp"');
      return c.json({ error: "invalid_token" }, 401);
    }
    if (c.req.method !== "POST") {
      c.header("Allow", "POST");
      return c.json({ error: "method_not_allowed" }, 405);
    }
    const server = new McpServer({
      name: config.name,
      version: config.version,
    });
    const context = {
      principal,
      requestId: crypto.randomUUID(),
      signal: c.req.raw.signal,
    };
    for (const tool of config.tools) {
      tool.register(server, { api, context });
    }
    // A fresh stateless server per request isolates identities and request IDs.
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 1_048_576,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  // no-excuse-ok: catch — HTTP boundary must not expose callback errors or credentials.
  app.onError((_error, c) => c.json({ error: "internal_error" }, 500));
  return app;
}
