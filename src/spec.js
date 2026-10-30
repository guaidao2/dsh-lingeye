/**
 * Durable storage-domain declaration for the 灵眼 engagement record.
 *
 * One engagement per session. The records form two linked graphs plus the
 * process/evidence planes:
 *  - exploration: goals, intents, facts, findings, hints, edges (DAG)
 *  - assets: assets and parent links
 *  - process: activity, evidence, flows (dataflow source -> transform -> sink)
 *  - delivery: retests, constraints, attackPaths
 *
 * Facts carry a belief basis (`observed` / `inferred` / `assumed` /
 * `negative`) so the graph records the belief state, not just confirmed
 * observations. Evidence carries the observation channel and per-layer
 * interpretations; findings may carry a trust boundary.
 *
 * @module dsh-lingeye/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Non-empty id. */
const id = z.string().min(1)

/** Closed vocabularies used by tools and validation. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
export const ASSET_TYPES = ['root-domain', 'subdomain', 'ip', 'service', 'app', 'endpoint']
export const FACT_KINDS = ['port', 'service', 'vuln', 'http', 'source', 'credential', 'info']
export const FACT_BASES = ['observed', 'inferred', 'assumed', 'negative']
export const INTENT_STATES = ['open', 'running', 'paused', 'done', 'blocked', 'exhausted', 'stopped', 'deleted']
export const GOAL_STATES = ['open', 'met', 'abandoned']
export const FINDING_STATES = [
  'pending', 'in_progress', 'confirmed', 'resolved', 'fixed',
  'false_positive', 'ignored', 'duplicate', 'risk_accepted',
]
export const EVIDENCE_KINDS = ['http', 'command', 'file', 'text', 'image']
export const RETEST_STATES = ['pending', 'running', 'completed', 'failed', 'stopped']
export const RETEST_VERDICTS = ['reproduced', 'fixed', 'inconclusive']
export const EDGE_KINDS = [
  'spawns', 'derived_from', 'yields', 'proves', 'anchors', 'covers', 'parent',
  'exploits', 'pivots_to', 'leads_to',
]

const iso = z.string().min(1)

/** One engagement (keyed by session id). */
export const engagementSchema = z.object({
  id,
  sessionId: id,
  // Optional explicit project grouping. Empty means this session is its own
  // project; old rows need no migration and keep their previous behavior.
  projectId: z.string().default(''),
  target: z.string().min(1),
  objective: z.string().min(1),
  authorization: z.string().default(''),
  scope: z.string().default(''),
  status: z.enum(['active', 'paused', 'achieved', 'abandoned']).default('active'),
  createdAt: iso,
})

export const goalSchema = z.object({
  id,
  sessionId: id,
  text: z.string().min(1),
  acceptance: z.string().default(''),
  vulnclass: z.string().default(''),
  status: z.enum(GOAL_STATES).default('open'),
  evidenceIds: z.array(id).default([]),
  createdAt: iso,
})

export const intentSchema = z.object({
  id,
  sessionId: id,
  goalId: id.optional(),
  derivedFromFactIds: z.array(id).default([]),
  title: z.string().min(1),
  detail: z.string().default(''),
  expectedObservation: z.string().default(''),
  state: z.enum(INTENT_STATES).default('open'),
  priority: z.number().int().default(0),
  assetIds: z.array(id).default([]),
  createdAt: iso,
  updatedAt: iso,
})

export const factSchema = z.object({
  id,
  sessionId: id,
  intentId: id,
  kind: z.enum(FACT_KINDS).default('info'),
  target: z.string().default(''),
  detail: z.string().min(1),
  basis: z.enum(FACT_BASES).default('observed'),
  confidence: z.number().min(0).max(1).default(0.7),
  provenance: z.string().default(''),
  evidenceIds: z.array(id).default([]),
  assetIds: z.array(id).default([]),
  state: z.enum(['confirmed', 'dismissed', 'stale']).default('confirmed'),
  createdAt: iso,
})

export const findingSchema = z.object({
  id,
  sessionId: id,
  intentId: id,
  vulnclass: z.string().default(''),
  title: z.string().min(1),
  severity: z.enum(SEVERITIES),
  summary: z.string().default(''),
  description: z.string().default(''),
  impact: z.string().default(''),
  status: z.enum(FINDING_STATES).default('pending'),
  assetIds: z.array(id).default([]),
  evidenceIds: z.array(id).default([]),
  reproducibleSteps: z.array(z.string().min(1)).min(1),
  reportMarkdown: z.string().default(''),
  trustBoundary: z.string().default(''),
  evidenceVersion: z.number().int().nonnegative().default(0),
  createdAt: iso,
  updatedAt: iso,
})

export const hintSchema = z.object({
  id,
  sessionId: id,
  text: z.string().min(1),
  source: z.enum(['human', 'agent']).default('agent'),
  parentIds: z.array(id).default([]),
  state: z.enum(['active', 'consumed']).default('active'),
  createdAt: iso,
})

const assetTypeSchema = z.enum(ASSET_TYPES)

export const assetSchema = z.object({
  id,
  sessionId: id,
  type: assetTypeSchema,
  value: z.string().min(1),
  identifier: z.string().min(1),
  origin: z.enum(['scope', 'discovered']).default('discovered'),
  parentId: id.optional(),
  meta: z.string().default(''),
  firstSeenIntentId: id.optional(),
  createdAt: iso,
})

export const edgeSchema = z.object({
  id,
  sessionId: id,
  kind: z.enum(EDGE_KINDS),
  srcId: id,
  dstId: id,
  weight: z.number().min(0).max(1).default(0.5),
  pheromone: z.number().min(0).max(1).default(0.5),
  updatedAt: iso.optional(),
})

export const flowSchema = z.object({
  id,
  sessionId: id,
  source: z.string().min(1),
  transform: z.string().default(''),
  sink: z.string().min(1),
  evidenceIds: z.array(id).default([]),
  confidence: z.number().min(0).max(1).default(0.6),
  createdAt: iso,
})

export const evidenceSchema = z.object({
  id,
  sessionId: id,
  kind: z.enum(EVIDENCE_KINDS).default('text'),
  label: z.string().min(1),
  content: z.string().default(''),
  refPath: z.string().default(''),
  sha256: z.string().default(''),
  size: z.number().int().nonnegative().default(0),
  channel: z.string().default(''),
  layers: z.array(z.string()).default([]),
  intentId: id.optional(),
  findingId: id.optional(),
  state: z.enum(['active', 'retired']).default('active'),
  version: z.number().int().positive().default(1),
  retiredAt: iso.optional(),
  retiredReason: z.string().default(''),
  createdAt: iso,
})

export const activitySchema = z.object({
  id,
  sessionId: id,
  intentId: id.optional(),
  worker: z.string().default(''),
  kind: z.string().default('note'),
  tool: z.string().default(''),
  summary: z.string().default(''),
  detail: z.string().default(''),
  createdAt: iso,
})

export const retestSchema = z.object({
  id,
  sessionId: id,
  findingId: id,
  status: z.enum(RETEST_STATES).default('pending'),
  verdict: z.union([z.literal(''), z.enum(RETEST_VERDICTS)]).default(''),
  notes: z.string().default(''),
  evidenceIds: z.array(id).default([]),
  reportMarkdown: z.string().default(''),
  createdAt: iso,
  finishedAt: z.string().default(''),
})

export const constraintSchema = z.object({
  id,
  sessionId: id,
  kind: z.enum(['allow', 'deny']).default('deny'),
  text: z.string().min(1),
  origin: z.string().default('user'),
  active: z.boolean().default(true),
  createdAt: iso,
})

export const attackPathSchema = z.object({
  id,
  sessionId: id,
  title: z.string().min(1),
  status: z.enum(['suspected', 'validated', 'blocked', 'closed']).default('suspected'),
  summary: z.string().default(''),
  steps: z.array(z.object({
    seq: z.number().int().positive(),
    edgeId: z.string().default(''),
    note: z.string().default(''),
  })).default([]),
  createdAt: iso,
})

/** A tombstone for an unlinked project grouping, so cold projections can hide it. */
export const projectTombstoneSchema = z.object({
  id,
  sessionId: id,
  projectId: z.string().min(1),
  createdAt: iso,
})

/** Global environment settings for the 灵眼操控中心. */
export const environmentSettingsSchema = z.object({
  id,
  gitbashEnabled: z.boolean().default(false),
  gitbashShellPath: z.string().default(''),
  updatedAt: iso,
})

/** One user-configured MCP server; transport-specific fields are ignored when unused. */
export const mcpServerSchema = z.object({
  id,
  serverName: z.string().min(1),
  transport: z.enum(['stdio', 'streamable-http']).default('stdio'),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  env: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
  url: z.string().default(''),
  headers: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
  timeoutMs: z.number().default(60000),
  failOnStartupError: z.boolean().default(true),
  enabled: z.boolean().default(true),
  updatedAt: iso,
})


/** A real project entity; sessions reference it through engagement.projectId. */
export const projectSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().default(''),
  target: z.string().default(''),
  status: z.enum(['active', 'archived', 'done']).default('active'),
  createdAt: iso,
  updatedAt: iso,
})


/** A concept node: a reusable security idea, condition, or relation template. */
export const conceptSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(['condition', 'technique', 'impact', 'asset-class', 'assumption', 'other']).default('other'),
  summary: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5),
  evidenceIds: z.array(z.string()).default([]),
  createdAt: iso,
  updatedAt: iso,
})

/** A typed relation between two concepts. */
export const conceptRelationSchema = z.object({
  id,
  fromId: z.string().min(1),
  toId: z.string().min(1),
  kind: z.enum(['requires', 'enables', 'leads-to', 'contradicts', 'refines', 'related']).default('related'),
  confidence: z.number().min(0).max(1).default(0.5),
  evidenceIds: z.array(z.string()).default([]),
  createdAt: iso,
})

/** The whole 灵眼 domain. */
export const lingeyeDomainSpec = defineDomain({
  name: 'lingeye',
  version: 1,
  tables: {
    engagements: domainTable(engagementSchema),
    goals: domainTable(goalSchema),
    intents: domainTable(intentSchema),
    facts: domainTable(factSchema),
    findings: domainTable(findingSchema),
    hints: domainTable(hintSchema),
    assets: domainTable(assetSchema),
    edges: domainTable(edgeSchema),
    flows: domainTable(flowSchema),
    evidence: domainTable(evidenceSchema),
    activity: domainTable(activitySchema),
    retests: domainTable(retestSchema),
    constraints: domainTable(constraintSchema),
    attack_paths: domainTable(attackPathSchema),
    project_tombstones: domainTable(projectTombstoneSchema),
    environment_settings: domainTable(environmentSettingsSchema),
    mcp_servers: domainTable(mcpServerSchema),
    projects: domainTable(projectSchema),
    concepts: domainTable(conceptSchema),
    concept_relations: domainTable(conceptRelationSchema),
  },
})
