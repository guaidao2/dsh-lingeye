/**
 * Shared store service for the 灵眼 mode.
 *
 * Owns the `lingeye` storage domain and exposes engagement operations to the
 * preset-scoped tool rows. The service is mounted once at the profile root so
 * every preset (commander / worker / retest) shares one authoritative store;
 * tool rows only wrap these methods in model-facing contracts.
 *
 * Per-session write serialization keeps deterministic ids (`<kind>-<n>`) and
 * referential checks consistent under concurrent subagent submissions.
 *
 * @module dsh-lingeye/store
 */

import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  lingeyeDomainSpec,
  ASSET_TYPES,
  FACT_BASES,
  FACT_KINDS,
  FINDING_STATES,
  SEVERITIES,
  EDGE_KINDS,
} from './spec.js'
import { registerProjection } from './projection.js'
import { cleanRecordPayload, trimProjectionState } from './payload.js'
import { buildReport, buildExportBundle } from './report.js'

/** Node/browser-neutral timestamp. */
function now() {
  return new Date().toISOString()
}

/** Recorded key of one session-scoped record. */
function recordKey(sessionId, id) {
  return `${sessionId}:${id}`
}

/** Id prefix of each record kind. */
const ID_PREFIX = {
  goal: 'goal',
  intent: 'intent',
  fact: 'fact',
  finding: 'finding',
  hint: 'hint',
  asset: 'asset',
  edge: 'edge',
  flow: 'flow',
  evidence: 'evidence',
  activity: 'activity',
  retest: 'retest',
  constraint: 'constraint',
  path: 'path',
}

/** Table owning each record kind. */
const TABLE_OF = {
  goal: 'goals',
  intent: 'intents',
  fact: 'facts',
  finding: 'findings',
  hint: 'hints',
  asset: 'assets',
  edge: 'edges',
  flow: 'flows',
  evidence: 'evidence',
  activity: 'activity',
  retest: 'retests',
  constraint: 'constraints',
  path: 'attack_paths',
}

/** Every session-scoped table. */
const SESSION_TABLES = Object.values(TABLE_OF)

/** Normalize free text for duplicate-intent comparison. */
function normalizeTitle(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** Normalize an asset value into the dedupe identifier of its type. */
function normalizeAssetValue(type, value) {
  const v = String(value ?? '').trim()
  if (type === 'ip' || type === 'app' || type === 'service' || type === 'endpoint') {
    return v.toLowerCase()
  }
  return v.toLowerCase().replace(/\.$/, '')
}

/** Throw a guiding error when a required value is missing. */
function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

/** Clamp a confidence value into 0..1, percent strings included. */
export function confidenceOf(value, fallback = 0.7) {
  if (value === undefined || value === null || value === '') return fallback
  const text = typeof value === 'string' ? value.trim() : ''
  const percent = text.endsWith('%')
  const parsed = typeof value === 'number' ? value : Number(percent ? text.slice(0, -1) : text)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('confidence must be 0..1 or a percentage')
  if (percent || parsed > 1) {
    if (parsed > 100) throw new Error('confidence percentage must be 0..100')
    return parsed / 100
  }
  return parsed
}

/**
 * Assets considered tested: a finding anchors the asset, or a fact anchors it
 * with at least one evidence record. A fact without evidence is a belief
 * update, not a test — counting it as coverage would report a false signal.
 */
export function coveredAssetIds(data) {
  const tested = new Set()
  for (const fact of data.facts ?? []) {
    if ((fact.evidenceIds ?? []).length === 0) continue
    for (const assetId of fact.assetIds ?? []) tested.add(assetId)
  }
  for (const finding of data.findings ?? []) {
    for (const assetId of finding.assetIds ?? []) tested.add(assetId)
  }
  return tested
}

/** The 灵眼 store service (`ctx.lingeyeStore`). */
export default class LingeyeStore extends Service {
  static inject = ['storageDomain', 'sessions']
  /** Plugin config: opt-in event-driven dispatcher. */
  static Config = z.object({
    autoDispatch: z.boolean().default(false),
    maxWorkers: z.number().default(2),
    debounceMs: z.number().default(800),
  })

  constructor(ctx, config = {}) {
    super(ctx, 'lingeyeStore')
    this.domainPromise = undefined
    this.sessionQueues = new Map()
    this.counters = new Map()
    this.autoDispatch = config?.autoDispatch === true
    this.maxAutoWorkers = Number.isInteger(config?.maxWorkers) && config.maxWorkers > 0 ? config.maxWorkers : 2
    this.dispatchDebounceMs = Number.isInteger(config?.debounceMs) && config.debounceMs >= 100 ? config.debounceMs : 800
    this.dispatched = new Map()
    this.autoAttempts = new Map()
    this.dispatchTimer = undefined
    this.publishTimers = new Map()
    this.publishQueues = new Map()
    this.publishRetries = new Map()
    this.retryTimers = new Map()
    this.publishedPayloads = new Map()
    this.publishModule = undefined
    ctx.effect(() => async () => {
      const pending = this.domainPromise
      this.domainPromise = undefined
      await Promise.all([...this.sessionQueues.values()])
      this.sessionQueues.clear()
      this.counters.clear()
      this.dispatched.clear()
      this.autoAttempts.clear()
      for (const timer of this.publishTimers.values()) clearTimeout(timer)
      this.publishTimers.clear()
      for (const timer of this.retryTimers.values()) clearTimeout(timer)
      this.retryTimers.clear()
      this.publishQueues.clear()
      this.publishRetries.clear()
      this.publishedPayloads.clear()
      if (pending !== undefined) await (await pending).close()
    }, 'lingeye:domain')
    registerProjection(ctx)
    if (this.autoDispatch) {
      ctx.inject(['agents', 'subagents'], scope => this.startDispatcher(scope))
    }
  }

  /**
   * Coalesce write bursts into one publish. The projection folds the record;
   * no model turn or client fetch is involved.
   * @param sessionId - session whose state changed.
   */
  schedulePublish(sessionId) {
    if (this.publishTimers.has(sessionId)) return
    const retry = this.retryTimers.get(sessionId)
    if (retry !== undefined) {
      clearTimeout(retry)
      this.retryTimers.delete(sessionId)
    }
    const timer = setTimeout(() => {
      this.publishTimers.delete(sessionId)
      void this.publishState(sessionId)
    }, 250)
    this.publishTimers.set(sessionId, timer)
  }

  /**
   * Serialize publish attempts for one session so a slow snapshot cannot land
   * an older state after a newer one.
   * @param sessionId - session whose state changed.
   * @returns the queued attempt.
   */
  publishState(sessionId) {
    const previous = this.publishQueues.get(sessionId) ?? Promise.resolve()
    const current = previous.then(
      () => this.publishLatest(sessionId),
      () => this.publishLatest(sessionId),
    )
    const settled = current.then(() => undefined, () => undefined)
    this.publishQueues.set(sessionId, settled)
    settled.then(() => {
      if (this.publishQueues.get(sessionId) === settled) this.publishQueues.delete(sessionId)
    })
    return current
  }

  /**
   * Append one whole-state plugin record to the live session log.
   * @param sessionId - session whose state changed.
   */
  async publishLatest(sessionId) {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return
    try {
      const state = await this.enqueue(sessionId, () => this.snapshot(sessionId), false)
      if (state.engagement === null) return
      const trimmed = trimProjectionState(state)
      const payload = cleanRecordPayload({
        ...trimmed,
        counts: this.summarise(trimmed),
        report: buildReport(trimmed),
        initialized: true,
      })
      if (payload === undefined) {
        this.ctx.logger?.warn('lingeye state publish skipped: snapshot is not JSON-serializable')
        return
      }
      const serialized = JSON.stringify(payload)
      if (this.publishedPayloads.get(sessionId) === serialized) return
      payload.updatedAt = now()
      this.publishModule ??= import('@deepseek-ai/dsh-session')
      this.publishModule.catch(() => {
        this.publishModule = undefined
      })
      const { appendPluginRecord } = await this.publishModule
      appendPluginRecord(session, 'plugin:lingeye/state', payload)
      this.publishedPayloads.set(sessionId, serialized)
      try {
        await this.pruneProjectTombstones(sessionId, state.engagement?.projectId ?? '')
      } catch (error) {
        this.ctx.logger?.warn(`lingeye tombstone prune failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.publishRetries.delete(sessionId)
      const retry = this.retryTimers.get(sessionId)
      if (retry !== undefined) {
        clearTimeout(retry)
        this.retryTimers.delete(sessionId)
      }
    } catch (error) {
      this.ctx.logger?.warn(`lingeye state publish failed: ${error instanceof Error ? error.message : String(error)}`)
      const attempts = (this.publishRetries.get(sessionId) ?? 0) + 1
      this.publishRetries.set(sessionId, attempts)
      if (attempts <= 3 && !this.retryTimers.has(sessionId)) {
        const timer = setTimeout(() => {
          this.retryTimers.delete(sessionId)
          void this.publishState(sessionId)
        }, 2000)
        this.retryTimers.set(sessionId, timer)
      }
    }
  }

  /** Mount the optional event-driven dispatcher (config.autoDispatch). */
  startDispatcher(scope) {
    this.dispatchScope = scope
    this.dispatchDiagnostics = { mounted: true, scheduled: 0, runs: 0, engagements: 0, liveAgents: 0, candidates: 0, started: 0, lastError: '' }
    scope.effect(() => () => {
      if (this.dispatchTimer !== undefined) clearTimeout(this.dispatchTimer)
      this.dispatchTimer = undefined
      this.dispatchScope = undefined
    }, 'lingeye:dispatch-timer')
    scope.on('domain/changed', (change) => {
      if (change?.domain === 'lingeye') this.scheduleDispatch()
    })
    this.scheduleDispatch()
  }

  /** Coalesce storage changes into one dispatch pass. */
  scheduleDispatch() {
    if (!this.autoDispatch || this.dispatchTimer !== undefined) return
    if (this.dispatchDiagnostics !== undefined) this.dispatchDiagnostics.scheduled += 1
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = undefined
      void this.dispatchPending()
    }, this.dispatchDebounceMs)
  }

  /** Run one dispatch pass now (also used by the status tool). */
  async dispatchNow() {
    await this.dispatchPending()
    return this.dispatchDiagnostics ?? { mounted: false }
  }

  /** Dispatch one worker for every ready open intent (bounded). */
  async dispatchPending() {
    const diagnostics = this.dispatchDiagnostics
    if (diagnostics !== undefined) {
      diagnostics.runs += 1
      diagnostics.lastError = ''
    }
    const domain = await this.domain()
    for (const [, engagement] of domain.table('engagements').entries()) {
      if (engagement.status !== 'active') continue
      if (diagnostics !== undefined) diagnostics.engagements += 1
      try {
        await this.dispatchOne(engagement)
      } catch (error) {
        if (diagnostics !== undefined) diagnostics.lastError = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn(`lingeye dispatcher: ${diagnostics?.lastError}`)
      }
    }
  }

  /** Dispatch up to the worker budget for one engagement. */
  async dispatchOne(engagement) {
    const diagnostics = this.dispatchDiagnostics
    const sessionId = engagement.sessionId
    const running = this.dispatched.get(sessionId) ?? new Set()
    if (running.size >= this.maxAutoWorkers) return
    const parent = this.dispatchScope?.agents.get(sessionId)
    if (parent === undefined) return
    if (diagnostics !== undefined) diagnostics.liveAgents += 1
    const data = await this.snapshot(sessionId)
    const factIds = new Set(data.facts.map(fact => fact.id))
    const candidates = data.intents.filter(intent =>
      intent.state === 'open'
      && !running.has(intent.id)
      && intent.derivedFromFactIds.every(factId => factIds.has(factId)))
    if (diagnostics !== undefined) diagnostics.candidates += candidates.length
    for (const intent of candidates) {
      if (running.size >= this.maxAutoWorkers) break
      const key = `${sessionId}:${intent.id}`
      if ((this.autoAttempts.get(key) ?? 0) >= 1) continue
      this.autoAttempts.set(key, 1)
      running.add(intent.id)
      this.dispatched.set(sessionId, running)
      try {
        const controller = new AbortController()
        const activation = await this.dispatchScope.subagents.startActivation({
          provider: 'spawn',
          label: `lingeye ${intent.id}`,
          delivery: 'parent',
          signal: controller.signal,
          request: {
            parent,
            agentPreset: 'lingeye-worker',
            prompt: [{ type: 'text', text: this.dispatchPrompt(data, intent) }],
          },
        })
        void activation.result
          .then(() => undefined, () => undefined)
          .finally(() => {
            running.delete(intent.id)
            void activation.dispose().catch(() => undefined)
            this.scheduleDispatch()
          })
        await this.activity(sessionId, {
          intentId: intent.id,
          worker: 'dispatcher',
          kind: 'dispatch',
          summary: `自动派发 ${intent.id}：${intent.title}`,
        })
        if (diagnostics !== undefined) diagnostics.started += 1
      } catch (error) {
        running.delete(intent.id)
        if (diagnostics !== undefined) diagnostics.lastError = error instanceof Error ? error.message : String(error)
        this.ctx.logger?.warn(`lingeye auto-dispatch ${intent.id}: ${diagnostics?.lastError}`)
      }
    }
  }

  /** Build the worker prompt for one auto-dispatched intent. */
  dispatchPrompt(data, intent) {
    const engagement = data.engagement
    const facts = data.facts
      .filter(fact => fact.intentId === intent.id || intent.derivedFromFactIds.includes(fact.id))
      .slice(-20)
      .map(fact => `- ${fact.id} [${fact.basis}] ${fact.detail}（置信度 ${fact.confidence}）`)
      .join('\n') || '（无）'
    const assets = data.assets
      .filter(asset => intent.assetIds.includes(asset.id))
      .map(asset => `- ${asset.id} ${asset.type} ${asset.value}`)
      .join('\n') || '（无）'
    const hints = data.hints.filter(hint => hint.state === 'active').slice(-8).map(hint => `- ${hint.text}`).join('\n') || '（无）'
    const constraints = data.constraints.filter(item => item.active).map(item => `- [${item.kind}] ${item.text}`).join('\n') || '（无）'
    return [
      '这是灵眼调度器自动派发的一条执行任务。',
      `父 intentId: ${intent.id}`,
      `标题: ${intent.title}`,
      `详情: ${intent.detail || '（无）'}`,
      `预期观测: ${intent.expectedObservation || '（无）'}`,
      `目标: ${engagement.target}`,
      `目的: ${engagement.objective}`,
      `授权: ${engagement.authorization || '（未声明）'}`,
      `范围: ${engagement.scope || '（未声明）'}`,
      '已知事实:',
      facts,
      '相关资产:',
      assets,
      '活跃提示:',
      hints,
      '约束:',
      constraints,
      '执行要求：先调用 ly_fetch 读取上下文；用真实工具验证；每确认一组结果就 ly_submit（事实带 basis，漏洞必须带可复现步骤与证据）；',
      '没有实际观测时把 basis 标为 assumed，不得声称已实测。完成后只回复结论与提交计数。',
    ].join('\n')
  }

  /** Resolve the opened domain, opening it lazily on first use. */
  async domain() {
    if (this.domainPromise === undefined) {
      this.domainPromise = this.ctx.storageDomain.open(lingeyeDomainSpec)
    }
    return this.domainPromise
  }

  /** Serialize one read/allocate/write transaction for a session. */
  enqueue(sessionId, operation, publish = true) {
    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve()
    const current = previous.then(operation)
    const settled = current.then(() => undefined, () => undefined)
    this.sessionQueues.set(sessionId, settled)
    if (publish) {
      current.then(
        () => this.schedulePublish(sessionId),
        () => undefined,
      )
    }
    return current
  }

  /** Rebuild the per-session id counters from durable records on first touch. */
  async countersFor(sessionId) {
    let counters = this.counters.get(sessionId)
    if (counters !== undefined) return counters
    counters = new Map()
    const domain = await this.domain()
    for (const tableName of SESSION_TABLES) {
      for (const [, row] of domain.table(tableName).entries()) {
        if (row.sessionId !== sessionId) continue
        const match = /^([a-z]+)-(\d+)$/.exec(row.id)
        if (match === null) continue
        const seq = Number(match[2])
        counters.set(match[1], Math.max(counters.get(match[1]) ?? 0, seq))
      }
    }
    this.counters.set(sessionId, counters)
    return counters
  }

  /** Deterministic next id for one kind in one session. */
  async nextId(sessionId, kind) {
    const counters = await this.countersFor(sessionId)
    const next = (counters.get(kind) ?? 0) + 1
    counters.set(kind, next)
    return `${ID_PREFIX[kind]}-${next}`
  }

  /** All session-scoped rows of one table. */
  async rows(sessionId, tableName) {
    const domain = await this.domain()
    return [...domain.table(tableName).entries()]
      .map(([, row]) => row)
      .filter(row => row.sessionId === sessionId)
  }

  /** One session-scoped record, or undefined. */
  async record(sessionId, kind, id) {
    if (typeof id !== 'string' || id === '') return undefined
    const domain = await this.domain()
    return domain.table(TABLE_OF[kind]).get(recordKey(sessionId, id))
  }

  /** Delete every session-scoped record (mode restart). */
  async clearSession(sessionId) {
    const domain = await this.domain()
    for (const tableName of SESSION_TABLES) {
      const table = domain.table(tableName)
      for (const [key, row] of table.entries()) {
        if (row.sessionId === sessionId) await table.delete(key)
      }
    }
    const engagementTable = domain.table('engagements')
    await engagementTable.delete(sessionId)
    this.counters.delete(sessionId)
  }

  /** Read the engagement of one session. */
  async engagement(sessionId) {
    const domain = await this.domain()
    return domain.table('engagements').get(sessionId)
  }

  /** Full serializable state of one engagement. */
  async snapshot(sessionId) {
    const engagement = await this.engagement(sessionId)
    const data = {}
    for (const [kind, tableName] of Object.entries(TABLE_OF)) {
      if (kind === 'edge') continue
      data[tableName] = await this.rows(sessionId, tableName)
    }
    data.edges = await this.rows(sessionId, 'edges')
    data.attackPaths = await this.rows(sessionId, TABLE_OF.path)
    const tombstones = await this.domain()
    data.projectTombstones = [...tombstones.table('project_tombstones').entries()].map(([, row]) => ({ sessionId: row.sessionId, projectId: row.projectId }))
    data.engagement = engagement ?? null
    return data
  }

  /** Counts summarized for model and UI consumers. */
  summarise(data) {
    return {
      goals: data.goals.length,
      intents: data.intents.length,
      facts: data.facts.length,
      findings: data.findings.length,
      assets: data.assets.length,
      evidence: data.evidence.length,
      flows: data.flows.length,
      retests: data.retests.length,
    }
  }

  /** Record one activity row. */
  async activity(sessionId, row) {
    const id = await this.nextId(sessionId, 'activity')
    const record = {
      id,
      sessionId,
      intentId: row.intentId,
      worker: row.worker ?? '',
      kind: row.kind ?? 'note',
      tool: row.tool ?? '',
      summary: row.summary ?? '',
      detail: row.detail ?? '',
      createdAt: now(),
    }
    const domain = await this.domain()
    await domain.table('activity').put(recordKey(sessionId, id), record)
    return record
  }

  /** Record one activity row through the serialized write chain. */
  async addActivity(sessionId, row) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      return this.activity(sessionId, row)
    })
  }

  /** Start (or reset) an engagement for one session. */
  async start(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      await this.clearSession(sessionId)
      this.dispatched.delete(sessionId)
      this.publishedPayloads.delete(sessionId)
      this.publishRetries.delete(sessionId)
      const resetRetry = this.retryTimers.get(sessionId)
      if (resetRetry !== undefined) {
        clearTimeout(resetRetry)
        this.retryTimers.delete(sessionId)
      }
      for (const key of [...this.autoAttempts.keys()]) {
        if (key.startsWith(`${sessionId}:`)) this.autoAttempts.delete(key)
      }
      const engagement = {
        id: 'eng-1',
        sessionId,
        projectId: String(input.projectId ?? '').trim(),
        target: required(input.target, 'target'),
        objective: required(input.objective, 'objective'),
        authorization: input.authorization ?? '',
        scope: input.scope ?? '',
        status: 'active',
        createdAt: now(),
      }
      const domain = await this.domain()
      await domain.table('engagements').put(sessionId, engagement)
      if (engagement.projectId !== '') await domain.table('project_tombstones').delete(`${sessionId}:${engagement.projectId}`)
      const goalId = await this.nextId(sessionId, 'goal')
      await domain.table('goals').put(recordKey(sessionId, goalId), {
        id: goalId,
        sessionId,
        text: engagement.objective,
        vulnclass: '',
        status: 'open',
        evidenceIds: [],
        createdAt: now(),
      })
      for (const constraint of Array.isArray(input.constraints) ? input.constraints : []) {
        const kind = constraint.kind === 'allow' ? 'allow' : 'deny'
        const text = String(constraint.text ?? '').trim()
        if (text === '') continue
        const cid = await this.nextId(sessionId, 'constraint')
        await domain.table('constraints').put(recordKey(sessionId, cid), {
          id: cid, sessionId, kind, text, origin: 'user', active: true, createdAt: now(),
        })
      }
      await this.activity(sessionId, {
        kind: 'engagement',
        summary: `建立交战：${engagement.target}`,
        detail: engagement.objective,
      })
      return this.snapshot(sessionId)
    })
  }

  /** Attach the current engagement to a project grouping without moving data. */
  async linkProject(sessionId, projectId) {
    return this.enqueue(sessionId, async () => {
      const engagement = await this.engagement(sessionId)
      if (engagement === undefined) throw new Error('engagement is not initialized; call ly_start first')
      const next = { ...engagement, projectId: String(projectId ?? '').trim() }
      const domain = await this.domain()
      await domain.table('engagements').put(sessionId, next)
      if (next.projectId !== '') await domain.table('project_tombstones').delete(`${sessionId}:${next.projectId}`)
      return next
    })
  }

  /** Session ids currently attached to one project grouping. */
  async projectSessionIds(projectId) {
    const target = String(projectId ?? '').trim()
    if (target === '') return []
    const domain = await this.domain()
    const ids = []
    for (const [, engagement] of domain.table('engagements').entries()) {
      if (engagement.projectId === target) ids.push(engagement.sessionId)
    }
    return ids
  }

  /** Remove the grouping key from every session in one project; data is kept. */
  async unlinkProject(projectId, callerSessionId) {
    const target = String(projectId ?? '').trim()
    if (target === '') throw new Error('projectId is required')
    const caller = callerSessionId === undefined ? undefined : await this.engagement(callerSessionId)
    if (caller === undefined || caller.projectId !== target) {
      throw new Error('only a session linked to this project can unlink it')
    }
    const ids = await this.projectSessionIds(target)
    const domain = await this.domain()
    for (const sessionId of ids) {
      const key = `${sessionId}:${target}`
      await domain.table('project_tombstones').put(key, { id: key, sessionId, projectId: target, createdAt: now() })
      await this.enqueue(sessionId, async () => {
        const engagement = await this.engagement(sessionId)
        if (engagement === undefined) return
        await domain.table('engagements').put(sessionId, { ...engagement, projectId: '' })
      })
    }
    return { projectId: target, sessions: ids.length }
  }

  /** Drop tombstones once this session's published state reflects the new projectId. */
  async pruneProjectTombstones(sessionId, currentProjectId) {
    const domain = await this.domain()
    const table = domain.table('project_tombstones')
    for (const [key, row] of table.entries()) {
      if (row.sessionId === sessionId && row.projectId !== currentProjectId) await table.delete(key)
    }
  }

  /** Add one goal. */
  async addGoal(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      const engagement = await this.engagement(sessionId)
      if (engagement === undefined) throw new Error('engagement is not initialized; call ly_start first')
      const id = await this.nextId(sessionId, 'goal')
      const goal = {
        id,
        sessionId,
        text: required(input.text, 'goal text'),
        acceptance: String(input.acceptance ?? '').trim(),
        vulnclass: input.vulnclass ?? '',
        status: 'open',
        evidenceIds: [],
        createdAt: now(),
      }
      const domain = await this.domain()
      await domain.table('goals').put(recordKey(sessionId, id), goal)
      return goal
    })
  }

  /** Mark one goal met or abandoned with evidence references. */
  async proveGoal(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      const goal = await this.record(sessionId, 'goal', input.goalId)
      if (goal === undefined) throw new Error(`unknown goal ${input.goalId}`)
      const evidenceIds = Array.isArray(input.evidenceIds) ? input.evidenceIds : []
      for (const evidenceId of evidenceIds) {
        if (await this.record(sessionId, 'evidence', evidenceId) === undefined) {
          throw new Error(`unknown evidence ${evidenceId}`)
        }
      }
      const status = input.status === 'abandoned' ? 'abandoned' : 'met'
      const next = { ...goal, status, evidenceIds: [...new Set([...goal.evidenceIds, ...evidenceIds])] }
      const domain = await this.domain()
      await domain.table('goals').put(recordKey(sessionId, goal.id), next)
      await this.activity(sessionId, {
        kind: 'goal',
        summary: `${status === 'met' ? '目标达成' : '目标放弃'}：${goal.text}`,
        detail: input.reason ?? '',
      })
      return next
    })
  }

  /** Normalize one asset input and validate its parent reference. */
  async assetRecord(sessionId, input) {
    const type = input.type
    if (!ASSET_TYPES.includes(type)) throw new Error(`asset type must be one of: ${ASSET_TYPES.join(', ')}`)
    const value = required(input.value, 'asset value')
    const identifier = normalizeAssetValue(type, value)
    const parentId = input.parentId === '' ? undefined : input.parentId
    if (parentId !== undefined) {
      if (await this.record(sessionId, 'asset', parentId) === undefined) {
        throw new Error(`unknown parent asset ${parentId}`)
      }
    }
    return {
      type,
      value,
      identifier,
      origin: input.origin === 'scope' ? 'scope' : 'discovered',
      parentId,
      meta: input.meta ?? '',
      firstSeenIntentId: input.firstSeenIntentId,
    }
  }

  /** Create (or return the existing) asset of one normalized identity. */
  async upsertAsset(sessionId, input) {
    const normalized = await this.assetRecord(sessionId, input)
    const existing = (await this.rows(sessionId, 'assets')).find(
      asset => asset.type === normalized.type && asset.identifier === normalized.identifier,
    )
    if (existing !== undefined) return { asset: existing, created: false }
    const domain = await this.domain()
    const id = await this.nextId(sessionId, 'asset')
    const asset = { id, sessionId, ...normalized, createdAt: now() }
    await domain.table('assets').put(recordKey(sessionId, id), asset)
    if (normalized.parentId !== undefined) {
      const edgeId = await this.nextId(sessionId, 'edge')
      await domain.table('edges').put(recordKey(sessionId, edgeId), {
        id: edgeId, sessionId, kind: 'parent', srcId: normalized.parentId, dstId: id,
      })
    }
    return { asset, created: true }
  }

  /** Add one asset through the model-facing contract. */
  async addAsset(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      const result = await this.upsertAsset(sessionId, input)
      return result.asset
    })
  }

  /** Add one evidence record (assumes caller holds the session queue). */
  async addEvidenceRecord(sessionId, input) {
    const domain = await this.domain()
    const id = await this.nextId(sessionId, 'evidence')
    const evidence = {
      id,
      sessionId,
      kind: ['http', 'command', 'file', 'text', 'image'].includes(input.kind) ? input.kind : 'text',
      label: required(input.label, 'evidence label'),
      content: input.content ?? '',
      refPath: input.refPath ?? '',
      sha256: input.sha256 ?? '',
      size: Number.isInteger(input.size) ? input.size : (input.content ?? '').length,
      channel: input.channel ?? '',
      layers: Array.isArray(input.layers) ? input.layers.map(String) : [],
      intentId: input.intentId,
      findingId: input.findingId,
      createdAt: now(),
    }
    await domain.table('evidence').put(recordKey(sessionId, id), evidence)
    return evidence
  }

  /** Add one evidence record through the model-facing contract. */
  async addEvidence(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      return this.addEvidenceRecord(sessionId, input)
    })
  }

  /** Add one dataflow record. */
  async addFlow(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      const domain = await this.domain()
      const id = await this.nextId(sessionId, 'flow')
      const flow = {
        id,
        sessionId,
        source: required(input.source, 'flow source'),
        transform: input.transform ?? '',
        sink: required(input.sink, 'flow sink'),
        evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
        confidence: confidenceOf(input.confidence, 0.6),
        createdAt: now(),
      }
      await domain.table('flows').put(recordKey(sessionId, id), flow)
      return flow
    })
  }

  /** Add a goal/asset reference checked by the caller's transaction. */
  async requireEngagement(sessionId) {
    const engagement = await this.engagement(sessionId)
    if (engagement === undefined) throw new Error('engagement is not initialized; call ly_start first')
    return engagement
  }

  /** Add an intent anchored to the goal or to facts. */
  async addIntents(sessionId, inputs) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      const domain = await this.domain()
      const intents = await this.rows(sessionId, 'intents')
      const facts = await this.rows(sessionId, 'facts')
      const created = []
      const skipped = []
      for (const input of Array.isArray(inputs) ? inputs : []) {
        const title = required(input.title, 'intent title')
        const normalized = normalizeTitle(title)
        const duplicate = intents.find(
          intent => (intent.state === 'open' || intent.state === 'running') && normalizeTitle(intent.title) === normalized,
        )
        if (duplicate !== undefined) {
          skipped.push({ title, reason: 'duplicate', id: duplicate.id })
          continue
        }
        const goalId = input.goalId
        const derivedFromFactIds = Array.isArray(input.derivedFromFactIds) ? input.derivedFromFactIds : []
        if ((goalId === undefined || goalId === '') && derivedFromFactIds.length === 0) {
          throw new Error('ly_intent_add requires goalId or derivedFromFactIds')
        }
        if (goalId !== undefined && goalId !== '') {
          if (await this.record(sessionId, 'goal', goalId) === undefined) throw new Error(`unknown goal ${goalId}`)
        }
        for (const factId of derivedFromFactIds) {
          if (!facts.some(fact => fact.id === factId)) throw new Error(`unknown fact ${factId}`)
        }
        const assetIds = Array.isArray(input.assetIds) ? input.assetIds : []
        for (const assetId of assetIds) {
          if (await this.record(sessionId, 'asset', assetId) === undefined) throw new Error(`unknown asset ${assetId}`)
        }
        const id = await this.nextId(sessionId, 'intent')
        const intent = {
          id,
          sessionId,
          goalId: goalId === '' ? undefined : goalId,
          derivedFromFactIds,
          title,
          detail: input.detail ?? '',
          expectedObservation: input.expectedObservation ?? '',
          state: 'open',
          priority: Number.isInteger(input.priority) ? input.priority : 0,
          assetIds,
          createdAt: now(),
          updatedAt: now(),
        }
        await domain.table('intents').put(recordKey(sessionId, id), intent)
        if (intent.goalId !== undefined) {
          const edgeId = await this.nextId(sessionId, 'edge')
          await domain.table('edges').put(recordKey(sessionId, edgeId), {
            id: edgeId, sessionId, kind: 'spawns', srcId: intent.goalId, dstId: id,
          })
        }
        for (const factId of derivedFromFactIds) {
          const edgeId = await this.nextId(sessionId, 'edge')
          await domain.table('edges').put(recordKey(sessionId, edgeId), {
            id: edgeId, sessionId, kind: 'derived_from', srcId: factId, dstId: id,
          })
        }
        intents.push(intent)
        created.push(intent)
      }
      return { created, skipped }
    })
  }

  /** Change one intent's state. */
  async updateIntent(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      const intent = await this.record(sessionId, 'intent', input.intentId)
      if (intent === undefined) throw new Error(`unknown intent ${input.intentId}`)
      const state = input.state
      const allowed = ['open', 'running', 'paused', 'done', 'blocked', 'exhausted', 'stopped', 'deleted']
      if (!allowed.includes(state)) throw new Error(`intent state must be one of: ${allowed.join(', ')}`)
      const next = { ...intent, state, updatedAt: now() }
      const domain = await this.domain()
      await domain.table('intents').put(recordKey(sessionId, intent.id), next)
      if (input.reason) {
        await this.activity(sessionId, {
          intentId: intent.id, kind: 'intent', summary: `意图 ${intent.id} → ${state}`, detail: input.reason,
        })
      }
      return next
    })
  }

  /** Add hints (strategic priors). */
  async addHints(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      const domain = await this.domain()
      const texts = Array.isArray(input.texts) ? input.texts : [input.text]
      const parentIds = Array.isArray(input.parentIds) ? input.parentIds : []
      const existing = await this.rows(sessionId, 'hints')
      const created = []
      for (const text of texts) {
        const trimmed = required(text, 'hint text')
        // Repeating the same active hint is a no-op (a failed call may have
        // already committed it).
        if (existing.some(hint => hint.state === 'active' && hint.text === trimmed)) continue
        const id = await this.nextId(sessionId, 'hint')
        const hint = {
          id, sessionId, text: trimmed, source: input.source === 'human' ? 'human' : 'agent',
          parentIds, state: 'active', createdAt: now(),
        }
        await domain.table('hints').put(recordKey(sessionId, id), hint)
        existing.push(hint)
        created.push(hint)
      }
      return created
    })
  }

  /** Add constraints (action mask). */
  async addConstraints(sessionId, inputs) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      const domain = await this.domain()
      const created = []
      for (const input of Array.isArray(inputs) ? inputs : []) {
        const text = required(input.text, 'constraint text')
        const id = await this.nextId(sessionId, 'constraint')
        const constraint = {
          id, sessionId, kind: input.kind === 'allow' ? 'allow' : 'deny', text,
          origin: input.origin ?? 'agent', active: true, createdAt: now(),
        }
        await domain.table('constraints').put(recordKey(sessionId, id), constraint)
        created.push(constraint)
      }
      return created
    })
  }

  /** All-or-nothing delegated submission from an execution subagent. */
  async submit(sessionId, payload) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      const domain = await this.domain()
      const intent = await this.record(sessionId, 'intent', payload.intentId)
      if (intent === undefined) throw new Error(`unknown intent ${payload.intentId}`)
      if (['done', 'stopped', 'deleted'].includes(intent.state)) {
        throw new Error(`intent ${intent.id} is ${intent.state} and accepts no new submissions`)
      }
      const created = []
      const track = (kind, record) => created.push({ kind, key: recordKey(sessionId, record.id) })
      try {
        // Evidence first: facts and findings may reference it.
        const evidence = []
        for (const item of Array.isArray(payload.evidence) ? payload.evidence : []) {
          const record = await this.addEvidenceRecord(sessionId, { ...item, intentId: intent.id })
          track('evidence', record)
          evidence.push(record)
        }
        const evidenceIds = evidence.map(item => item.id)
        // Assets: parents must already exist; duplicates resolve to the existing id.
        const assets = []
        for (const item of Array.isArray(payload.assets) ? payload.assets : []) {
          const result = await this.upsertAsset(sessionId, { ...item, firstSeenIntentId: intent.id })
          if (result.created) track('asset', result.asset)
          assets.push(result.asset)
        }
        // Facts: each yields from the intent.
        const facts = []
        for (const item of Array.isArray(payload.facts) ? payload.facts : []) {
          const kind = FACT_KINDS.includes(item.kind) ? item.kind : 'info'
          const basis = FACT_BASES.includes(item.basis) ? item.basis : 'observed'
          const id = await this.nextId(sessionId, 'fact')
          const fact = {
            id, sessionId, intentId: intent.id, kind,
            target: item.target ?? '',
            detail: required(item.detail, 'fact detail'),
            basis,
            confidence: confidenceOf(item.confidence, basis === 'assumed' ? 0.4 : 0.8),
            provenance: item.provenance ?? '',
            evidenceIds: Array.isArray(item.evidenceIds) ? [...new Set([...item.evidenceIds, ...evidenceIds])] : evidenceIds,
            assetIds: Array.isArray(item.assetIds) ? item.assetIds : [],
            state: 'confirmed', createdAt: now(),
          }
          for (const assetId of fact.assetIds) {
            if (await this.record(sessionId, 'asset', assetId) === undefined) throw new Error(`unknown asset ${assetId}`)
          }
          for (const evidenceId of fact.evidenceIds) {
            if (await this.record(sessionId, 'evidence', evidenceId) === undefined) throw new Error(`unknown evidence ${evidenceId}`)
          }
          await domain.table('facts').put(recordKey(sessionId, id), fact)
          track('fact', fact)
          const edgeId = await this.nextId(sessionId, 'edge')
          await domain.table('edges').put(recordKey(sessionId, edgeId), {
            id: edgeId, sessionId, kind: 'yields', srcId: intent.id, dstId: id,
          })
          facts.push(fact)
        }
        // Findings: each proves from the intent and anchors its assets.
        const findings = []
        for (const item of Array.isArray(payload.findings) ? payload.findings : []) {
          const severity = SEVERITIES.includes(item.severity) ? item.severity : 'info'
          const steps = Array.isArray(item.reproducibleSteps) ? item.reproducibleSteps.filter(step => String(step).trim() !== '') : []
          if (steps.length === 0) throw new Error('finding requires at least one reproducible step')
          const assetIds = Array.isArray(item.assetIds) ? item.assetIds : []
          for (const assetId of assetIds) {
            if (await this.record(sessionId, 'asset', assetId) === undefined) throw new Error(`unknown asset ${assetId}`)
          }
          const findingEvidence = Array.isArray(item.evidenceIds)
            ? [...new Set([...item.evidenceIds, ...evidenceIds])]
            : evidenceIds
          const id = await this.nextId(sessionId, 'finding')
          const finding = {
            id, sessionId, intentId: intent.id,
            vulnclass: item.vulnclass ?? '',
            title: required(item.title, 'finding title'),
            severity, summary: item.summary ?? '', description: item.description ?? '',
            impact: item.impact ?? '', status: 'pending', assetIds,
            evidenceIds: findingEvidence,
            reproducibleSteps: steps,
            reportMarkdown: item.reportMarkdown ?? '',
            trustBoundary: item.trustBoundary ?? '',
            evidenceVersion: 0, createdAt: now(), updatedAt: now(),
          }
          await domain.table('findings').put(recordKey(sessionId, id), finding)
          track('finding', finding)
          const edgeId = await this.nextId(sessionId, 'edge')
          await domain.table('edges').put(recordKey(sessionId, edgeId), {
            id: edgeId, sessionId, kind: 'proves', srcId: intent.id, dstId: id,
          })
          for (const assetId of assetIds) {
            const anchorId = await this.nextId(sessionId, 'edge')
            await domain.table('edges').put(recordKey(sessionId, anchorId), {
              id: anchorId, sessionId, kind: 'anchors', srcId: id, dstId: assetId,
            })
          }
          findings.push(finding)
        }
        // Flows (dataflow / concat points).
        const flows = []
        for (const item of Array.isArray(payload.flows) ? payload.flows : []) {
          const id = await this.nextId(sessionId, 'flow')
          const flow = {
            id, sessionId,
            source: required(item.source, 'flow source'),
            transform: item.transform ?? '',
            sink: required(item.sink, 'flow sink'),
            evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds : evidenceIds,
            confidence: confidenceOf(item.confidence, 0.6),
            createdAt: now(),
          }
          await domain.table('flows').put(recordKey(sessionId, id), flow)
          track('flow', flow)
          flows.push(flow)
        }
        // Activity notes from the worker.
        for (const item of Array.isArray(payload.activity) ? payload.activity : []) {
          const record = await this.activity(sessionId, {
            intentId: intent.id, worker: 'worker',
            kind: item.kind ?? 'note', tool: item.tool ?? '',
            summary: item.summary ?? '', detail: item.detail ?? '',
          })
          track('activity', record)
        }
        const nextIntent = { ...intent, state: intent.state === 'open' ? 'running' : intent.state, updatedAt: now() }
        await domain.table('intents').put(recordKey(sessionId, intent.id), nextIntent)
        return {
          intent: nextIntent,
          counts: {
            facts: facts.length, assets: assets.length, findings: findings.length,
            evidence: evidence.length, flows: flows.length,
          },
        }
      } catch (error) {
        for (const { kind, key } of created.reverse()) {
          try { await domain.table(TABLE_OF[kind]).delete(key) } catch { /* best-effort rollback */ }
        }
        throw error
      }
    })
  }

  /** Create a retest record for one finding. */
  async retestCreate(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      const finding = await this.record(sessionId, 'finding', input.findingId)
      if (finding === undefined) throw new Error(`unknown finding ${input.findingId}`)
      const existing = (await this.rows(sessionId, 'retests')).find(
        retest => retest.findingId === finding.id && (retest.status === 'pending' || retest.status === 'running'),
      )
      if (existing !== undefined) return existing
      const domain = await this.domain()
      const id = await this.nextId(sessionId, 'retest')
      const retest = {
        id, sessionId, findingId: finding.id, status: 'pending', verdict: '',
        notes: input.notes ?? '', evidenceIds: [], reportMarkdown: '',
        createdAt: now(), finishedAt: '',
      }
      await domain.table('retests').put(recordKey(sessionId, id), retest)
      return retest
    })
  }

  /** Mark a retest running and return its finding snapshot. */
  async retestBegin(sessionId, retestId) {
    return this.enqueue(sessionId, async () => {
      const retest = await this.record(sessionId, 'retest', retestId)
      if (retest === undefined) throw new Error(`unknown retest ${retestId}`)
      const finding = await this.record(sessionId, 'finding', retest.findingId)
      if (finding === undefined) throw new Error(`unknown finding ${retest.findingId}`)
      const domain = await this.domain()
      const next = { ...retest, status: 'running' }
      await domain.table('retests').put(recordKey(sessionId, retest.id), next)
      return { retest: next, finding }
    })
  }

  /** Finish a retest with a verdict and optional evidence. */
  async retestFinish(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      const retest = await this.record(sessionId, 'retest', input.retestId)
      if (retest === undefined) throw new Error(`unknown retest ${input.retestId}`)
      const domain = await this.domain()
      const evidenceIds = []
      for (const item of Array.isArray(input.evidence) ? input.evidence : []) {
        const record = await this.addEvidenceRecord(sessionId, {
          ...item, intentId: undefined, findingId: retest.findingId,
        })
        evidenceIds.push(record.id)
      }
      const verdict = ['reproduced', 'fixed', 'inconclusive'].includes(input.verdict) ? input.verdict : 'inconclusive'
      const next = {
        ...retest, status: 'completed', verdict,
        notes: input.notes ?? retest.notes,
        evidenceIds: [...new Set([...retest.evidenceIds, ...evidenceIds])],
        reportMarkdown: input.reportMarkdown ?? retest.reportMarkdown,
        finishedAt: now(),
      }
      await domain.table('retests').put(recordKey(sessionId, retest.id), next)
      const finding = await this.record(sessionId, 'finding', retest.findingId)
      if (finding !== undefined && verdict === 'fixed') {
        const updated = { ...finding, status: 'fixed', updatedAt: now() }
        await domain.table('findings').put(recordKey(sessionId, finding.id), updated)
      }
      await this.activity(sessionId, {
        intentId: finding?.intentId, kind: 'retest',
        summary: `复测 ${retest.id}：${verdict}`, detail: next.notes,
      })
      return next
    })
  }

  /** Add an attack path. */
  async addAttackPath(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      await this.requireEngagement(sessionId)
      const domain = await this.domain()
      const id = await this.nextId(sessionId, 'path')
      const record = {
        id, sessionId,
        title: required(input.title, 'attack path title'),
        status: ['suspected', 'validated', 'blocked', 'closed'].includes(input.status) ? input.status : 'suspected',
        summary: input.summary ?? '',
        steps: Array.isArray(input.steps) ? input.steps.map((step, index) => ({
          seq: index + 1, edgeId: step.edgeId ?? '', note: step.note ?? '',
        })) : [],
        createdAt: now(),
      }
      await domain.table(TABLE_OF.path).put(recordKey(sessionId, id), record)
      return record
    })
  }

  /** Rank the frontier and expose belief gaps (the `ly_next` payload). */
  async next(sessionId) {
    const data = await this.snapshot(sessionId)
    if (data.engagement === null) return { initialized: false }
    const facts = data.facts
    const factIds = new Set(facts.map(fact => fact.id))
    const assetTested = coveredAssetIds(data)
    const frontier = data.intents
      .filter(intent => intent.state === 'open' || intent.state === 'running')
      .map((intent) => {
        const missing = intent.derivedFromFactIds.filter(factId => !factIds.has(factId))
        const depsMet = missing.length === 0
        const score = intent.priority * 10 + (depsMet ? 20 : -20) + (intent.state === 'running' ? 5 : 0) + Math.min(intent.assetIds.length, 5)
        return { id: intent.id, title: intent.title, state: intent.state, priority: intent.priority, goalId: intent.goalId, assetIds: intent.assetIds, depsMet, missingDeps: missing, score }
      })
      .sort((a, b) => b.score - a.score)
    const untestedAssets = data.assets.filter(asset => !assetTested.has(asset.id))
    return {
      initialized: true,
      engagement: data.engagement,
      counts: this.summarise(data),
      frontier: frontier.slice(0, 12),
      hints: data.hints.filter(hint => hint.state === 'active').slice(-10),
      goals: data.goals,
      beliefGaps: {
        assumedFacts: facts.filter(fact => fact.basis === 'assumed').map(fact => ({ id: fact.id, detail: fact.detail })),
        negativeFacts: facts.filter(fact => fact.basis === 'negative').map(fact => ({ id: fact.id, detail: fact.detail })),
        openGoals: data.goals.filter(goal => goal.status === 'open').map(goal => ({ id: goal.id, text: goal.text })),
        untestedAssets: untestedAssets.map(asset => ({ id: asset.id, type: asset.type, value: asset.value })),
        blockedIntents: data.intents.filter(intent => intent.state === 'blocked').map(intent => intent.id),
      },
      recentActivity: data.activity.slice(-8).reverse(),
    }
  }

  /** Review checklist: what remains open before reporting. */
  async review(sessionId) {
    const data = await this.snapshot(sessionId)
    if (data.engagement === null) return { initialized: false, items: [] }
    const items = []
    for (const goal of data.goals) {
      items.push({ kind: 'goal', ref: goal.id, status: goal.status === 'met' ? 'satisfied' : goal.status === 'abandoned' ? 'deferred' : 'incomplete', text: goal.text })
    }
    for (const intent of data.intents) {
      if (intent.state === 'blocked') items.push({ kind: 'intent', ref: intent.id, status: 'blocked', text: intent.title })
    }
    const tested = coveredAssetIds(data)
    for (const asset of data.assets) {
      if (!tested.has(asset.id)) items.push({ kind: 'asset', ref: asset.id, status: 'incomplete', text: `${asset.type} ${asset.value} 未被测试` })
    }
    for (const finding of data.findings) {
      if (!finding.reproducibleSteps || finding.reproducibleSteps.length === 0) {
        items.push({ kind: 'finding', ref: finding.id, status: 'incomplete', text: '漏洞缺少可复现步骤' })
      }
      if (!finding.trustBoundary && (finding.vulnclass.includes('jwt') || finding.vulnclass.includes('token'))) {
        items.push({ kind: 'finding', ref: finding.id, status: 'incomplete', text: 'token/断言类漏洞缺少信任边界说明' })
      }
    }
    return { initialized: true, items }
  }

  /** Coverage summary and per-asset tested state. */
  async coverage(sessionId) {
    const data = await this.snapshot(sessionId)
    const tested = coveredAssetIds(data)
    const assets = data.assets.map(asset => ({
      id: asset.id, type: asset.type, value: asset.value, origin: asset.origin, tested: tested.has(asset.id),
    }))
    return {
      total: assets.length,
      tested: assets.filter(asset => asset.tested).length,
      untested: assets.filter(asset => !asset.tested),
      assets,
    }
  }

  /** Markdown report for one engagement. */
  async report(sessionId) {
    const data = await this.snapshot(sessionId)
    return buildReport(data)
  }

  /** Write the delivery bundle into the session working directory. */
  async exportBundle(sessionId, options) {
    const data = await this.snapshot(sessionId)
    return buildExportBundle(data, options)
  }
}
