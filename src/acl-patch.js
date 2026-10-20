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
 * Disable it per deployment by overriding this row with `config.enabled: false`.
 *
 * @module dsh-lingeye/acl-patch
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader entry name. */
export const name = 'lingeye-acl-patch'

const PRELOAD = fileURLToPath(new URL('../vendor/acl-sandbox-patch/preload.cjs', import.meta.url))

/** Stable id of this DSH installation, used to isolate degraded-state files. */
function instanceId() {
  try {
    const entry = typeof process.argv[1] === 'string' && process.argv[1] ? process.argv[1] : process.cwd()
    return createHash('sha256').update(entry.toLowerCase()).digest('hex').slice(0, 16)
  } catch {
    return 'shared'
  }
}

/** NODE_OPTIONS splits on whitespace, so the preload path must not contain any. */
function pickPreloadPath() {
  if (!/\s/.test(PRELOAD)) return PRELOAD
  try {
    const dir = join(tmpdir(), 'dsh-lingeye-acl-patch')
    mkdirSync(dir, { recursive: true })
    const copy = join(dir, 'preload.cjs')
    copyFileSync(PRELOAD, copy)
    return copy
  } catch {
    return PRELOAD
  }
}

/** Preload the patch in every Node child this process spawns. */
function ensureNodeOptions() {
  const arg = `--require=${pickPreloadPath()}`
  const current = (process.env.NODE_OPTIONS ?? '').trim()
  if (current.includes(arg)) return
  process.env.NODE_OPTIONS = current ? `${current} ${arg}` : arg
}

/**
 * Install the workaround for this Host process.
 * @param ctx - host plugin context (unused: the patch is process-global).
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
  try {
    process.env.DSH_ACL_SANDBOX_PATCH_INSTANCE ??= instanceId()
    preload.clearDegradedState()
  } catch {
    /* the workaround must never break plugin loading */
  }
  ensureNodeOptions()
  ctx.logger?.info('lingeye: Windows ACL sandbox workaround active (non-system-drive workspace)')
}
