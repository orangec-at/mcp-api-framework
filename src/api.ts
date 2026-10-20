import ky, { HTTPError, TimeoutError } from "ky";
import { z } from "zod";

export type Principal = {
  readonly subject: string;
  readonly scopes: readonly string[];
};

export type CallContext = {
  readonly principal: Principal;
  readonly requestId: string;
  readonly signal: AbortSignal;
};

export type ApiRequest = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean>>;
  readonly body?: z.infer<ReturnType<typeof z.json>>;
};

export type ApiConfig = {
  readonly baseUrl: string;
  readonly headers: (
    context: CallContext,
  ) => HeadersInit | Promise<HeadersInit>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
};

export class ApiFailure extends Error {
  readonly name = "ApiFailure";
  constructor(readonly code: string) {
    super(code);
  }
}

export function createApiClient(config: ApiConfig) {
  const base = new URL(config.baseUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  ) {
    throw new ApiFailure("INVALID_API_BASE_URL");
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const maxBytes = z
    .number()
    .int()
    .positive()
    .parse(config.maxResponseBytes ?? 1_048_576);
  const timeout = z
    .number()
    .int()
    .positive()
    .parse(config.timeoutMs ?? 10_000);

  return async (
    request: ApiRequest,
    context: CallContext,
  ): Promise<unknown> => {
    const url = new URL(request.path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new ApiFailure("API_PATH_OUTSIDE_BASE");
    }
    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const headers = new Headers(await config.headers(context));
    headers.set("accept", "application/json");
    headers.set("x-request-id", context.requestId);
    try {
      const response = await ky(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { json: request.body }),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(timeout)]),
        timeout,
        retry: 0,
        redirect: "error",
      });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        await response.body?.cancel();
        throw new ApiFailure("API_RESPONSE_NOT_JSON");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiFailure("API_RESPONSE_EMPTY");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel();
            throw new ApiFailure("API_RESPONSE_TOO_LARGE");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const buffer = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      // JSON is untrusted here; the tool's output schema parses it immediately.
      return JSON.parse(new TextDecoder().decode(buffer));
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      if (error instanceof HTTPError) {
        await error.response.body?.cancel();
        throw new ApiFailure(`API_HTTP_${error.response.status}`);
      }
      if (error instanceof TimeoutError) throw new ApiFailure("API_TIMEOUT");
      if (error instanceof SyntaxError)
        throw new ApiFailure("API_RESPONSE_INVALID_JSON");
      if (error instanceof DOMException) {
        throw new ApiFailure(
          error.name === "TimeoutError" ? "API_TIMEOUT" : "API_ABORTED",
        );
      }
      if (error instanceof TypeError) throw new ApiFailure("API_NETWORK_ERROR");
      throw error;
    }
  };
}
