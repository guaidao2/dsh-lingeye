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
 * The preload is copied to a stable `$DSH_HOME/lingeye-acl-patch/` directory,
 * and both the Host and its child Node processes load that same copy; the
 * degraded-state file therefore stays shared. `NODE_OPTIONS` points at a
 * generated bootstrap there, never at this package, so a package upgrade or
 * removal cannot leave children pointing at a deleted file. The bootstrap
 * checks an env flag and swallows a missing preload. Unloading the plugin
 * removes our own `NODE_OPTIONS` entry so later children stay untouched.
 *
 * If no whitespace-free directory is available the workaround fails closed:
 * it logs and installs nothing rather than risk a broken `NODE_OPTIONS`.
 *
 * Disable it per deployment by overriding this row with `config.enabled: false`.
 *
 * @module dsh-lingeye/acl-patch
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader entry name. */
export const name = 'lingeye-acl-patch'

const PACKAGE_PRELOAD = fileURLToPath(new URL('../vendor/acl-sandbox-patch/preload.cjs', import.meta.url))
const ENABLED_ENV = 'DSH_LINGEYE_ACL_PATCH'

/**
 * Whether one `--require` token belongs to this plugin's ACL workaround.
 * Matches only our stable directory or the old `dsh-lingeye/vendor/...`
 * package path so an independently installed upstream patch is preserved.
 * @param token - one whitespace-separated NODE_OPTIONS token.
 * @returns whether the token is ours.
 */
function isOwnArg(token) {
  if (!token.startsWith('--require=')) return false
  const value = token.slice('--require='.length).replace(/^"|"$/g, '')
  if (value.includes('lingeye-acl-patch')) return true
  return value.includes('dsh-lingeye')
    && value.includes('acl-sandbox-patch')
    && value.includes('preload.cjs')
}

/**
 * Remove this plugin's entries from a NODE_OPTIONS string while preserving
 * unrelated options and quoted values.
 * @param current - current NODE_OPTIONS value.
 * @returns the remaining tokens.
 */
export function stripOwnNodeOptions(current) {
  const tokens = current.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  return tokens.filter(token => !isOwnArg(token))
}

/**
 * Render the bootstrap that child Node processes preload.
 * @param preloadPath - absolute path of the stable preload copy.
 * @returns CommonJS source for the bootstrap.
 */
export function bootstrapSource(preloadPath) {
  return [
    "'use strict'",
    `if (process.env.${ENABLED_ENV} === '1') {`,
    '  try {',
    `    require(${JSON.stringify(preloadPath)})`,
    '  } catch {',
    '    // The plugin may have been removed; never break unrelated Node children.',
    '  }',
    '}',
    '',
  ].join('\n')
}

/** Stable id of this DSH installation, used to isolate degraded-state files. */
function instanceId() {
  try {
    const entry = typeof process.argv[1] === 'string' && process.argv[1] ? process.argv[1] : process.cwd()
    return createHash('sha256').update(entry.toLowerCase()).digest('hex').slice(0, 16)
  } catch {
    return 'shared'
  }
}

/** Pick a writable, whitespace-free directory that survives package upgrades. */
function stableDir() {
  const candidates = [
    process.env.DSH_HOME ? join(process.env.DSH_HOME, 'lingeye-acl-patch') : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'dsh-lingeye-acl-patch') : undefined,
  ]
  for (const dir of candidates) {
    if (dir === undefined || /\s/.test(dir)) continue
    try {
      mkdirSync(dir, { recursive: true })
      return dir
    } catch {
      /* try the next candidate */
    }
  }
  return undefined
}

/** Replace a file atomically so a concurrent child never reads a partial write. */
function writeAtomic(path, content) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}

/** Copy the preload and bootstrap into the stable directory. */
function installStablePreload(dir) {
  const preload = join(dir, 'preload.cjs')
  const preloadTemporary = `${preload}.${process.pid}.tmp`
  copyFileSync(PACKAGE_PRELOAD, preloadTemporary)
  renameSync(preloadTemporary, preload)
  const bootstrap = join(dir, 'bootstrap.cjs')
  writeAtomic(bootstrap, bootstrapSource(preload))
  return { preload, bootstrap }
}

/** Point child Node processes at the stable bootstrap, replacing old entries. */
function ensureNodeOptions(bootstrap) {
  const arg = `--require=${bootstrap}`
  const kept = stripOwnNodeOptions(process.env.NODE_OPTIONS ?? '')
  if (!kept.includes(arg)) kept.push(arg)
  process.env.NODE_OPTIONS = kept.join(' ')
}

/**
 * Install the workaround for this Host process.
 * @param ctx - host plugin context; owns the `NODE_OPTIONS` cleanup effect.
 * @param config - optional `{ enabled?: boolean }` deployment switch.
 */
export function apply(ctx, config) {
  if (process.platform !== 'win32') return
  if (config?.enabled === false) return
  const dir = stableDir()
  if (dir === undefined) {
    ctx.logger?.warn('lingeye: ACL workaround skipped (no whitespace-free state directory)')
    return
  }
  let stable
  try {
    stable = installStablePreload(dir)
  } catch {
    ctx.logger?.warn('lingeye: ACL workaround skipped (cannot write the stable preload)')
    return
  }
  // The Host loads the same copy as every child so `clearDegradedState` and
  // the degraded-state file are shared rather than split across two copies.
  let preload
  try {
    preload = createRequire(import.meta.url)(stable.preload)
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
  ensureNodeOptions(stable.bootstrap)
  ctx.effect(() => () => {
    delete process.env[ENABLED_ENV]
    const kept = stripOwnNodeOptions(process.env.NODE_OPTIONS ?? '')
    if (kept.length === 0) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = kept.join(' ')
  }, 'lingeye:acl-patch')
  ctx.logger?.info('lingeye: Windows ACL sandbox workaround active (non-system-drive workspace)')
}
