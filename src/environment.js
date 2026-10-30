/**
 * Environment settings and read-only diagnostics for the 灵眼操控中心.
 *
 * Git Bash is opt-in. The form owns the persisted switch and manual path; the
 * separate gitbash plugin consumes this service and only replaces the shell
 * when the user enables it. Cookie counts come from the current request; the
 * route never reads or returns cookie values.
 */

import { createHash } from 'node:crypto'
import { explicitGitBashPath } from './gitbash-core.js'

export const name = 'lingeye-environment'

export const inject = ['webServer', 'lingeyeStore']

/** Node's default maximum request-header size, and the useful safety margin. */
const HEADER_LIMIT_BYTES = 16 * 1024
const WARN_RATIO = 0.75

export function cookieReport(req) {
  const raw = typeof req.headers.cookie === 'string' ? req.headers.cookie : ''
  const segments = raw.split(';').map(segment => segment.trim()).filter(segment => segment.length > 0)
  const authNames = []
  for (const segment of segments) {
    const at = segment.indexOf('=')
    if (at <= 0) continue
    const name = segment.slice(0, at)
    if (name.startsWith('dsh-auth-')) authNames.push(name)
  }
  const headerBytes = Buffer.byteLength(raw, 'utf8')
  const estimatedRequestHeaderBytes = headerBytes + 2048
  return {
    authCount: authNames.length,
    headerBytes,
    headerLimitBytes: HEADER_LIMIT_BYTES,
    estimatedRequestHeaderBytes,
    warning: estimatedRequestHeaderBytes >= HEADER_LIMIT_BYTES * WARN_RATIO,
    cookieTotal: segments.length,
  }
}

/** Build the delete headers for every old DSH auth cookie while keeping the current authority. */
export function cleanupCookieHeaders(req, protocol = 'http:') {
  const raw = typeof req.headers.cookie === 'string' ? req.headers.cookie : ''
  const names = []
  for (const segment of raw.split(';')) {
    const trimmed = segment.trim()
    const at = trimmed.indexOf('=')
    if (at <= 0) continue
    const name = trimmed.slice(0, at)
    if (/^dsh-auth-[A-Za-z0-9_-]+$/u.test(name)) names.push(name)
  }
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  let current
  if (host !== '') {
    const parsed = new URL(`${protocol === 'https:' ? 'https:' : 'http:'}//${host}`)
    const authority = protocol === 'https:' ? parsed.origin : parsed.host
    current = `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`
  }
  const secure = protocol === 'https:'
  const removed = names.filter(name => name !== current)
  return {
    removed,
    kept: names.includes(current) ? current : null,
    headers: removed.map(name => `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`),
  }
}

function gitbashReport(ctx) {
  const service = ctx.get('lingeyeGitbash')
  if (service === undefined || typeof service.status !== 'function') {
    return { supported: false, enabled: false, shellPath: null, missing: false, source: null }
  }
  return service.status()
}

function writeJson(res, status, value) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(value))
}

export function sameOrigin(req) {
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
      if (size > 16 * 1024) {
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

export function apply(ctx, config = {}) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  let state = {
    gitbashEnabled: config.gitbashEnabled === true,
    gitbashShellPath: typeof config.gitbashShellPath === 'string' ? config.gitbashShellPath.trim() : '',
  }
  const listeners = new Set()
  const publish = () => {
    for (const listener of listeners) listener(state)
  }
  const service = {
    get: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  ctx.provide('lingeyeEnvironment', service)

  const load = () => {
    Promise.resolve(ctx.lingeyeStore.environmentSettings())
      .then(row => {
        state = { gitbashEnabled: row.gitbashEnabled === true, gitbashShellPath: row.gitbashShellPath ?? '' }
        publish()
      })
      .catch(error => ctx.logger?.warn?.(`${name}: failed to load environment settings: ${error instanceof Error ? error.message : String(error)}`))
  }
  load()

  const save = async input => {
    const path = typeof input.gitbashShellPath === 'string' ? input.gitbashShellPath.trim() : ''
    if (path !== '' && explicitGitBashPath(path) === undefined) {
      throw new Error('shellPath must point to an existing Git for Windows bash.exe (not System32\\bash.exe)')
    }
    const row = await ctx.lingeyeStore.saveEnvironmentSettings({
      gitbashEnabled: input.gitbashEnabled === true,
      gitbashShellPath: path,
    })
    state = { gitbashEnabled: row.gitbashEnabled, gitbashShellPath: row.gitbashShellPath }
    publish()
    return state
  }


  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/lingeye/projects',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') {
        writeJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (req.method === 'GET') {
        try {
          writeJson(res, 200, { projects: await ctx.lingeyeStore.projects() })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (!sameOrigin(req)) {
        writeJson(res, 403, { error: 'cross-origin request refused' })
        return
      }
      try {
        const body = await readJsonBody(req)
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be a JSON object')
        if (body.action === 'delete') {
          if (typeof body.sessionId !== 'string' || body.sessionId === '') throw new Error('sessionId is required')
          const ids = await ctx.lingeyeStore.projectSessionIds(body.projectId)
          if (!ids.includes(body.sessionId)) throw new Error('session is not linked to this project')
          await ctx.lingeyeStore.deleteProject(body.projectId, body.sessionId)
          writeJson(res, 200, { deleted: body.projectId, projects: await ctx.lingeyeStore.projects() })
          return
        }
        const project = await ctx.lingeyeStore.saveProject(body)
        writeJson(res, 200, { project, projects: await ctx.lingeyeStore.projects() })
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/lingeye/environment',
    handler: async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const payload = {
          gitbash: gitbashReport(ctx),
          cookies: cookieReport(req),
          settings: { ...state },
        }
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
        if (body.action === 'cleanup-cookies') {
          if (body.confirm !== true) throw new Error('cookie cleanup requires explicit confirmation')
          const cleanup = cleanupCookieHeaders(req, webServer.protocol)
          res.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
            ...(cleanup.headers.length === 0 ? {} : { 'set-cookie': cleanup.headers }),
          })
          res.end(JSON.stringify({
            cleaned: cleanup.removed.length,
            removed: cleanup.removed,
            kept: cleanup.kept,
            cookies: cookieReport(req),
          }))
          return
        }
        const saved = await save(body)
        writeJson(res, 200, { settings: saved, gitbash: gitbashReport(ctx) })
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))
}
