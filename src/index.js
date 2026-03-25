#!/usr/bin/env node
import 'dotenv/config'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { createServer } from 'node:http'

const OPENCLAW_HOOK_URL = process.env.OPENCLAW_HOOK_URL ?? 'http://127.0.0.1:18789/hooks'
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN ?? ''
const MCP_PORT = parseInt(process.env.MCP_PORT ?? '8790')

// OpenClaw webhook으로 메시지 전달 (Claude Code → OpenClaw)
async function wakeOpenClaw(text) {
  try {
    const res = await fetch(`${OPENCLAW_HOOK_URL}/wake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENCLAW_HOOK_TOKEN}`,
      },
      body: JSON.stringify({ text, mode: 'now' }),
    })
    if (!res.ok) {
      process.stderr.write(`[openclaw-bridge] wake failed: ${res.status} ${await res.text()}\n`)
    }
  } catch (err) {
    process.stderr.write(`[openclaw-bridge] wake error: ${err.message}\n`)
  }
}

// MCP Server
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
      'OpenClaw 브릿지 채널. ' +
      'OpenClaw(메인 AI supervisor)로부터 작업 지시가 <channel> 태그로 들어옵니다. ' +
      '작업 완료, 질문, 보고는 reply 툴로 OpenClaw에게 전달하세요. ' +
      'permission 요청은 자동으로 OpenClaw를 통해 처리됩니다.',
  },
)

// Reply tool (Claude Code → OpenClaw)
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'OpenClaw(supervisor)에게 메시지를 전달합니다. 작업 완료 보고, 질문, 진행 상황 공유 등.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '전달할 메시지' },
        },
        required: ['text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'reply') {
    const { text } = req.params.arguments
    await wakeOpenClaw(`[Claude Code 보고]\n${text}`)
    return { content: [{ type: 'text', text: '전달됨' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

// Permission relay 핸들러 (Claude Code → OpenClaw)
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
    `미리보기: ${params.input_preview}\n` +
    `ID: ${params.request_id}`
  await wakeOpenClaw(msg)
})

// HTTP 서버: /send (OpenClaw → Claude Code), /verdict (permission verdict)
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  let body = ''
  for await (const chunk of req) body += chunk

  // POST /send: OpenClaw → Claude Code 메시지
  if (req.method === 'POST' && url.pathname === '/send') {
    try {
      const { text } = JSON.parse(body)
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: text,
          meta: { source: 'openclaw' },
        },
      })
      res.writeHead(200)
      res.end('ok')
    } catch (err) {
      res.writeHead(400)
      res.end(`bad request: ${err.message}`)
    }
    return
  }

  // POST /verdict: permission verdict
  if (req.method === 'POST' && url.pathname === '/verdict') {
    try {
      const { request_id, behavior } = JSON.parse(body)
      await mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: { request_id, behavior },
      })
      process.stderr.write(`[openclaw-bridge] verdict: ${request_id} → ${behavior}\n`)
      res.writeHead(200)
      res.end('ok')
    } catch (err) {
      res.writeHead(400)
      res.end(`bad request: ${err.message}`)
    }
    return
  }

  res.writeHead(404)
  res.end('not found')
})

httpServer.listen(MCP_PORT, '127.0.0.1', () => {
  process.stderr.write(`[openclaw-bridge] HTTP server on 127.0.0.1:${MCP_PORT}\n`)
  process.stderr.write(`[openclaw-bridge]   POST /send    - OpenClaw → Claude Code\n`)
  process.stderr.write(`[openclaw-bridge]   POST /verdict - Permission verdict\n`)
})

// stdio transport 연결
await mcp.connect(new StdioServerTransport())
process.stderr.write('[openclaw-bridge] MCP server connected via stdio\n')
