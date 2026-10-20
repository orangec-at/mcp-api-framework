import { expect, test } from "bun:test";
import { call, fixture, success } from "./harness";

test("rejects an unauthenticated HTTP request before forwarding data", async () => {
  // Given
  const { url, requests } = await fixture(success);
  // When
  const response = await fetch(url, { method: "POST" });
  // Then
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("Bearer");
  expect(requests).toHaveLength(0);
});

test("rejects untrusted browser origins even with a valid token", async () => {
  // Given
  const { url } = await fixture(success);
  // When
  const response = await fetch(url, {
    headers: { authorization: "Bearer alice", origin: "https://evil.example" },
  });
  // Then
  expect(response.status).toBe(403);
});

test("hides tools when the principal lacks the required scope", async () => {
  // Given
  const { connect } = await fixture(success, {
    authenticate: async () => ({ subject: "viewer", scopes: [] }),
  });
  const client = await connect();
  // When
  const result = await client.listTools();
  // Then
  expect(result.tools).toEqual([]);
});

test("blocks direct calls to tools outside the principal scopes", async () => {
  // Given
  const { connect, requests } = await fixture(success, {
    authenticate: async () => ({ subject: "viewer", scopes: [] }),
  });
  const client = await connect();
  // When
  const result = await client.callTool(call);
  // Then
  expect(result.isError).toBe(true);
  expect(requests).toHaveLength(0);
});

test("sanitizes upstream HTTP errors instead of returning response secrets", async () => {
  // Given
  const { connect } = await fixture(
    () => new Response("database-password", { status: 503 }),
  );
  const client = await connect();
  // When
  const result = await client.callTool(call);
  // Then
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: "API_HTTP_503" }]);
});

test("rejects API responses that violate the output schema", async () => {
  // Given
  const { connect } = await fixture(() =>
    Response.json({ secret: "private-data" }),
  );
  const client = await connect();
  // When
  const result = await client.callTool(call);
  // Then
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    { type: "text", text: "API_RESPONSE_SCHEMA_MISMATCH" },
  ]);
});
