# MCP API Framework

기존 REST API를 에이전트용 MCP 도구로 노출하는 독립 TypeScript/Bun 프레임워크 MVP입니다. 현재 패키지는 로컬 사용용이며 npm에 배포되지 않았습니다.

요청 경로는 **에이전트 → MCP client → `/mcp` → 도구의 request mapper → 기존 API → 출력 schema → MCP 응답**입니다. 스킬은 에이전트에게 입력 수집과 호출 순서를 안내합니다. 스킬 설치와 MCP 연결 설정은 별개입니다.

## 빠르게 실행하기

필요 환경: Bun 1.3 이상, pnpm 10.34.5. 아래 토큰은 localhost 데모 전용 예시입니다.

```sh
cd mcp-api-framework
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

터미널 1 — 기존 API 역할의 데모 서버:

```sh
API_TOKEN=local-api-demo-token-00000001 bun examples/mock-api.ts
```

터미널 2 — MCP 서버:

```sh
MCP_TOKEN=local-mcp-demo-token-00000001 \
API_TOKEN=local-api-demo-token-00000001 \
API_BASE_URL=http://127.0.0.1:4000/api/ \
bun examples/server.ts
```

MCP URL은 `http://127.0.0.1:3000/mcp`, 인증 헤더는 `Authorization: Bearer local-mcp-demo-token-00000001`입니다. 호스트 클라이언트에 remote Streamable HTTP 연결을 추가한 뒤 `company_analyze_data`를 호출합니다.

```json
{
  "name": "company_analyze_data",
  "arguments": {
    "datasetId": "sales-2026",
    "question": "이번 달에 무엇이 달라졌어?"
  }
}
```

데모 API는 요청 수신 사실을 반환할 뿐 실제 데이터 분석을 수행하지 않습니다. 선택적으로 `examples/skill/`을 클라이언트의 skill root에 `company-analysis/` 이름으로 복사하면 예제 워크플로를 사용할 수 있습니다.

## API 하나를 도구로 연결하기

[analysis-tool.ts](examples/analysis-tool.ts)가 완전한 정의 예제입니다.

```ts
import { z } from "zod";
import { defineApiTool } from "./src/index";

const getProject = defineApiTool({
  name: "company_get_project",
  description: "Get a project visible to the authenticated user.",
  input: z.object({ projectId: z.string().uuid() }),
  output: z.object({ id: z.string(), name: z.string() }),
  scopes: ["projects:read"],
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  request: (input) => ({
    method: "GET",
    path: `projects/${encodeURIComponent(input.projectId)}`,
  }),
});
```

`createMcpApp({ tools: [getProject], ... })`에 등록하면 SDK가 `tools/list`와 `tools/call`을 제공합니다. 입력은 strict Zod object로 검증하고, 출력은 지정 schema로 파싱해 `content`와 `structuredContent`에 반환합니다. schema가 허용하지 않는 추가 출력 필드는 기본 Zod 동작에 따라 제거됩니다. 입력/출력 schema에는 JSON Schema로 표현 가능한 타입을 사용하세요.

request mapper는 다음을 지원합니다.

- `method`: GET / POST / PUT / PATCH / DELETE
- `path`: base URL에 대한 상대 경로. `.../api/` base에서는 `projects/...`처럼 선행 `/` 없이 사용
- `query`: string / number / boolean 값의 query parameters
- `body`: JSON request body

원격 API의 응답 모양이 다르면 해당 모양의 output schema를 정의하세요. 현재 버전에는 임의 output mapper, OpenAPI 자동 변환, job polling engine이 없습니다.

## 인증과 권한

`createMcpApp`의 필수 `authenticate(token)` 콜백은 검증된 `{ subject, scopes }` 또는 `null`을 반환합니다. 이 콜백을 실제 서비스의 토큰 검증·만료·audience·tenant 확인 로직에 연결하세요. 예제는 고정 데모 토큰과 `demo-user` 한 명만 지원합니다.

도구별 필수 `scopes`가 충족되지 않으면 SDK 도구를 disable해 목록과 직접 호출 모두 차단합니다. `scopes: []`는 인증된 모든 사용자에게 공개한다는 뜻입니다. 객체/테넌트 단위 접근 권한은 실제 API에서 계속 검사해야 합니다.

`api.headers(context)`는 내부 API용 인증을 별도로 구성합니다. MCP Bearer를 자동으로 내부 API에 전달하지 않습니다. 사용자 정보가 필요하면 검증된 `context.principal`에서 서버가 생성한 필드나 내부 인증 헤더로 전달하세요. 클라이언트가 입력한 사용자 ID만으로 권한을 판단하면 안 됩니다.

`allowedHosts`는 배포 서버의 hostname allowlist입니다. 예제는 loopback에만 bind합니다. Origin 헤더가 있는 요청은 `allowedOrigins`에 명시된 값만 허용합니다. 이 버전은 브라우저용 CORS preflight 처리나 OAuth discovery/login 서버를 제공하지 않습니다. 이미 credential을 가진 native MCP client를 대상으로 합니다. 원격 배포 시 HTTPS와 공개 hostname을 설정하세요.

## 실행 정책과 오류

- 공식 SDK의 **stateless Streamable HTTP / JSON 응답**을 사용합니다. 요청마다 MCP server/transport를 생성해 사용자 상태를 분리합니다.
- `/mcp`의 POST를 지원하며 GET/DELETE는 405입니다. 세션 저장·SSE push·resumability는 제공하지 않습니다.
- MCP request body 제한은 1 MiB입니다.
- API 기본 timeout은 10초, 응답 제한은 1 MiB이며 `api.timeoutMs`, `api.maxResponseBytes`로 바꿀 수 있습니다. 응답 body가 멈춘 경우에도 timeout을 적용합니다.
- API 요청은 base URL의 origin과 path prefix 내부로 제한하고 redirect를 따르지 않습니다. 자동 retry도 하지 않아 쓰기 작업 중복 실행을 피합니다.
- API의 인증·서버 오류 본문은 MCP 결과에 노출하지 않습니다. 실패는 `isError: true`와 `API_HTTP_503`, `API_TIMEOUT`, `API_RESPONSE_SCHEMA_MISMATCH` 등의 코드로 반환합니다.
- 기본 request ID를 생성해 API의 `x-request-id`로 전달합니다. payload/credential 로깅은 추가하지 않았습니다. 운영용 rate limit, audit/metrics, OAuth는 배포 환경에서 붙일 확장 영역입니다.

## 구성 파일

| 파일 | 책임 |
|---|---|
| `src/tool.ts` | typed API 도구 정의와 SDK 등록 |
| `src/api.ts` | HTTP API 호출·timeout·응답 크기·오류 경계 |
| `src/app.ts` | 인증·host/origin 검사·MCP 요청 수명 |
| `examples/analysis-tool.ts` | API 도구 정의 예제 |
| `examples/server.ts` | 실제 사용자가 구성할 MCP 서버 |
| `examples/mock-api.ts` | 분석을 수행하지 않는 로컬 데모 API |
| `examples/skill/SKILL.md` | 에이전트의 호출 절차 안내 |
| `test/` | 실제 TCP/HTTP + 공식 MCP client 왕복 검증 |

`pnpm check`는 Biome과 strict TypeScript, `pnpm test`는 Bun 테스트, `pnpm build`는 Bun용 `dist/index.js`를 생성합니다. 테스트는 ephemeral port의 HTTP API를 사용하며 외부 서비스나 유료 API를 호출하지 않습니다.

SDK 1.32.1의 client transport 타입에 `exactOptionalPropertyTypes` 불일치가 있어 테스트에서 stateless transport facade를 사용합니다. 실제 HTTP 교환은 공식 `StreamableHTTPClientTransport`가 수행합니다. 프레임워크의 strict 옵션은 끄지 않았습니다.

근거 문서: [공식 MCP SDK 서버 가이드](https://ts.sdk.modelcontextprotocol.io/server). 실제 회사 API와 credential은 아직 연결하지 않았으며, 먼저 이 예제로 연결 경로를 확인한 뒤 API 계약에 맞게 도구를 추가하면 됩니다.
