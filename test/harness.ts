import { afterEach } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { analyzeData } from "../examples/analysis-tool";
import {
  type ApiConfig,
  createMcpApp,
  type FrameworkConfig,
} from "../src/index";

// Each fixture owns ephemeral ports; teardown also closes failed test connections.
const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

export async function fixture(
  handler: (request: Request) => Response | Promise<Response>,
  overrides: Omit<Partial<FrameworkConfig>, "api"> & {
    readonly api?: Partial<ApiConfig>;
  } = {},
) {
  const requests: Request[] = [];
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const saved = request.clone();
      await request.arrayBuffer();
      requests.push(saved);
      return handler(saved.clone());
    },
  });
  cleanups.push(() => backend.stop(true));
  const app = createMcpApp({
    name: "test-mcp-server",
    version: "1.0.0",
    tools: [analyzeData],
    allowedHosts: ["127.0.0.1"],
    authenticate: async (token) =>
      token === "alice" || token === "bob"
        ? { subject: token, scopes: ["analysis:read"] }
        : null,
    ...overrides,
    api: {
      baseUrl: `${backend.url}api/`,
      headers: () => ({ authorization: "Bearer internal-secret" }),
      ...overrides.api,
    },
  });
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  cleanups.push(() => http.stop(true));
  const url = new URL("mcp", http.url);
  async function connect(token = "alice") {
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    cleanups.push(() => client.close());
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    // SDK 1.32's sessionId getter conflicts with its own Transport type under
    // exactOptionalPropertyTypes. This stateless facade omits that optional field.
    const wire: Transport = {
      start: () => transport.start(),
      close: () => transport.close(),
      send: (message, options) => transport.send(message, options),
      setProtocolVersion: (version) => transport.setProtocolVersion(version),
    };
    transport.onmessage = (message) => wire.onmessage?.(message);
    transport.onerror = (error) => wire.onerror?.(error);
    transport.onclose = () => wire.onclose?.();
    await client.connect(wire);
    return client;
  }
  return { connect, url, requests };
}

export const call = {
  name: "company_analyze_data",
  arguments: { datasetId: "sales-2026", question: "What changed?" },
} as const;

export const success = () =>
  Response.json({ summary: "Sales increased", datasetId: "sales-2026" });
