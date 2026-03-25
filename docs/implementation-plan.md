# 구현 계획

## 기술 스택

- **Runtime**: Bun (TypeScript)
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **HTTP 서버**: Bun.serve (내장)

---

## 디렉토리 구조

```
openclaw-claude-code-comm-mcp/
├── package.json
├── bun.lockb
├── .env.template
├── .gitignore
├── src/
│   └── index.ts          -- 메인 MCP 서버
└── docs/
    ├── llms.md
    └── implementation-plan.md
```

---

## 구현 단계

### Phase 1: 기본 MCP Channel Server

**파일**: `src/index.ts`

1. MCP Server 생성
   - `capabilities.experimental['claude/channel']` 선언
   - `capabilities.experimental['claude/channel/permission']` 선언
   - `capabilities.tools` 선언
   - `instructions` 설정

2. Reply Tool 등록
   - `ListToolsRequestSchema` 핸들러
   - `CallToolRequestSchema` 핸들러
   - reply 호출 시 → `/hooks/wake` POST

3. Permission Request 핸들러
   - `notifications/claude/channel/permission_request` 수신
   - `/hooks/wake` POST로 OpenClaw에 전달
   - pending requests Map에 저장 (request_id → resolve 함수)

4. Verdict HTTP 서버 (Bun.serve)
   - `POST /verdict` 수신
   - `{request_id, behavior}` 파싱
   - pending Map에서 해당 request_id 찾아 resolve
   - `notifications/claude/channel/permission` 전달

5. stdio transport 연결

---

### Phase 2: OpenClaw 설정

`openclaw.json`에 추가:
```json5
{
  hooks: {
    enabled: true,
    token: "<생성된 토큰>",
  }
}
```

---

### Phase 3: Claude Code 설정

프로젝트별 `.mcp.json` 또는 `~/.claude.json`:
```json
{
  "mcpServers": {
    "openclaw-bridge": {
      "command": "bun",
      "args": ["/home/jaemin/openclaw-claude-code-comm-mcp/src/index.ts"]
    }
  }
}
```

Claude Code 실행:
```bash
claude --dangerously-load-development-channels server:openclaw-bridge
```

---

### Phase 4: OpenClaw Skill 추가

`browser-automation/SKILL.md`처럼 `claude-code-comm` skill 추가:
- verdict 전달 방법 (POST to `http://127.0.0.1:8790/verdict`)
- permission request 판단 기준 (안전한 명령 자동 승인 등)

---

## 핵심 코드 스케치

```typescript
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const OPENCLAW_HOOK_URL = process.env.OPENCLAW_HOOK_URL ?? 'http://127.0.0.1:18789/hooks'
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN ?? ''
const VERDICT_PORT = parseInt(process.env.VERDICT_PORT ?? '8790')

// Pending permission requests: request_id → resolve fn
const pending = new Map<string, (behavior: 'allow' | 'deny') => void>()

async function wakeOpenClaw(text: string) {
  await fetch(`${OPENCLAW_HOOK_URL}/wake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENCLAW_HOOK_TOKEN}`,
    },
    body: JSON.stringify({ text, mode: 'now' }),
  })
}

const mcp = new Server(
  { name: 'openclaw-bridge', version: '0.1.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    instructions:
      'Messages arrive as <channel source="openclaw-bridge" ...>. ' +
      'Use the reply tool to send messages back to the user through OpenClaw.',
  },
)

// Reply tool
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message to the user through OpenClaw/Telegram',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message to send' },
      },
      required: ['text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    const { text } = req.params.arguments as { text: string }
    await wakeOpenClaw(`[Claude Code]\n${text}`)
    return { content: [{ type: 'text', text: 'delivered' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

// Permission relay
const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  const msg =
    `[Claude Code 승인 요청]\n` +
    `툴: ${params.tool_name}\n` +
    `내용: ${params.description}\n` +
    `ID: ${params.request_id}\n\n` +
    `"${params.request_id} 승인" 또는 "${params.request_id} 거절" 로 답해주세요.`
  await wakeOpenClaw(msg)
})

// Verdict HTTP server
Bun.serve({
  port: VERDICT_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method === 'POST' && new URL(req.url).pathname === '/verdict') {
      const { request_id, behavior } = await req.json() as { request_id: string; behavior: 'allow' | 'deny' }
      const resolve = pending.get(request_id)
      if (resolve) {
        resolve(behavior)
        pending.delete(request_id)
        await mcp.notification({
          method: 'notifications/claude/channel/permission',
          params: { request_id, behavior },
        })
        return new Response('ok')
      }
      return new Response('not found', { status: 404 })
    }
    return new Response('not found', { status: 404 })
  },
})

await mcp.connect(new StdioServerTransport())
```

---

## 체크리스트

- [ ] Phase 1: `src/index.ts` 구현
- [ ] Phase 2: `openclaw.json` hooks 설정
- [ ] Phase 3: `.mcp.json` 설정 + Claude Code 테스트
- [ ] Phase 4: OpenClaw skill 추가 (verdict 전달 방법)
- [ ] 테스트: `curl` 로 verdict 전달 → Claude Code 응답 확인
