# Claude Code 통신 브릿지 (openclaw-bridge)

Claude Code(코딩 에이전트)와 능동적으로 소통하는 채널.
OpenClaw(나)가 supervisor 역할로 작업 지시, 결과 수신, permission relay를 처리한다.

## 전제 조건

- MCP 서버(`openclaw-claude-code-comm-mcp`) 설치됨
- `~/.openclaw/openclaw.json`에 hooks 활성화됨
- Claude Code에 `openclaw-bridge` MCP 서버 등록됨

## Claude Code 세션 시작

Claude Code와 통신하려면 먼저 채널 세션이 떠있어야 한다.
세션이 없으면 `/send`가 connection refused 난다.

```bash
# 세션 확인
tmux ls 2>/dev/null | grep claude-code

# 세션 없으면 시작
tmux new-session -d -s claude-code \
  'cd /home/jaemin/knota-workspace && ~/.local/bin/claude --dangerously-load-development-channels server:openclaw-bridge'

# 확인 프롬프트 자동 승인
sleep 4
tmux send-keys -t claude-code -l -- "1"
sleep 0.2
tmux send-keys -t claude-code Enter
sleep 3

# 연결 확인
tmux capture-pane -t claude-code -p | grep "Listening"
# 출력: Listening for channel messages from: server:openclaw-bridge
```

## 동작 방식

- **이벤트 기반**: sleep/폴링 불필요
- Claude Code reply → `/hooks/wake` → OpenClaw 즉시 깨움 (`mode: "now"`)
- Permission request도 동일하게 즉시 push됨

## Claude Code에 작업 지시

```bash
curl -s -X POST http://127.0.0.1:8790/send \
  -H "Content-Type: application/json" \
  -d '{"text": "<작업 지시 내용>"}'
```

## Claude Code 보고 수신

system event에 `[Claude Code 보고]`로 시작하는 메시지 → Claude Code의 작업 보고.
내용 확인 후 필요시 사용자에게 전달하거나 후속 지시.

## Permission Request 처리

system event에 `[Claude Code 승인 요청]`으로 시작하는 메시지:

```
[Claude Code 승인 요청]
툴: Bash
내용: <설명>
미리보기: <명령어>
ID: <request_id>
```

**자동 승인** (사용자에게 묻지 않고 바로):
- 읽기 전용: `ls`, `cat`, `grep`, `find`, `git log`, `git status`, `git diff`
- 테스트: `pytest`, `npm test`
- 빌드: `npm run build`, `uv run`

**사용자 확인 필요**:
- 파일 수정/삭제: Write, Edit, `rm`, `mv`
- `git push`, `git commit`
- `sudo`, 권한 상승
- 외부 API 호출, 배포

**Verdict 전달:**

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

사용자 답장 형식: `"<request_id> 승인"` 또는 `"<request_id> 거절"`
