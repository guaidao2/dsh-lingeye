/**
 * Opt-in Git Bash enhancement for the control center.
 *
 * The DSH `shell` service is already owned by the native PowerShell executor,
 * so this plugin does not try to replace that service. Instead it registers a
 * host-global `bash` tool only while the user has enabled Git Bash:
 *
 *   - enabled: model sees `bash` (Git Bash) and no `pwsh`;
 *   - disabled: no custom `bash` tool, native `pwsh` remains untouched.
 *
 * The tool uses the host subprocess seam directly. It intentionally requires
 * danger-full-access because the MSYS runtime cannot initialize in the
 * restricted Windows sandbox.
 */

import {
  BASH_TOOL_DESCRIPTION,
  buildArgv,
  buildEnv,
  LEGACY_GITBASH_TOOL_NAME,
  TOOL_NAME,
  resolveConfig,
  resolveWorkdir,
  toWindowsPath,
  validateArgs,
} from './gitbash-core.js'
import { tool } from './tool.js'

export const name = 'lingeye-gitbash'

export const inject = ['tools', 'subprocess', 'sandboxPolicy', 'lingeyeEnvironment']

const MAX_TIMER_DELAY_MS = 2147483647

function timeoutSignal(upstream, timeoutMs) {
  const timer = new AbortController()
  const id = setTimeout(() => timer.abort(new Error('BASH_TIMEOUT')), timeoutMs)
  const signal = upstream === undefined ? timer.signal : AbortSignal.any([upstream, timer.signal])
  return {
    signal,
    timedOut: () => timer.signal.aborted,
    dispose: () => clearTimeout(id),
  }
}

function gateMessage(mode) {
  return `${name}: Git Bash cannot start inside the "${mode ?? 'unknown'}" sandbox `
    + '(MSYS cannot create its signal pipes under the restricted token). '
    + 'Switch this session to danger-full-access, then retry.'
}

function finalOutput(reader) {
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...(read.spillPath === undefined ? {} : { spillPath: read.spillPath }),
  }
}

export function apply(ctx, config = {}) {
  if (process.platform !== 'win32') {
    ctx.logger?.info?.(`${name}: only meaningful on win32; skipping`)
    return
  }

  const environment = ctx.get('lingeyeEnvironment')
  if (environment === undefined) {
    throw new Error(`${name}: ctx.lingeyeEnvironment is unavailable`)
  }
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new Error(`${name}: ctx.subprocess is unavailable`)
  }
  const sandboxPolicy = ctx.get('sandboxPolicy')

  let settings = environment.get()
  let resolved = resolveConfig({ ...config, shellPath: settings.gitbashShellPath })
  let enabled = settings.gitbashEnabled === true && resolved.shellPath !== undefined
  let disposeTool

  const status = () => ({
    supported: true,
    enabled,
    shellPath: resolved.shellPath ?? null,
    configuredPath: settings.gitbashShellPath,
    missing: settings.gitbashEnabled === true && resolved.shellPath === undefined,
    source: resolved.shellPath === undefined ? null : settings.gitbashShellPath.length > 0 ? 'manual' : 'auto',
  })
  ctx.provide('lingeyeGitbash', { status })

  const bashTool = tool({
    name: TOOL_NAME,
    description: BASH_TOOL_DESCRIPTION,
    parameters: {
      command: { type: 'string', required: true, description: 'Bash command to execute.' },
      description: { type: 'string', required: true, description: 'Short description of the command.' },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds; bounded by the configured maximum.' },
      workdir: { type: 'string', description: 'Optional working directory, relative to the session cwd when not absolute.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: async (args, exec) => {
      validateArgs(args)
      if (!enabled) throw new Error(`${name}: Git Bash is disabled; enable it in the control center.`)
      if (resolved.shellPath === undefined) {
        throw new Error(`${name}: Git Bash was not found; set shellPath in the control center.`)
      }
      const mode = sandboxPolicy?.resolve({ session: exec?.agent?.session })?.mode
        ?? sandboxPolicy?.defaultMode
      if (mode !== undefined && mode !== 'danger-full-access') throw new Error(gateMessage(mode))
      const timeoutMs = Math.min(Number(args.timeoutMs ?? resolved.timeoutMs), resolved.maxTimeoutMs)
      const stdoutMaxBytes = resolved.maxOutputBytes
      const workdir = toWindowsPath(resolveWorkdir(args.workdir, exec) ?? resolved.cwd ?? process.cwd())
      const fused = timeoutSignal(exec?.signal, timeoutMs)
      try {
        const handle = subprocess.spawn({
          argv: buildArgv(resolved.shellPath, args.command),
          cwd: workdir,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: stdoutMaxBytes, spill: { maxBytes: resolved.maxSpillBytes } },
            stderr: { maxBytes: resolved.maxOutputBytes, spill: { maxBytes: resolved.maxSpillBytes } },
          },
          graceMs: resolved.graceMs,
          signal: fused.signal,
          env: buildEnv(),
        })
        const outcome = await handle.done
        const stdout = finalOutput(handle.collected.stdout)
        const stderr = finalOutput(handle.collected.stderr)
        let text = stdout.text
        if (stderr.text.length > 0) {
          if (text.length > 0 && !text.endsWith('\n')) text += '\n'
          text += `[stderr]\n${stderr.text}`
        }
        if (fused.timedOut()) text += `\n[timed out after ${timeoutMs}ms]`
        else if (outcome.signal !== null && outcome.signal !== undefined) text += `\n[killed by signal: ${outcome.signal}]`
        else if (outcome.exitCode !== 0) text += `\n[exit code: ${outcome.exitCode}]`
        if (text.length === 0) text = '(no output)'
        return { text, exitCode: outcome.exitCode, timedOut: fused.timedOut(), workdir }
      } finally {
        fused.dispose()
      }
    },
  })

  const sync = () => {
    settings = environment.get()
    resolved = resolveConfig({ ...config, shellPath: settings.gitbashShellPath })
    enabled = settings.gitbashEnabled === true && resolved.shellPath !== undefined
    if (enabled && disposeTool === undefined) {
      disposeTool = ctx.tools.register(bashTool)
      ctx.logger?.info?.(`${name}: bash tool registered with ${resolved.shellPath}`)
    } else if (!enabled && disposeTool !== undefined) {
      disposeTool()
      disposeTool = undefined
      ctx.logger?.info?.(`${name}: bash tool removed because Git Bash is disabled`)
    }
  }
  sync()
  ctx.effect(() => environment.subscribe(sync))

  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    if (!enabled || !Array.isArray(assembled?.tools)) return assembled
    const filtered = assembled.tools.filter(tool => tool?.name !== 'pwsh' && tool?.name !== LEGACY_GITBASH_TOOL_NAME)
    return filtered.length === assembled.tools.length ? assembled : { ...assembled, tools: filtered }
  })

  ctx.tools.guard(exec => {
    if (enabled && exec?.name === 'pwsh') {
      return `${name}: pwsh is disabled while Git Bash is active; use the bash tool instead.`
    }
    return undefined
  })
}
