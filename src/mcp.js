/**
 * MCP configuration bridge for the 灵眼操控中心.
 *
 * The panel writes human-readable server rows to the lingeye domain; this
 * plugin mounts one official `@deepseek-ai/dsh-mcp-client` instance per enabled
 * row. It deliberately does not implement MCP transports itself: server names,
 * tool names, reconnects and transport behavior stay owned by the official
 * client, which also makes duplicate names with other MCP rows fail visibly
 * instead of silently colliding.
 */

export const name = 'lingeye-mcp'

export const inject = ['webServer', 'lingeyeStore']

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

function officialCandidates() {
  const appDirs = []
  if (typeof process.resourcesPath === 'string') appDirs.push(process.resourcesPath)
  appDirs.push(join(dirname(process.execPath), 'resources'))
  return appDirs.map(root => join(root, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-mcp-client', 'lib', 'index.js'))
}

async function loadOfficial() {
  for (const candidate of officialCandidates()) {
    try {
      if (existsSync(candidate)) return await import(pathToFileURL(candidate).href)
    } catch {
      // Keep probing; the fallback below reports a concise error.
    }
  }
  return import('@deepseek-ai/dsh-mcp-client')
}

function writeJson(res, status, value) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(value))
}

function sameOrigin(req) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  if (origin === '' || host === '') return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function toConfig(row) {
  if (row.transport === 'streamable-http') {
    return {
      transport: 'streamable-http',
      serverName: row.serverName,
      url: row.url,
      headers: Object.fromEntries((row.headers ?? []).map(item => [item.key, item.value])),
      toolCallTimeoutMs: row.timeoutMs ?? 60000,
      failOnStartupError: row.failOnStartupError !== false,
    }
  }
  return {
    transport: 'stdio',
    serverName: row.serverName,
    command: row.command,
    args: row.args ?? [],
    env: Object.fromEntries((row.env ?? []).map(item => [item.key, item.value])),
    cwd: '',
    toolCallTimeoutMs: row.timeoutMs ?? 60000,
    failOnStartupError: row.failOnStartupError !== false,
  }
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  let McpClient
  let importError
  const mounted = new Map()
  let status = { available: false, error: 'official mcp-client has not loaded', servers: [] }

  const disposeAll = async () => {
    const entries = [...mounted.values()]
    mounted.clear()
    await Promise.allSettled(entries.map(entry => entry.dispose()))
  }

  const reload = async () => {
    await disposeAll()
    if (McpClient === undefined) {
      status = { available: false, error: importError ?? 'official mcp-client unavailable', servers: [] }
      return status
    }
    const rows = await ctx.lingeyeStore.mcpServers()
    const servers = []
    for (const row of rows) {
      if (row.enabled !== true) {
        servers.push({ serverName: row.serverName, configured: true, enabled: false, ok: false, error: null })
        continue
      }
      let timer
      let activation
      try {
        activation = ctx.plugin(McpClient, toConfig(row))
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${name}: activation timed out after 20000ms`)), 20000)
        })
        const fiber = await Promise.race([activation, timeout])
        mounted.set(row.serverName, {
          fiber,
          dispose: () => fiber.dispose(),
        })
        servers.push({ serverName: row.serverName, configured: true, enabled: true, ok: true, error: null })
      } catch (error) {
        // A timed-out mount can still settle later; dispose it if it does.
        activation?.then(fiber => fiber.dispose()).catch(() => undefined)
        servers.push({
          serverName: row.serverName,
          configured: true,
          enabled: true,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        clearTimeout(timer)
      }
    }
    status = { available: true, error: null, servers }
    return status
  }

  const initialize = async () => {
    try {
      McpClient = await loadOfficial()
    } catch (error) {
      importError = `official mcp-client unavailable: ${error instanceof Error ? error.message : String(error)}`
      status = { available: false, error: importError, servers: [] }
      return
    }
    await reload()
  }

  ctx.effect(() => () => { void disposeAll() })
  ctx.provide('lingeyeMcp', { status: () => status, reload })
  void initialize()

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/lingeye/mcp',
    handler: async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const servers = await ctx.lingeyeStore.mcpServers()
        const payload = { servers, status }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        writeJson(res, 200, payload)
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (!sameOrigin(req)) {
        writeJson(res, 403, { error: 'cross-origin request refused' })
        return
      }
      try {
        const body = await readJsonBody(req)
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('request body must be a JSON object')
        }
        if (body.action === 'delete') {
          if (typeof body.serverName !== 'string' || body.serverName.trim() === '') throw new Error('serverName is required')
          await ctx.lingeyeStore.deleteMcpServer(body.serverName)
        } else if (body.action === 'reload') {
          // reload below
        } else {
          await ctx.lingeyeStore.saveMcpServer(body)
        }
        const next = await reload()
        writeJson(res, 200, { status: next, servers: await ctx.lingeyeStore.mcpServers() })
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))
}
