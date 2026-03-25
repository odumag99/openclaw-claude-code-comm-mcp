---
name: claude-code-comm
description: "OpenClaw ↔ Claude Code 양방향 통신 브릿지. Use when: (1) Claude Code에게 코딩 작업을 위임하거나 지시할 때, (2) Claude Code로부터 작업 보고를 받을 때, (3) Claude Code의 permission request를 처리할 때. NOT for: 단순 shell 명령 실행 (exec 직접 사용), Claude Code 없이 로컬 작업만 할 때."
metadata:
  {
    "openclaw": {
      "emoji": "🔗",
      "requires": { "bins": ["tmux", "curl", "node"] }
    }
  }
---

# Claude Code 통신 브릿지 (openclaw-bridge)

OpenClaw(나)가 Claude Code(코딩 에이전트)를 supervisor로서 관리하는 채널.
작업 지시, 결과 보고 수신, permission relay를 처리한다.

## 언제 사용하나

- 재민 님이 코딩 작업을 요청했고 Claude Code에게 위임하려 할 때
- `[Claude Code 보고]` system event를 받았을 때
- `[Claude Code 승인 요청]` system event를 받았을 때

## 전제 조건

다음이 모두 준비되어 있어야 한다:

1. **MCP 서버 설치**
   ```bash
   git clone https://github.com/odumag99/openclaw-claude-code-comm-mcp
   cd openclaw-claude-code-comm-mcp
   npm install
   cp .env.template .env
   # .env에서 OPENCLAW_HOOK_TOKEN 설정
   ```

2. **OpenClaw hooks 활성화** (`~/.openclaw/openclaw.json`)
   ```json5
   {
     hooks: {
       enabled: true,
       token: "<OPENCLAW_HOOK_TOKEN과 동일>",
       path: "/hooks",
     }
   }
   ```
   설정 후 `openclaw gateway restart`

3. **Claude Code MCP 서버 등록** (`~/.claude.json`)
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

---

## Claude Code 세션 시작

Claude Code와 통신하려면 먼저 채널 세션이 떠있어야 한다.
세션이 없으면 `/send`가 connection refused 오류 난다.

```bash
# 세션 확인
tmux ls 2>/dev/null | grep claude-code

# 세션 없으면 시작 (workspace 경로는 상황에 맞게 변경)
tmux new-session -d -s claude-code \
  'cd /home/jaemin/knota-workspace && ~/.local/bin/claude --dangerously-load-development-channels server:openclaw-bridge'

# 확인 프롬프트 자동 승인 (1번 선택)
sleep 4
tmux send-keys -t claude-code -l -- "1"
sleep 0.2
tmux send-keys -t claude-code Enter
sleep 3

# 연결 확인 (아래 문자열이 보이면 정상)
tmux capture-pane -t claude-code -p | grep "Listening"
# → Listening for channel messages from: server:openclaw-bridge
```

---

## 동작 방식

- **이벤트 기반**: sleep/폴링 불필요
- Claude Code가 reply tool 호출 → MCP 서버 → `/hooks/wake` POST → OpenClaw 즉시 깨움 (`mode: "now"`)
- Permission request도 동일하게 즉시 push됨
- OpenClaw는 supervisor로서 내용 판단 후 필요시만 사용자에게 전달

```
사용자 → OpenClaw → /send → Claude Code
                    Claude Code → reply → /hooks/wake → OpenClaw → (필요시) 사용자
                    Claude Code → permission_request → /hooks/wake → OpenClaw → (필요시) 사용자
```

---

## Claude Code에 작업 지시

```bash
curl -s -X POST http://127.0.0.1:8790/send \
  -H "Content-Type: application/json" \
  -d '{"text": "<작업 지시 내용>"}'
```

예시:
```bash
curl -s -X POST http://127.0.0.1:8790/send \
  -H "Content-Type: application/json" \
  -d '{"text": "현재 브랜치와 최근 커밋 5개를 알려줘."}'
```

---

## Claude Code 보고 수신

system event에 `[Claude Code 보고]`로 시작하는 메시지가 오면
Claude Code의 작업 보고 또는 질문이다.

처리 방법:
- 완료 보고 → 사용자에게 요약 전달 또는 내부 처리
- 질문 → 판단 후 답변을 `/send`로 전달
- 오류 → 원인 파악 후 수정 지시

---

## Permission Request 처리

system event에 `[Claude Code 승인 요청]`으로 시작하는 메시지:

```
[Claude Code 승인 요청]
툴: Bash
내용: <설명>
미리보기: <명령어>
ID: <request_id>
```

### 자동 승인 (사용자에게 묻지 않고 바로)
- 읽기 전용: `ls`, `cat`, `grep`, `find`, `git log`, `git status`, `git diff`
- 테스트 실행: `pytest`, `npm test`, `uv run pytest`
- 빌드: `npm run build`, `uv run`
- 패키지 설치: `pip install`, `npm install`, `uv add`

### 사용자 확인 필요
- 파일 수정/삭제: Write, Edit, `rm`, `mv`
- `git push`, `git commit`
- `sudo`, 권한 상승
- 외부 API 호출, 배포 스크립트

### Verdict 전달

```bash
# 승인
curl -s -X POST http://127.0.0.1:8790/verdict \
  -H "Content-Type: application/json" \
  -d '{"request_id": "<request_id>", "behavior": "allow"}'

# 거절
curl -s -X POST http://127.0.0.1:8790/verdict \
  -H "Content-Type: application/json" \
  -d '{"request_id": "<request_id>", "behavior": "deny"}'
```

사용자 답장 파싱 형식: `"<request_id> 승인"` → allow, `"<request_id> 거절"` → deny
