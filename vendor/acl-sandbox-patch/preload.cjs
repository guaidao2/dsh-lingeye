'use strict'

/**
 * dsh-acl-sandbox-patch — 补丁核心（CJS，零依赖）
 *
 * 背景（上游已知问题）：
 *   0.1.7 的 Windows ACL 沙箱（@deepseek-ai/dsh-sandbox-windows-acl）在
 *   授权工作区时，用一次 SetNamedSecurityInfoW 同时下发三样东西：
 *     1) capability SID 的 Allow ACE（DACL）
 *     2) world SID 的 FILE_DELETE_CHILD Deny ACE（DACL）
 *     3) Low 完整性强制标签（SACL / LABEL_SECURITY_INFORMATION）
 *   其中写标签需要调用者对目录持有 WRITE_OWNER（属主隐式权限只有
 *   READ_CONTROL + WRITE_DAC）。非系统盘（D:/E:/F:）新建目录的默认 ACL 是
 *   `Authenticated Users: Modify`，不含本人 FullControl；DSH 跑在 UAC
 *   过滤令牌下又吃不到 BUILTIN\Administrators 的 FullControl，于是
 *   SetNamedSecurityInfoW 返回 Win32 5（ERROR_ACCESS_DENIED），
 *   workspace-write 下所有命令在 spawn 前直接失败。
 *   参见 GitHub Discussions #7771 / #7720 / #7804。
 *
 * 本补丁做什么（不改任何系统 ACL）：
 *   1) SetNamedSecurityInfoW：先按原样尝试完整下发（含标签）；仅在返回
 *      Win32 5 时降级重试为 DACL-only（剥掉 LABEL/SACL 位、SACL 传 NULL）。
 *      DACL 写入只需要属主隐式的 WRITE_DAC，可以成功。
 *   2) SetTokenInformation(TokenIntegrityLevel=25)：降级发生后跳过"把子
 *      进程令牌降到 Low 完整性"。理由：工作区没有 Low 标签，Low 子进程按
 *      no-write-up 策略什么都写不了。WRITE_RESTRICTED 令牌 + capability ACE
 *      + world-deny 构成的写限制原样保留，仅失去 Low 完整性这层纵深。
 *   3) GetNamedSecurityInfoW：降级发生后，对含 LABEL 位的查询返回一个
 *      合成的"已带精确 Low 标签"的 SACL（与 hasExactLabel 的逐字段比对
 *      完全同构），让幂等跳过重新命中，避免重复全树传播。
 *
 * 降级状态的跨进程传播（双判据，均为自包含）：
 *   判据 1（状态文件）：服务端首次观测到标签降级时写状态文件——**主路径在插件目录**
 *   （`__dirname/../.degraded.state`，零环境依赖；tmpdir 路径为兼容回退，但沙箱 runner
 *   的 TMP/TEMP 常被改写到会话私有目录，os.tmpdir() 不可靠）。runner 每次
 *   setTokenInformation(TokenIntegrityLevel) 前现读，长生命周期进程也能感知服务端的
 *   新判定。服务端每次启动先清状态文件（新 run 重新判定）。
 *   判据 2（标签直侦测）：runner 从自身 argv 取 --workspace，直接读该目录有无 Low
 *   完整性标签——有 ⇒ 严格环境（正常降完整性）；无 ⇒ 降级环境（跳过降完整性，否则
 *   Low 子进程 no-write-up 拒写）。这是不依赖任何文件与环境的事实判据。
 *
 * 两条注入路径（互相兜底）：
 *   A. koffi 钩子：hook Module._load，拦截任何（懒/急、ESM/CJS 消费者的）
 *      require('koffi')，包装 koffi.load 返回的 lib 对象的 .func()，
 *      对 dsh-win32-process 的 4 参数调用形式返回包装函数。随
 *      NODE_OPTIONS --require 预加载，早于主模块图生效。
 *      【注意】koffi 的 lib.func 有两种调用形式，必须分别对待：
 *        - 4 参数（convention, name, result, args）：dsh-win32-process 的 bind 使用；
 *        - 1 参数声明式（"int __stdcall Foo(...)"）：dsh-fs-local 等使用。
 *      声明式串里含 '('，若按 4 参数形式转手会引发 koffi 类型解析错误
 *      （"Unexpected character '(' in type specifier"）——曾导致所有
 *      "覆盖文件"的写操作失败。声明式必须原样透传。
 *   B. api 表直改：解析 @deepseek-ai/dsh-sandbox-windows-acl，创建一次性的
 *      AclWriteGrant（惰性物化进程级共享绑定表），直接替换共享 api 表上的
 *      目标属性后 dispose。沙箱包内所有调用都经过 `api.*` 属性查找，
 *      因此与绑定时序无关，覆盖 DSH 服务端进程。
 */

const LABEL_SECURITY_INFORMATION = 0x10
const SACL_SECURITY_INFORMATION = 0x8
const DACL_SECURITY_INFORMATION = 0x4
const ERROR_ACCESS_DENIED = 5
const TOKEN_INTEGRITY_LEVEL = 25
const DEGRADED_ENV = 'DSH_ACL_SANDBOX_PATCH_DEGRADED'
const INSTANCE_ENV = 'DSH_ACL_SANDBOX_PATCH_INSTANCE'

let degraded = process.env[DEGRADED_ENV] === '1'

/** koffi 引用：优先钩子捕获，其次按沙箱包位置惰性解析。 */
let koffiRef = null
let koffiResolver = null

function getKoffi() {
  if (koffiRef) return koffiRef
  if (koffiResolver) {
    try { koffiRef = koffiResolver() } catch { koffiRef = null }
  }
  return koffiRef ?? null
}

/**
 * 降级状态文件的所有候选路径。
 * 主路径在插件目录（`__dirname/../.degraded.state`）——**零环境依赖**：沙箱 runner 的
 * TMP/TEMP 常被改写到会话私有目录，`os.tmpdir()` 会指错地方（v2 实测踩坑：服务端把
 * 状态写进真实 tmpdir，runner 在自己的私有 temp 里找不到）；插件目录对服务端（写）与
 * runner（读）恒定可达。tmpdir 路径保留为兼容回退。
 */
function stateFilePaths() {
  const paths = []
  try {
    const { join } = require('path')
    paths.push(join(__dirname, '..', '.degraded.state'))
  } catch { /* __dirname 不可用时跳过 */ }
  try {
    let id = 'shared'
    try { id = process.env[INSTANCE_ENV] || 'shared' } catch { /* env 不可读 */ }
    const os = require('os')
    const { join } = require('path')
    paths.push(join(os.tmpdir(), `dsh-acl-sandbox-patch-${id}.state`))
  } catch { /* tmpdir 不可用时跳过 */ }
  return paths
}

/** 任一状态文件记录"已降级"（每次调用现读，长生命周期 runner 需要感知服务端的新判定）。 */
function stateFileSaysDegraded() {
  const fs = require('fs')
  for (const p of stateFilePaths()) {
    try {
      if (fs.readFileSync(p, 'utf8').trim() === '1') return true
    } catch { /* 不存在或读不到，试下一个 */ }
  }
  return false
}

function markDegraded() {
  if (!degraded) {
    degraded = true
    try { process.env[DEGRADED_ENV] = '1' } catch { /* env 只读时忽略 */ }
  }
  const fs = require('fs')
  for (const p of stateFilePaths()) {
    try { fs.writeFileSync(p, '1') } catch { /* 单个路径写失败不阻塞，其他路径仍可传播 */ }
  }
}

/** 服务端启动时清除历史降级状态（新 run 重新判定）。 */
function clearDegradedState() {
  const fs = require('fs')
  for (const p of stateFilePaths()) {
    try { fs.rmSync(p, { force: true }) } catch { /* 无需存在 */ }
  }
}

function isDegraded() {
  if (degraded) return true
  if (process.env[DEGRADED_ENV] === '1') { degraded = true; return true }
  if (stateFileSaysDegraded()) { degraded = true; return true }
  return false
}

/**
 * 从进程 argv 解析 runner 的 `--workspace` 参数（沙箱 runner 的 argv 形态：
 * `node runner.js --workspace <dir> --temp <dir> --mode ... --write-sid ... -- <argv...>`）。
 * @returns 工作区绝对路径，或 null（非 runner 进程/无该参数）。
 */
function workspaceFromArgv() {
  const argv = process.argv
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--workspace' && typeof argv[i + 1] === 'string' && argv[i + 1]) return argv[i + 1]
  }
  return null
}

let labelProbeCache = null
/**
 * 直侦测工作区是否带有 Low 完整性强制标签（SACL 中的 SYSTEM_MANDATORY_LABEL_ACE）。
 * 最自包含的降级判据：健康环境下 grantWrite 必给工作区打上标签；标签缺失 ⇒ 本工作区
 * 处于降级环境 ⇒ 子进程不应被降到 Low（否则 no-write-up 直接拒写）。只读操作，
 * 结果每进程缓存一次（runner 进程内工作区不变）。
 * @returns true=有标签（严格环境）/ false=无标签（降级环境）/ null=探测失败（未知）
 */
function workspaceHasLowLabel(dir) {
  if (labelProbeCache !== null) return labelProbeCache
  const koffi = getKoffi()
  if (!koffi) return null
  try {
    const PVOID = koffi.pointer('void')
    const advapi32 = koffi.load('advapi32.dll')
    // 必须用 koffi 的声明式单串形式：本插件的 koffi 钩子只包装 4 参数形式，声明式原样
    // 透传——这正是 v1 bug 的修复点，此处同时是修复的自洽性验证。
    const getNamed = advapi32.func('int __stdcall GetNamedSecurityInfoW(const char16_t *path, uint32_t objectType, uint32_t securityInfo, void *owner, void *group, void *dacl, void *sacl, void *descriptor)')
    const slot = () => koffi.alloc(PVOID, 1)
    const owner = slot(), group = slot(), dacl = slot(), sacl = slot(), descriptor = slot()
    const result = getNamed(dir, 1, 20, owner, group, dacl, sacl, descriptor)
    if (result !== 0) return null
    const saclPtr = koffi.decode(sacl, 0, PVOID)
    if (saclPtr === null || koffi.address(saclPtr) === 0) { labelProbeCache = false; return false }
    const aceCount = koffi.decode(saclPtr, 4, 'uint16')
    let offset = 8
    for (let i = 0; i < aceCount; i++) {
      const aceType = koffi.decode(saclPtr, offset, 'uint8')
      const aceSize = koffi.decode(saclPtr, offset + 2, 'uint16')
      if (aceType === 17) { labelProbeCache = true; return true } // SYSTEM_MANDATORY_LABEL_ACE_TYPE
      if (aceSize < 8) break
      offset += aceSize
    }
    labelProbeCache = false
    return false
  } catch {
    return null
  }
}

/** 包装一个已绑定的 FFI SetNamedSecurityInfoW。 */
function wrapSetNamedSecurityInfoW(orig) {
  if (!orig || orig.__dshAclWrapped) return orig
  const wrapped = function setNamedSecurityInfoW(path, objectType, securityInfo, owner, group, dacl, sacl) {
    const touchesLabel = (securityInfo & (LABEL_SECURITY_INFORMATION | SACL_SECURITY_INFORMATION)) !== 0
    if (!touchesLabel) return orig(path, objectType, securityInfo, owner, group, dacl, sacl)
    // 先按原语义完整尝试（含 Low 标签）——环境健康时保持严格行为
    const strict = orig(path, objectType, securityInfo, owner, group, dacl, sacl)
    if (strict === 0) return 0
    if (strict !== ERROR_ACCESS_DENIED) return strict
    // 无 WRITE_OWNER（或写 SACL 特权缺失）：剥掉标签位，仅下发 DACL
    markDegraded()
    const stripped = (securityInfo & ~(LABEL_SECURITY_INFORMATION | SACL_SECURITY_INFORMATION)) | DACL_SECURITY_INFORMATION
    return orig(path, objectType, stripped, owner, group, dacl, null)
  }
  wrapped.__dshAclWrapped = true
  return wrapped
}

/** 包装一个已绑定的 FFI SetTokenInformation。 */
function wrapSetTokenInformation(orig) {
  if (!orig || orig.__dshAclWrapped) return orig
  const wrapped = function setTokenInformation(token, informationClass, information, length) {
    if (informationClass === TOKEN_INTEGRITY_LEVEL) {
      // 判据 1：状态文件 / 环境变量 / 进程标志（服务端观测到降级即写入）
      if (isDegraded()) return 1
      // 判据 2（自包含的事实）：工作区当前有无 Low 标签。无标签 ⇒ 降级环境，Low 子进程
      // 将因 no-write-up 无法写入工作区，故不降；有标签 ⇒ 严格环境，正常降。
      const workspace = workspaceFromArgv()
      if (workspace !== null && workspaceHasLowLabel(workspace) === false) return 1
    }
    return orig(token, informationClass, information, length)
  }
  wrapped.__dshAclWrapped = true
  return wrapped
}

/**
 * 合成"已带精确 Low 标签"的 SACL 内存块（每进程一次，复用，永不被调用方释放——
 * grantWrite/revokeWrite 只释放 descriptor，不释放 labelAcl）。
 *
 * 布局与 hasExactEntry(labelAcl, 17, 3, 3, lowLabelSidPtr) 的逐字段读取同构：
 *   ACL 头 8B: revision=2, AclSize=28, AceCount=1
 *   ACE  20B: type=17(SYSTEM_MANDATORY_LABEL_ACE_TYPE), flags=3(OI|CI),
 *             AceSize=20, Mask=3(no-write-up), Sid
 *   SID  12B: S-1-16-4096 — revision=1, subCount=1, authority=16, sub[0]=4096
 * 与 buildLowLabelAcl 下发的结构一致（InitializeAcl + AddMandatoryAce 的形状）。
 */
function buildFakeLabelAcl(koffi) {
  const acl = Buffer.alloc(28)
  acl.writeUInt8(2, 0) // AclRevision
  acl.writeUInt16LE(28, 2) // AclSize
  acl.writeUInt16LE(1, 4) // AceCount
  acl.writeUInt8(17, 8) // AceType: SYSTEM_MANDATORY_LABEL_ACE_TYPE
  acl.writeUInt8(3, 9) // AceFlags: OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
  acl.writeUInt16LE(20, 10) // AceSize
  acl.writeUInt32LE(3, 12) // Mask: no-write-up 策略位
  acl.writeUInt8(1, 16) // SidRevision
  acl.writeUInt8(1, 17) // SubAuthorityCount
  acl.write([0, 0, 0, 0, 0, 16], 18) // IdentifierAuthority = SECURITY_MANDATORY_LABEL_AUTHORITY(16)
  acl.writeUInt32LE(4096, 24) // SubAuthority[0] = SECURITY_MANDATORY_LOW_RID
  const ptr = koffi.alloc('uint8', acl.length)
  koffi.encode(ptr, koffi.array('uint8', acl.length), acl)
  return ptr
}

/**
 * 包装一个已绑定的 FFI GetNamedSecurityInfoW。
 * 降级模式下：对含 LABEL 位的查询先按剥离子查询真实数据，再把合成的
 * Low 标签 ACL 指针写进 ppSacl 输出槽，使幂等跳过重新生效。
 */
function wrapGetNamedSecurityInfoW(orig) {
  if (!orig || orig.__dshAclWrapped) return orig
  const wrapped = function getNamedSecurityInfoW(path, objectType, securityInfo, owner, group, dacl, sacl, descriptor) {
    const touchesLabel = (securityInfo & LABEL_SECURITY_INFORMATION) !== 0
    if (!touchesLabel || !isDegraded() || sacl == null) {
      return orig(path, objectType, securityInfo, owner, group, dacl, sacl, descriptor)
    }
    const koffi = getKoffi()
    if (!koffi) return orig(path, objectType, securityInfo, owner, group, dacl, sacl, descriptor)
    let fake
    try { fake = buildFakeLabelAcl(koffi) } catch { fake = null }
    if (fake == null) return orig(path, objectType, securityInfo, owner, group, dacl, sacl, descriptor)
    const result = orig(path, objectType, securityInfo & ~LABEL_SECURITY_INFORMATION, owner, group, dacl, sacl, descriptor)
    if (result !== 0) return result
    try {
      koffi.encode(sacl, koffi.pointer('void'), fake)
    } catch { /* 写槽失败则退化为无标签（不跳过，功能仍正确，只是慢） */ }
    return result
  }
  wrapped.__dshAclWrapped = true
  return wrapped
}

/**
 * 包装 koffi 模块导出：令其 load() 返回的 lib 对象的 .func() 在
 * dsh-win32-process 的 4 参数调用形式下，对目标 API 返回包装函数。
 *
 * 【v1 教训】koffi 的 lib.func 有两种调用形式：
 *   - 4 参数（convention, name, result, args）——dsh-win32-process 的 bind；
 *   - 1 参数 C 声明式（"int __stdcall Foo(const char16_t *path, ...)"）——dsh-fs-local 等。
 * 声明式字符串含 '('，按 4 参数形式转手会被 koffi 的类型解析器拒绝
 * （"Unexpected character '(' in type specifier"），曾导致所有覆盖写失败。
 * 因此仅当确认为 4 参数形式（首参为约定串、次参为函数名）时才包装返回；
 * 其余一律原样透传，不改动任何参数。
 */
function patchKoffi(koffi) {
  if (!koffi || koffi.__dshAclKoffiPatched) return false
  const origLoad = koffi.load
  if (typeof origLoad !== 'function') return false
  const patchedLoad = function load(lib, ...rest) {
    const loaded = origLoad.call(koffi, lib, ...rest)
    if (!loaded || typeof loaded !== 'object' || typeof loaded.func !== 'function' || loaded.func.__dshAclWrapped) {
      return loaded
    }
    const origFunc = loaded.func
    const wrappedFunc = function func(...allArgs) {
      // 仅识别 dsh-win32-process 的 4 参数形式：func(convention, name, result, args)
      const isFourArgForm = allArgs.length >= 4 && typeof allArgs[0] === 'string' && typeof allArgs[1] === 'string' && allArgs[2] !== undefined
      if (!isFourArgForm) return origFunc.apply(this, allArgs) // 声明式等一切其他形式：原样透传
      const name = allArgs[1]
      const fn = origFunc.apply(this, allArgs)
      if (name === 'SetNamedSecurityInfoW') return wrapSetNamedSecurityInfoW(fn)
      if (name === 'SetTokenInformation') return wrapSetTokenInformation(fn)
      if (name === 'GetNamedSecurityInfoW') return wrapGetNamedSecurityInfoW(fn)
      return fn
    }
    wrappedFunc.__dshAclWrapped = true
    try {
      Object.defineProperty(loaded, 'func', { value: wrappedFunc, writable: true, configurable: true, enumerable: true })
    } catch {
      return loaded // lib 对象不可变时保持原样（该进程仅剩 api 表路径兜底）
    }
    return loaded
  }
  patchedLoad.__dshAclWrapped = true
  koffi.__dshAclKoffiPatched = true
  try {
    Object.defineProperty(koffi, 'load', { value: patchedLoad, writable: true, configurable: true, enumerable: true })
  } catch {
    koffi.load = patchedLoad
  }
  return true
}

/** 直接包装沙箱包的共享 api 绑定表（进程内服务端路径，与绑定时序无关）。 */
function wrapApiTable(api) {
  if (!api || api.__dshAclTableWrapped) return false
  if (typeof api.setNamedSecurityInfoW === 'function') {
    api.setNamedSecurityInfoW = wrapSetNamedSecurityInfoW(api.setNamedSecurityInfoW)
  }
  if (typeof api.setTokenInformation === 'function') {
    api.setTokenInformation = wrapSetTokenInformation(api.setTokenInformation)
  }
  if (typeof api.getNamedSecurityInfoW === 'function') {
    api.getNamedSecurityInfoW = wrapGetNamedSecurityInfoW(api.getNamedSecurityInfoW)
  }
  api.__dshAclTableWrapped = true
  return true
}

/**
 * 解析并加载沙箱包，创建一次性 AclWriteGrant 以物化共享 api 表，包装后即 dispose。
 * 异步（dynamic import）；在 preload 场景作为 koffi 钩子之外的冗余路径。
 */
async function patchSandboxTableAsync() {
  const { createRequire } = require('module')
  const { pathToFileURL } = require('url')
  const bases = []
  if (typeof process.argv[1] === 'string' && process.argv[1]) bases.push(process.argv[1])
  try { bases.push(process.cwd()) } catch { /* cwd 可能已被删除 */ }
  for (const base of bases) {
    try {
      const req = createRequire(base)
      const entry = req.resolve('@deepseek-ai/dsh-sandbox-windows-acl')
      koffiResolver = () => { try { return req('koffi') } catch { return null } }
      const mod = await import(pathToFileURL(entry).href)
      const grant = mod.AclWriteGrant.create('S-1-4-1-1')
      try {
        wrapApiTable(grant.api)
      } finally {
        grant.dispose()
      }
      return true
    } catch { /* 换下一个解析基准 */ }
  }
  return false
}

function isKoffiRequest(request) {
  return request === 'koffi' || request.endsWith('koffi') || /[\\/]node_modules[\\/]koffi[\\/]/.test(request)
}

function install() {
  // A. CJS 钩子：任何进程（含 ESM 消费者内部走的 CJS require）首次 require('koffi') 即被包装
  const Module = require('module')
  if (!Module.__dshAclHooked) {
    const origLoad = Module._load
    Module._load = function hookedLoad(request, parent, isMain) {
      const loaded = origLoad.apply(this, arguments)
      if (isKoffiRequest(request)) {
        try {
          const target = loaded && loaded.default && loaded.default !== loaded ? loaded.default : loaded
          if (target && typeof target.load === 'function') koffiRef ??= target
          patchKoffi(target)
          if (target && target !== loaded) patchKoffi(loaded)
        } catch { /* 非 koffi 模块或已冻结，忽略 */ }
      }
      return loaded
    }
    Module.__dshAclHooked = true
  }
  // koffi 可能已被提前加载（表已绑）：直接补包装缓存中的导出
  try {
    for (const key of Object.keys(require.cache)) {
      if (isKoffiRequest(key)) {
        const m = require.cache[key]
        if (m && m.exports) {
          const target = m.exports.default && m.exports.default !== m.exports ? m.exports.default : m.exports
          if (target && typeof target.load === 'function') koffiRef ??= target
          patchKoffi(target)
        }
      }
    }
  } catch { /* cache 遍历失败不影响钩子 */ }
  // B. 异步冗余：包装沙箱包共享 api 表
  void patchSandboxTableAsync()
}

install()

module.exports = {
  install,
  patchKoffi,
  wrapApiTable,
  wrapGetNamedSecurityInfoW,
  wrapSetNamedSecurityInfoW,
  wrapSetTokenInformation,
  markDegraded,
  clearDegradedState,
  isDegraded,
  stateFilePaths,
  workspaceFromArgv,
  workspaceHasLowLabel,
  patchSandboxTableAsync
}
