# openclaw-claude-code-comm-mcp

OpenClaw ↔ Claude Code 양방향 통신 브릿지 MCP 서버.

OpenClaw(메인 AI)가 Claude Code(코딩 에이전트)를 supervisor처럼 관리하며,
작업 지시 → 결과 보고 → permission relay를 처리한다.

## 아키텍처

```
재민 (Telegram)
    ↕  (작업 요청, 권한 승인/거절)
OpenClaw (메인 AI / supervisor)
    ↕  POST /send → Claude Code
    ↕  Claude Code → reply tool → /hooks/wake → OpenClaw
MCP Channel Server (이 프로젝트)
    ↕  stdio
Claude Code
```

## 설치

### 1. 의존성 설치

```bash
git clone https://github.com/lucian-kim-99/openclaw-claude-code-comm-mcp
cd openclaw-claude-code-comm-mcp
npm install
```

### 2. 환경 변수 설정

```bash
cp .env.template .env
# .env 편집: OPENCLAW_HOOK_TOKEN 설정
```

### 3. OpenClaw hooks 활성화

`~/.openclaw/openclaw.json`:
```json5
{
  hooks: {
    enabled: true,
    token: "<OPENCLAW_HOOK_TOKEN과 동일>",
    path: "/hooks",
  }
}
```

### 4. Claude Code MCP 설정

`~/.claude.json`:
```json
{
  "mcpServers": {
    "openclaw-bridge": {
      "command": "node",
      "args": ["/path/to/openclaw-claude-code-comm-mcp/src/index.js"],
      "env": {
        "OPENCLAW_HOOK_URL": "http://127.0.0.1:18789/hooks",
        "OPENCLAW_HOOK_TOKEN": "<token>",
        "MCP_PORT": "8790"
      }
    }
  }
}
```

### 5. Claude Code 실행

```bash
tmux new-session -d -s claude-code \
  'cd /your/workspace && claude --dangerously-load-development-channels server:openclaw-bridge'
```

## 사용법

### OpenClaw → Claude Code 작업 지시

```bash
curl -X POST http://127.0.0.1:8790/send \
  -H "Content-Type: application/json" \
  -d '{"text": "git status 확인하고 결과 알려줘."}'
```

### Permission Verdict 전달

```bash
# 승인
curl -X POST http://127.0.0.1:8790/verdict \
  -H "Content-Type: application/json" \
  -d '{"request_id": "abcde", "behavior": "allow"}'

# 거절
curl -X POST http://127.0.0.1:8790/verdict \
  -H "Content-Type: application/json" \
  -d '{"request_id": "abcde", "behavior": "deny"}'
```

## HTTP Endpoints

| Method | Path | 설명 |
|--------|------|------|
| POST | `/send` | OpenClaw → Claude Code 메시지 |
| POST | `/verdict` | Permission verdict 전달 |

모두 `127.0.0.1`(loopback)에만 바인딩.

## 동작 방식

- **이벤트 기반**: sleep/폴링 불필요
- Claude Code reply → `/hooks/wake` → OpenClaw 즉시 깨움 (`mode: "now"`)
- Permission request도 동일하게 즉시 push

## 참고

- [Claude Code Channels 문서](https://code.claude.com/docs/en/channels-reference)
- [OpenClaw Webhook 문서](https://docs.openclaw.ai/automation/webhook)
