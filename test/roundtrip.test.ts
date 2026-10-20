import { expect, test } from "bun:test";
import { call, fixture, success } from "./harness";

test("lists the API tool and schema when an authorized MCP client connects", async () => {
  // Given
  const { connect } = await fixture(success);
  const client = await connect();
  // When
  const result = await client.listTools();
  // Then
  expect(result.tools.map((tool) => tool.name)).toEqual([call.name]);
  expect(result.tools[0]?.inputSchema.required).toContain("datasetId");
  expect(result.tools[0]?.outputSchema).toBeDefined();
});

test("returns structured API data when a tool is called over real HTTP", async () => {
  // Given
  const { connect, requests } = await fixture(success);
  const client = await connect();
  // When
  const result = await client.callTool(call);
  // Then
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({
    summary: "Sales increased",
    datasetId: "sales-2026",
  });
  expect(requests).toHaveLength(1);
  const request = requests[0];
  expect(request?.method).toBe("POST");
  expect(new URL(request?.url ?? "http://invalid").pathname).toBe(
    "/api/analysis",
  );
  expect(request?.headers.get("authorization")).toBe("Bearer internal-secret");
  expect(request?.headers.get("x-request-id")).toBeTruthy();
  expect(await request?.json()).toEqual({
    ...call.arguments,
    requestedBy: "alice",
  });
});

test("rejects invalid arguments before calling the backend", async () => {
  // Given
  const { connect, requests } = await fixture(success);
  const client = await connect();
  // When
  const result = await client.callTool({
    ...call,
    arguments: { datasetId: "", question: "x" },
  });
  // Then
  expect(result.isError).toBe(true);
  expect(requests).toHaveLength(0);
});

test("rejects identity injection through extra tool arguments", async () => {
  // Given
  const { connect, requests } = await fixture(success);
  const client = await connect();
  // When
  const result = await client.callTool({
    ...call,
    arguments: { ...call.arguments, requestedBy: "admin" },
  });
  // Then
  expect(result.isError).toBe(true);
  expect(requests).toHaveLength(0);
});

test("isolates principals when two clients call concurrently", async () => {
  // Given
  const { connect, requests } = await fixture(success);
  const alice = await connect("alice");
  const bob = await connect("bob");
  // When
  await Promise.all([alice.callTool(call), bob.callTool(call)]);
  // Then
  const subjects = await Promise.all(
    requests.map(async (request) => {
      const body: unknown = await request.json();
      return body;
    }),
  );
  expect(subjects).toContainEqual({ ...call.arguments, requestedBy: "alice" });
  expect(subjects).toContainEqual({ ...call.arguments, requestedBy: "bob" });
  expect(
    new Set(requests.map((request) => request.headers.get("x-request-id")))
      .size,
  ).toBe(2);
});
