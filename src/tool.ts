import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ApiFailure,
  type ApiRequest,
  type CallContext,
  type createApiClient,
} from "./api";

export type ApiTool = {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly register: (server: McpServer, runtime: ToolRuntime) => void;
};

export type ToolRuntime = {
  readonly api: ReturnType<typeof createApiClient>;
  readonly context: CallContext;
};

export type ApiToolDefinition<
  Input extends z.ZodRawShape,
  Output extends z.ZodRawShape,
> = {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodObject<Input>;
  readonly output: z.ZodObject<Output>;
  readonly scopes: readonly string[];
  readonly annotations: ToolAnnotations;
  readonly request: (
    input: z.output<z.ZodObject<Input>>,
    context: CallContext,
  ) => ApiRequest;
};

export function defineApiTool<
  Input extends z.ZodRawShape,
  Output extends z.ZodRawShape,
>(definition: ApiToolDefinition<Input, Output>): ApiTool {
  const name = z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .parse(definition.name);
  return {
    name,
    scopes: [...definition.scopes],
    register(server, runtime) {
      const inputSchema = definition.input.strict();
      const registered = server.registerTool<
        typeof definition.output,
        typeof inputSchema
      >(
        name,
        {
          title: name,
          description: definition.description,
          inputSchema,
          outputSchema: definition.output,
          annotations: definition.annotations,
        },
        async (input, extra) => {
          try {
            const context = {
              ...runtime.context,
              signal: AbortSignal.any([runtime.context.signal, extra.signal]),
            };
            const raw = await runtime.api(
              definition.request(input, context),
              context,
            );
            const parsed = definition.output.safeParse(raw);
            if (!parsed.success)
              throw new ApiFailure("API_RESPONSE_SCHEMA_MISMATCH");
            return {
              content: [{ type: "text", text: JSON.stringify(parsed.data) }],
              structuredContent: parsed.data,
            };
          } catch (error) {
            if (error instanceof ApiFailure) {
              return {
                isError: true,
                content: [{ type: "text", text: error.code }],
              };
            }
            // no-excuse-ok: catch — the SDK otherwise exposes arbitrary handler error messages.
            return {
              isError: true,
              content: [{ type: "text", text: "INTERNAL_TOOL_ERROR" }],
            };
          }
        },
      );
      if (
        !definition.scopes.every((scope) =>
          runtime.context.principal.scopes.includes(scope),
        )
      ) {
        registered.disable();
      }
    },
  };
}
