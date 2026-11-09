/**
 * Agent-scoped PowerShell gate.
 *
 * The static `tool-pwsh` row cannot be conditionally hidden by the Git Bash
 * setting, so it is not mounted in the 灵眼 presets. This row mounts the
 * official `@deepseek-ai/dsh-tool-pwsh` instance only while Git Bash is off,
 * and disposes it when Git Bash turns on. The model therefore never sees a
 * `pwsh` tool in Git Bash mode — no guard-only placeholder is left behind.
 *
 * @module dsh-lingeye/pwsh-gate
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'lingeye-pwsh-gate'

export const inject = ['tools', 'lingeyeGitbash', 'lingeyeEnvironment']

function candidates() {
  const roots = []
  if (typeof process.resourcesPath === 'string') roots.push(process.resourcesPath)
  roots.push(join(dirname(process.execPath), 'resources'))
  const out = []
  for (const root of roots) {
    const base = join(root, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tool-pwsh')
    out.push(join(base, 'lib', 'index.js'), join(base, 'dist', 'index.js'))
    out.push(join(root, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tool-pwsh', 'lib', 'index.js'))
  }
  return out
}

async function loadPwsh() {
  try {
    return await import('@deepseek-ai/dsh-tool-pwsh')
  } catch {
    // Desktop packages live inside app.asar; probe that layout below.
  }
  for (const candidate of candidates()) {
    try {
      if (existsSync(candidate)) return await import(pathToFileURL(candidate).href)
    } catch {
      // Keep probing.
    }
  }
  throw new Error('official @deepseek-ai/dsh-tool-pwsh could not be loaded')
}

export async function apply(ctx) {
  let fiber
  let queue = Promise.resolve()
  const run = async () => {
    const status = ctx.lingeyeGitbash?.status?.()
    const shouldMount = status?.supported !== false && status?.enabled !== true
    if (!shouldMount) {
      if (fiber !== undefined) {
        await fiber.dispose()
        fiber = undefined
      }
      return
    }
    if (fiber !== undefined) return
    const loaded = await loadPwsh()
    const plugin = loaded.default ?? loaded
    fiber = await ctx.plugin(plugin, {})
  }
  const sync = (loud = false) => {
    queue = queue.then(run)
    if (!loud) {
      queue = queue.catch(error => {
        ctx.logger?.warn?.(`${name}: failed to toggle pwsh: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    return queue
  }
  // The initial mount is awaited: a broken official import fails the preset
  // mount loudly instead of silently leaving Windows without a shell.
  await sync(true)
  ctx.effect(() => ctx.lingeyeEnvironment.subscribe(() => { void sync(false) }))
}
