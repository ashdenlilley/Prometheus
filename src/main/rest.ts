import http from 'http'
import { callTool, MAX_BODY, readBody, send, tokenMatches, type McpHost, type ToolResult } from './mcp'

// REST front door for the same tools as MCP, under /api/v1 on the MCP server. Routing and auth live
// here; the work is done by callTool, so both interfaces behave the same.

type Endpoint = 'projects' | 'issues' | 'issue' | 'comments'

const METHODS: Record<Endpoint, string[]> = {
  projects: ['GET'],
  issues: ['GET', 'POST'],
  issue: ['GET', 'PATCH'],
  comments: ['POST']
}

function error(res: http.ServerResponse, status: number, code: string, message: string) {
  send(res, status, { error: { code, message } })
}

// Tool failures map to 404 for missing records, 503 before the data loads, and 400 for anything else.
function fromTool(res: http.ServerResponse, out: ToolResult, status = 200) {
  if (out.ok) return send(res, status, out.value)
  if (/not found/i.test(out.message)) return error(res, 404, 'not_found', out.message)
  if (/not loaded/i.test(out.message)) return error(res, 503, 'not_ready', out.message)
  return error(res, 400, 'invalid_request', out.message)
}

// undefined when the body is not valid JSON.
async function jsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null | undefined> {
  const text = await readBody(req)
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return undefined
  }
}

export async function restRoute(req: http.IncomingMessage, res: http.ServerResponse, token: string, host: McpHost) {
  if (!tokenMatches(req.headers.authorization, token)) {
    return error(res, 401, 'unauthorized', 'Missing or invalid bearer token')
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  // A malformed %-escape keeps its raw text, so it ends up as a 404 rather than a 500.
  const path = url.pathname
    .slice('/api/v1'.length)
    .split('/')
    .filter(Boolean)
    .map(s => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
  const [head, id, sub] = path
  const endpoint: Endpoint | null =
    head === 'projects' && path.length === 1
      ? 'projects'
      : head === 'issues' && path.length === 1
        ? 'issues'
        : head === 'issues' && path.length === 2
          ? 'issue'
          : head === 'issues' && path.length === 3 && sub === 'comments'
            ? 'comments'
            : null
  if (!endpoint) return error(res, 404, 'not_found', `No route for ${url.pathname}`)

  const method = req.method ?? ''
  if (!METHODS[endpoint].includes(method)) {
    return error(res, 405, 'method_not_allowed', `${method} is not allowed here. Use ${METHODS[endpoint].join(' or ')}.`)
  }

  let body: Record<string, unknown> = {}
  if (method === 'POST' || method === 'PATCH') {
    // Answer before reading: readBody drops the socket on overflow, so the client would never see the 413.
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return error(res, 413, 'payload_too_large', 'Request body is too large')
    let parsed: Record<string, unknown> | null | undefined
    try {
      parsed = await jsonBody(req)
    } catch {
      // Chunked bodies with no Content-Length: readBody has already dropped the connection.
      return error(res, 413, 'payload_too_large', 'Request body is too large')
    }
    if (parsed === undefined) return error(res, 400, 'invalid_json', 'Body is not valid JSON')
    if (parsed === null) return error(res, 400, 'invalid_request', 'Body must be a JSON object')
    body = parsed
  }

  switch (endpoint) {
    case 'projects':
      return fromTool(res, callTool('list_projects', {}, host))
    case 'issues': {
      if (method === 'POST') return fromTool(res, callTool('create_issue', body, host), 201)
      const assignee = url.searchParams.get('assignee')?.toLowerCase()
      // list_issues applies its limit before any assignee filter, so ask for everything and filter here.
      const out = callTool(
        'list_issues',
        {
          projectId: url.searchParams.get('project') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          search: url.searchParams.get('q') ?? undefined,
          limit: Number.MAX_SAFE_INTEGER
        },
        host
      )
      if (!out.ok || !assignee) return fromTool(res, out)
      const rows = out.value as { assignee: string }[]
      return send(res, 200, rows.filter(i => i.assignee.toLowerCase() === assignee))
    }
    case 'issue':
      // The path key wins over any id in the body.
      if (method === 'PATCH') return fromTool(res, callTool('update_issue', { ...body, id: undefined, key: id }, host))
      return fromTool(res, callTool('get_issue', { key: id }, host))
    case 'comments':
      return fromTool(res, callTool('add_comment', { ...body, id: undefined, key: id }, host), 201)
  }
}
