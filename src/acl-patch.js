/**
 * Built-in Windows ACL sandbox workaround (vendored, MIT).
 *
 * DSH 0.1.7+ `workspace-write` grants the workspace ACL before every command.
 * On a non-system-drive workspace (D:/E:/F:) the directory ACL carries only
 * `Authenticated Users: Modify`, the filtered UAC token cannot obtain
 * `WRITE_OWNER`, and the grant fails with Win32 5 before the command spawns:
 *
 *   SetNamedSecurityInfoW failed (Win32 5): grantWrite(<workspace-path>)
 *
 * This row vendors `dsh-acl-sandbox-patch` (MIT, see THIRD_PARTY_NOTICES.md)
 * so dsh-lingeye users on Windows do not have to discover and install the
 * upstream workaround themselves. It changes no system ACL: it wraps the
 * sandbox's own FFI calls, retries the grant without the Low integrity label
 * only when the strict call fails with Win32 5, and skips demoting child
 * processes to Low integrity only in that degraded environment.
 *
 * The preload is copied to a stable `$DSH_HOME/lingeye-acl-patch/` directory
 * and `NODE_OPTIONS` points at a generated bootstrap there, never at this
 * package. A package upgrade or removal therefore cannot leave child Node
 * processes pointing at a deleted file; the bootstrap also checks an env flag
 * and swallows a missing preload. Unloading the plugin removes our
 * `NODE_OPTIONS` entry so later children stay untouched.
 *
 * Disable it per deployment by overriding this row with `config.enabled: false`.
 *
 * @module dsh-lingeye/acl-patch
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader entry name. */
export const name = 'lingeye-acl-patch'

const PACKAGE_PRELOAD = fileURLToPath(new URL('../vendor/acl-sandbox-patch/preload.cjs', import.meta.url))
const ENABLED_ENV = 'DSH_LINGEYE_ACL_PATCH'
const NODE_OPTIONS_MARK = 'lingeye-acl-patch'

/** Stable id of this DSH installation, used to isolate degraded-state files. */
function instanceId() {
  try {
    const entry = typeof process.argv[1] === 'string' && process.argv[1] ? process.argv[1] : process.cwd()
    return createHash('sha256').update(entry.toLowerCase()).digest('hex').slice(0, 16)
  } catch {
    return 'shared'
  }
}

/** Pick a writable directory that survives package upgrades. */
function stableDir() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const preferred = join(home, 'lingeye-acl-patch')
  if (!/\s/.test(preferred)) {
    mkdirSync(preferred, { recursive: true })
    return preferred
  }
  // NODE_OPTIONS splits on whitespace; a path with spaces cannot be used there.
  const fallback = join(tmpdir(), 'dsh-lingeye-acl-patch')
  mkdirSync(fallback, { recursive: true })
  return fallback
}

/** Copy the preload and a crash-proof bootstrap into the stable directory. */
function installStablePreload() {
  const dir = stableDir()
  const preload = join(dir, 'preload.cjs')
  copyFileSync(PACKAGE_PRELOAD, preload)
  const bootstrap = join(dir, 'bootstrap.cjs')
  const source = [
    "'use strict'",
    `if (process.env.${ENABLED_ENV} === '1') {`,
    '  try {',
    `    require(${JSON.stringify(preload)})`,
    '  } catch {',
    '    // The plugin may have been removed; never break unrelated Node children.',
    '  }',
    '}',
    '',
  ].join('\n')
  writeFileSync(bootstrap, source, 'utf8')
  return bootstrap
}

/** Remove our own entries while preserving unrelated NODE_OPTIONS. */
function ownArgsRemoved(current) {
  return current
    .split(/\s+/)
    .filter(Boolean)
    .filter(arg => !arg.includes(NODE_OPTIONS_MARK) && !arg.includes('acl-sandbox-patch'))
}

/** Point child Node processes at the stable bootstrap. */
function ensureNodeOptions(bootstrap) {
  const arg = `--require=${bootstrap}`
  const kept = ownArgsRemoved(process.env.NODE_OPTIONS ?? '')
  if (kept.includes(arg)) return
  const next = [...kept, arg]
  process.env.NODE_OPTIONS = next.join(' ')
}

/**
 * Install the workaround for this Host process.
 * @param ctx - host plugin context; owns the `NODE_OPTIONS` cleanup effect.
 * @param config - optional `{ enabled?: boolean }` deployment switch.
 */
export function apply(ctx, config) {
  if (process.platform !== 'win32') return
  if (config?.enabled === false) return
  // Loaded lazily so `enabled: false` really disables the workaround: requiring
  // the preload installs the koffi hook and api-table patch immediately.
  let preload
  try {
    preload = createRequire(import.meta.url)('../vendor/acl-sandbox-patch/preload.cjs')
  } catch {
    return
  }
  let bootstrap
  try {
    bootstrap = installStablePreload()
  } catch {
    return
  }
  try {
    process.env.DSH_ACL_SANDBOX_PATCH_INSTANCE ??= instanceId()
    preload.clearDegradedState()
  } catch {
    /* the workaround must never break plugin loading */
  }
  process.env[ENABLED_ENV] = '1'
  ensureNodeOptions(bootstrap)
  ctx.effect(() => () => {
    delete process.env[ENABLED_ENV]
    const kept = ownArgsRemoved(process.env.NODE_OPTIONS ?? '')
    if (kept.length === 0) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = kept.join(' ')
  }, 'lingeye:acl-patch')
  ctx.logger?.info('lingeye: Windows ACL sandbox workaround active (non-system-drive workspace)')
}
