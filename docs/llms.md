# openclaw-claude-code-comm-mcp

## 목적

Claude Code와 OpenClaw 사이의 **능동적 양방향 통신 채널**.

OpenClaw(메인 AI)가 Claude Code(코딩 에이전트)를 supervisor처럼 관리하며,
작업 지시 → 결과 보고 → 피드백을 직접 주고받는다.
권한 요청(permission)은 OpenClaw가 판단하되, 필요시에만 재민에게 확인한다.

---

## 아키텍처

```
재민 (Telegram)
    ↕  (작업 요청, 권한 승인/거절)
OpenClaw (메인 AI / supervisor)
    ↕  POST /send  →  notifications/claude/channel  →  Claude Code
    ↕  reply tool  →  /hooks/wake  →  OpenClaw
openclaw-claude-code-comm-mcp (MCP Channel Server)
    ↕  stdio
Claude Code (코딩 에이전트)
```

### 구성 요소

1. **MCP Channel Server** (이 프로젝트)
   - Claude Code가 stdio로 subprocess 실행
   - `claude/channel` capability → Claude Code에 notification listener 등록
   - `claude/channel/permission` capability → permission relay
   - `/send` HTTP endpoint → OpenClaw가 Claude Code에 메시지 전달
   - `/verdict` HTTP endpoint → OpenClaw가 permission verdict 전달

2. **OpenClaw Webhook Ingress** (`/hooks/wake`)
   - Claude Code → reply tool → MCP 서버 → `/hooks/wake` POST → OpenClaw 깨움

3. **OpenClaw → Claude Code 방향**
   - OpenClaw가 `POST /send {"text": "..."}` → MCP 서버
   - MCP 서버 → `notifications/claude/channel` → Claude Code에 메시지 inject

---

## 이벤트 흐름

### OpenClaw → Claude Code (작업 지시)

```
1. 재민: "knota 배포해줘"
2. OpenClaw: POST http://127.0.0.1:8790/send
   {"text": "gyudong-backend 배포 스크립트 실행해줘. /home/jaemin/knota-workspace/..."}
3. MCP 서버: notifications/claude/channel → Claude Code
4. Claude Code: 작업 수행
```

### Claude Code → OpenClaw (결과 보고)

```
1. Claude Code: reply tool 호출 ("배포 완료. 커밋 hash: abc123")
2. MCP 서버: /hooks/wake POST → OpenClaw 깨움
3. OpenClaw: 결과 확인 후 필요시 재민에게 보고
```

### Permission Request

```
1. Claude Code: Bash 실행 전 permission 요청
2. MCP 서버: permission_request 수신
   {request_id: "abcde", tool_name: "Bash", description: "...", input_preview: "..."}
3. MCP 서버: /hooks/wake POST → OpenClaw 깨움
   "[Claude Code 승인 요청]\n툴: Bash\n내용: ...\nID: abcde"
4. OpenClaw: 판단
   - 안전한 읽기 명령 → 자동 승인
   - 위험한 명령 → 재민에게 확인
     "Claude Code가 <명령> 실행하려 해요. 승인할까요? (abcde)"
5. 재민: "abcde 승인" 또는 "abcde 거절"
6. OpenClaw: POST /verdict {"request_id": "abcde", "behavior": "allow"}
7. MCP 서버: Claude Code에 permission 전달
```

---

## HTTP Endpoints (MCP 서버)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/send` | OpenClaw → Claude Code 메시지 전달 |
| POST | `/verdict` | Permission verdict 전달 |

모두 loopback(127.0.0.1)에만 바인딩.

---

## 설정

### openclaw.json

```json5
{
  hooks: {
    enabled: true,
    token: "<HOOK_TOKEN>",
    path: "/hooks",
  }
}
```

### .env (MCP 서버)

```
OPENCLAW_HOOK_URL=http://127.0.0.1:18789/hooks
OPENCLAW_HOOK_TOKEN=<HOOK_TOKEN>
MCP_PORT=8790
```
