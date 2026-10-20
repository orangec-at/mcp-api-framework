import { expect, test } from "bun:test";
import { z } from "zod";
import { defineApiTool } from "../src/index";
import { call, fixture, success } from "./harness";

test("bounds API response bytes before schema validation", async () => {
  // Given
  const { connect } = await fixture(success, { api: { maxResponseBytes: 8 } });
  const client = await connect();
  // When
  const result = await client.callTool(call);
  // Then
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    { type: "text", text: "API_RESPONSE_TOO_LARGE" },
  ]);
});

test("aborts a stalled response body within the API timeout", async () => {
  // Given: a real HTTP response that never finishes its JSON body.
  const { connect } = await fixture(
    () =>
      new Response(new ReadableStream(), {
        headers: { "content-type": "application/json" },
      }),
    { api: { timeoutMs: 30 } },
  );
  const client = await connect();
  // When
  const result = await client.callTool(call);
  // Then
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: "API_TIMEOUT" }]);
});

test("rejects malformed JSON returned by an API", async () => {
  // Given
  const { connect } = await fixture(
    () =>
      new Response("{", {
        headers: { "content-type": "application/json" },
      }),
  );
  const client = await connect();
  // When
  const result = await client.callTool(call);
  // Then
  expect(result.content).toEqual([
    { type: "text", text: "API_RESPONSE_INVALID_JSON" },
  ]);
});

const pathTool = defineApiTool({
  name: "test_get_path",
  description: "Test URL containment at the API boundary",
  input: z.object({ path: z.string() }),
  output: z.object({ summary: z.string(), datasetId: z.string() }),
  scopes: [],
  annotations: { readOnlyHint: true },
  request: (input) => ({ method: "GET", path: input.path }),
});

test.each([
  "https://external.invalid/steal",
  "../private",
  "/private",
  "//external.invalid/steal",
])("blocks API destinations outside the configured base: %s", async (path) => {
  // Given
  const { connect, requests } = await fixture(success, { tools: [pathTool] });
  const client = await connect();
  // When
  const result = await client.callTool({
    name: pathTool.name,
    arguments: { path },
  });
  // Then
  expect(result.content).toEqual([
    { type: "text", text: "API_PATH_OUTSIDE_BASE" },
  ]);
  expect(requests).toHaveLength(0);
});

test("does not follow API redirects or retry failed operations", async () => {
  // Given
  const { connect, requests } = await fixture(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "/api/redirected" },
      }),
  );
  const client = await connect();
  // When
  const result = await client.callTool(call);
  // Then
  expect(result.isError).toBe(true);
  expect(requests).toHaveLength(1);
});

test("redacts unexpected mapper exceptions from the MCP response", async () => {
  // Given
  const failing = defineApiTool({
    name: "test_mapper_error",
    description: "Test mapper exception isolation",
    input: z.object({}),
    output: z.object({}),
    scopes: [],
    annotations: {},
    request: () => {
      throw new TypeError("private-credential");
    },
  });
  const { connect, requests } = await fixture(success, { tools: [failing] });
  const client = await connect();
  // When
  const result = await client.callTool({ name: failing.name, arguments: {} });
  // Then
  expect(result.content).toEqual([
    { type: "text", text: "INTERNAL_TOOL_ERROR" },
  ]);
  expect(requests).toHaveLength(0);
});
