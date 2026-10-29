/**
 * Commander tool surface for the 灵眼 mode (`lingeye` preset).
 *
 * These tools wrap the shared store service. The commander records goals,
 * intents, facts, assets, hints, constraints, evidence and dataflows, reads
 * the belief state (`ly_next` / `ly_state`), and produces the delivery
 * artifacts (`ly_report` / `ly_export`).
 *
 * @module dsh-lingeye/commander
 */

import { tool } from './tool.js'
import {
  ASSET_TYPES, SEVERITIES, FACT_KINDS, FACT_BASES, INTENT_STATES,
} from './spec.js'
import { COMMANDER_PROTOCOL, COMMANDER_SECTION, SECTION_ORDER } from './instructions.js'

/** Resolve the calling session id. */
function sessionIdOf(exec) {
  if (!exec.agent) throw new Error('ly_* tools require an owning agent session')
  return exec.agent.session.id
}

/** A permissive object output schema for snapshot-shaped values. */
const objectOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {},
}

/** Render a JSON value as one text block. */
function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Render one short confirmation line. */
function lineRender(prefix) {
  return (_args, value) => [{ type: 'text', text: `${prefix}${JSON.stringify(value)}` }]
}

/** A generic card for the read-only projections. */
function card(title) {
  return (_args, result) => {
    if (result.isError) return undefined
    return { card: 'generic', title, content: result.content }
  }
}

/** Register the commander tools and protocol section. */
export function registerCommander(ctx) {
  const store = ctx.lingeyeStore
  ctx.systemPrompt.section({
    name: COMMANDER_SECTION,
    order: SECTION_ORDER,
    text: COMMANDER_PROTOCOL,
  })

  ctx.tools.register(tool({
    name: 'ly_start',
    description: 'Start (or reset) a 灵眼 engagement for this session. Sets target, objective, authorization and scope, resets all previous records, creates the root goal and optional constraints. Call once before recording anything else.',
    parameters: {
      target: { type: 'string', required: true, description: 'Target host, URL, network scope, or repository path.' },
      objective: { type: 'string', required: true, description: 'What must be delivered or proven for this engagement.' },
      projectId: { type: 'string', description: 'Optional project grouping key shared with other sessions; omit to keep this session as its own project.' },
      authorization: { type: 'string', description: 'Declarative authorization note (who authorized, written-permission reference).' },
      scope: { type: 'string', description: 'Declared scope, e.g. domains/IPs the engagement may touch.' },
      constraints: {
        type: 'array',
        description: 'Optional allow/deny constraints.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['allow', 'deny'], description: 'Constraint kind (default deny).' },
            text: { type: 'string', required: true, description: 'Self-contained constraint text with concrete targets.' },
          },
        },
      },
    },
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼交战状态'),
    execute: async (args, exec) => {
      const state = await store.start(sessionIdOf(exec), args)
      return { initialized: true, counts: store.summarise(state), ...state }
    },
  }))

  ctx.tools.register(tool({
    name: 'ly_project_link',
    description: 'Attach this engagement to a project grouping so the central Lingeye projects panel can aggregate multiple sessions. This only changes the grouping key; it does not move or copy records. Pass an empty projectId to unlink.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Project grouping key, or an empty string to unlink.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼操控中心关联'),
    execute: async (args, exec) => store.linkProject(sessionIdOf(exec), args.projectId),
  }))

  ctx.tools.register(tool({
    name: 'ly_project_unlink',
    description: 'Remove a project grouping from every session that uses it. This only clears projectId; it keeps all session data, evidence and findings. Use ly_project_link with an empty value to unlink only this session.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Project grouping key to unlink from every associated session.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼操控中心解除分组'),
    execute: async (args, exec) => store.unlinkProject(args.projectId, sessionIdOf(exec)),
  }))

  ctx.tools.register(tool({
    name: 'ly_state',
    description: 'Read the full engagement state (engagement, goals, intents, facts, findings, assets, evidence, flows, retests, activity) and refresh the Web tab. Call it after subagent submissions or any notable change.',
    parameters: {},
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼状态'),
    execute: async (_args, exec) => {
      const sessionId = sessionIdOf(exec)
      const state = await store.snapshot(sessionId)
      return {
        initialized: state.engagement !== null,
        counts: store.summarise(state),
        report: state.engagement === null ? '' : await store.report(sessionId),
        ...state,
      }
    },
  }))

  ctx.tools.register(tool({
    name: 'ly_dispatch_status',
    description: 'Inspect the optional host dispatcher: whether auto dispatch is enabled, its worker budget, diagnostics, in-flight intents and one-shot attempt counts.',
    parameters: {},
    output: { schema: objectOutput, render: jsonRender },
    execute: async () => ({
      autoDispatch: store.autoDispatch,
      maxWorkers: store.maxAutoWorkers,
      debounceMs: store.dispatchDebounceMs,
      diagnostics: store.dispatchDiagnostics ?? { mounted: false },
      inFlight: [...store.dispatched.entries()].map(([sessionId, ids]) => ({ sessionId, intents: [...ids] })),
      attempts: store.autoAttempts.size,
    }),
  }))

  ctx.tools.register(tool({
    name: 'ly_dispatch_now',
    description: 'Run one dispatcher pass immediately and return its diagnostics. Use it after adding intents when auto dispatch is enabled, or to debug the dispatcher.',
    parameters: {},
    output: { schema: objectOutput, render: jsonRender },
    execute: async () => ({ diagnostics: await store.dispatchNow() }),
  }))

  ctx.tools.register(tool({
    name: 'ly_next',
    description: 'Read the planning state: ranked frontier, active hints, open goals, and belief gaps (assumed facts, negative facts, untested assets, blocked intents). Use it to pick the next experiment, not to enumerate a checklist.',
    parameters: {},
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼态势与信念缺口'),
    execute: async (_args, exec) => store.next(sessionIdOf(exec)),
  }))

  ctx.tools.register(tool({
    name: 'ly_goal_add',
    description: 'Add one goal (a final, independently verifiable deliverable) to the engagement.',
    parameters: {
      text: { type: 'string', required: true, description: 'The goal text.' },
      acceptance: { type: 'string', description: 'Optional acceptance criteria: what evidence makes this goal met.' },
      vulnclass: { type: 'string', description: 'Optional vulnerability class this goal targets.' },
    },
    output: { schema: objectOutput, render: lineRender('目标已记录：') },
    execute: async (args, exec) => store.addGoal(sessionIdOf(exec), args),
  }))

  ctx.tools.register(tool({
    name: 'ly_goal_prove',
    description: 'Mark one goal met (or abandoned) with evidence references and a reason.',
    parameters: {
      goalId: { type: 'string', required: true, description: 'Goal id.' },
      evidenceIds: { type: 'array', description: 'Evidence ids supporting the verdict.', items: { type: 'string' } },
      reason: { type: 'string', description: 'Why the goal is met or abandoned.' },
      status: { type: 'string', enum: ['met', 'abandoned'], description: 'Verdict (default met).' },
    },
    output: { schema: objectOutput, render: lineRender('目标状态已更新：') },
    execute: async (args, exec) => store.proveGoal(sessionIdOf(exec), args),
  }))

  ctx.tools.register(tool({
    name: 'ly_intent_add',
    description: 'Add up to four exploration intents in one batch. Each intent is an experiment: title, detail, expected observation, exactly one anchor kind (goalId or derivedFromFactIds), related assets and priority. Duplicate open intents are skipped.',
    parameters: {
      intents: {
        type: 'array',
        required: true,
        description: 'Intents to add (maximum four).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: 'Short intent title.' },
            detail: { type: 'string', description: 'Scope, methods, hypothesis.' },
            expectedObservation: { type: 'string', description: 'What observation would confirm or refute this direction.' },
            goalId: { type: 'string', description: 'Anchor goal id (spawns edge).' },
            derivedFromFactIds: { type: 'array', description: 'Anchor fact ids (derived_from edges).', items: { type: 'string' } },
            assetIds: { type: 'array', description: 'Assets this intent tests.', items: { type: 'string' } },
            priority: { type: 'number', description: 'Priority (higher first).' },
          },
        },
      },
    },
    output: { schema: objectOutput, render: jsonRender },
    execute: async (args, exec) => {
      const intents = Array.isArray(args.intents) ? args.intents.slice(0, 4) : []
      if (intents.length === 0) throw new Error('ly_intent_add requires at least one intent')
      return store.addIntents(sessionIdOf(exec), intents)
    },
  }))

  ctx.tools.register(tool({
    name: 'ly_intent_update',
    description: 'Change one intent state (open/running/paused/done/blocked/exhausted/stopped/deleted) with an optional reason.',
    parameters: {
      intentId: { type: 'string', required: true, description: 'Intent id.' },
      state: { type: 'string', required: true, enum: INTENT_STATES, description: 'New state.' },
      reason: { type: 'string', description: 'Why the state changed.' },
    },
    output: { schema: objectOutput, render: lineRender('意图已更新：') },
    execute: async (args, exec) => store.updateIntent(sessionIdOf(exec), args),
  }))

  ctx.tools.register(tool({
    name: 'ly_hint_add',
    description: 'Inject one or more strategic hints (human or agent judgment) that the planner consumes in later rounds.',
    parameters: {
      texts: { type: 'array', required: true, description: 'Hint texts.', items: { type: 'string' } },
      source: { type: 'string', enum: ['human', 'agent'], description: 'Hint source (default agent).' },
    },
    output: { schema: objectOutput, render: lineRender('提示已记录：') },
    execute: async (args, exec) => ({ hints: await store.addHints(sessionIdOf(exec), args) }),
  }))

  ctx.tools.register(tool({
    name: 'ly_constraint_add',
    description: 'Add allow/deny constraints that bound the engagement. Constraints are self-contained and injected into later guidance.',
    parameters: {
      constraints: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['allow', 'deny'], description: 'Constraint kind (default deny).' },
            text: { type: 'string', required: true, description: 'Constraint text with concrete targets.' },
          },
        },
      },
    },
    output: { schema: objectOutput, render: lineRender('约束已记录：') },
    execute: async (args, exec) => ({ constraints: await store.addConstraints(sessionIdOf(exec), args.constraints) }),
  }))

  ctx.tools.register(tool({
    name: 'ly_asset_add',
    description: 'Record one asset (normalized and de-duplicated by type + identifier). Parent assets must be recorded before children.',
    parameters: {
      type: { type: 'string', required: true, enum: ASSET_TYPES, description: 'Asset type.' },
      value: { type: 'string', required: true, description: 'Asset value.' },
      parentId: { type: 'string', description: 'Optional parent asset id.' },
      meta: { type: 'string', description: 'Optional metadata.' },
      origin: { type: 'string', enum: ['scope', 'discovered'], description: 'Declared scope or discovered (default discovered).' },
    },
    output: { schema: objectOutput, render: lineRender('资产已记录：') },
    execute: async (args, exec) => store.addAsset(sessionIdOf(exec), args),
  }))

  ctx.tools.register(tool({
    name: 'ly_evidence_add',
    description: 'Record one piece of evidence. Include the observation channel (error/boolean/time/oob/http) and per-layer interpretations when the observation passes through decoding or filtering layers.',
    parameters: {
      kind: { type: 'string', enum: ['http', 'command', 'file', 'text', 'image'], description: 'Evidence kind (default text).' },
      label: { type: 'string', required: true, description: 'Short evidence label.' },
      content: { type: 'string', description: 'Evidence body (commands, request/response, output).' },
      refPath: { type: 'string', description: 'Optional file path for large or binary evidence.' },
      channel: { type: 'string', description: 'Observation channel, e.g. error/boolean/time/oob.' },
      layers: { type: 'array', description: 'Per-layer interpretations of the same input.', items: { type: 'string' } },
    },
    output: { schema: objectOutput, render: lineRender('证据已记录：') },
    execute: async (args, exec) => store.addEvidence(sessionIdOf(exec), args),
  }))

  ctx.tools.register(tool({
    name: 'ly_flow_add',
    description: 'Record one dataflow / concat point (source → transform → sink). Link the finding to the sink, not the entry point.',
    parameters: {
      source: { type: 'string', required: true, description: 'Input source (parameter, header, file, token field).' },
      transform: { type: 'string', description: 'Transforms along the path (decode, normalize, truncate, concat).' },
      sink: { type: 'string', required: true, description: 'Sink where the value is interpreted (SQL, shell, template, decoder).' },
      evidenceIds: { type: 'array', description: 'Supporting evidence ids.', items: { type: 'string' } },
      confidence: { type: 'number', description: 'Confidence 0..1.' },
    },
    output: { schema: objectOutput, render: lineRender('数据流已记录：') },
    execute: async (args, exec) => store.addFlow(sessionIdOf(exec), args),
  }))

  ctx.tools.register(tool({
    name: 'ly_findings',
    description: 'List findings, optionally filtered by status or severity.',
    parameters: {
      status: { type: 'string', description: 'Filter by finding status.' },
      severity: { type: 'string', enum: SEVERITIES, description: 'Filter by severity.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼漏洞'),
    execute: async (args, exec) => {
      const state = await store.snapshot(sessionIdOf(exec))
      const findings = state.findings.filter(finding =>
        (args.status === undefined || finding.status === args.status)
        && (args.severity === undefined || finding.severity === args.severity))
      return { findings }
    },
  }))

  ctx.tools.register(tool({
    name: 'ly_assets',
    description: 'List assets, optionally filtered by type, with tested state.',
    parameters: {
      type: { type: 'string', enum: ASSET_TYPES, description: 'Filter by asset type.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼资产'),
    execute: async (args, exec) => {
      const coverage = await store.coverage(sessionIdOf(exec))
      const assets = coverage.assets.filter(asset => args.type === undefined || asset.type === args.type)
      return { assets }
    },
  }))

  ctx.tools.register(tool({
    name: 'ly_coverage',
    description: 'Report asset coverage: total assets, tested assets, and the untested list.',
    parameters: {},
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼覆盖率'),
    execute: async (_args, exec) => store.coverage(sessionIdOf(exec)),
  }))

  ctx.tools.register(tool({
    name: 'ly_review',
    description: 'Review checklist before reporting: open goals, blocked intents, untested assets, incomplete findings and missing trust boundaries.',
    parameters: {},
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼复核'),
    execute: async (_args, exec) => store.review(sessionIdOf(exec)),
  }))

  ctx.tools.register(tool({
    name: 'ly_report',
    description: 'Render the final Markdown report: goals, exploration chain, vulnerabilities with reproducible steps and evidence, assets, dataflows, retests, belief gaps and unfinished items.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { markdown: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.markdown }],
    },
    presentResult: card('灵眼测试报告'),
    execute: async (_args, exec) => ({ markdown: await store.report(sessionIdOf(exec)) }),
  }))

  ctx.tools.register(tool({
    name: 'ly_export',
    description: 'Write the delivery bundle into the session working directory: report.md, findings.json, assets.json, graph.json, coverage.json, per-finding Markdown and evidence files.',
    parameters: {
      dir: { type: 'string', description: 'Optional explicit output directory.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    presentResult: card('灵眼交付物'),
    execute: async (args, exec) => {
      const session = exec.agent.session
      const workingDirectory = ctx.get('workingDirectory')
      const cwd = workingDirectory !== undefined ? workingDirectory.get(session) : session.header?.cwd
      return store.exportBundle(session.id, { dir: args.dir, cwd })
    },
  }))

  ctx.tools.register(tool({
    name: 'ly_retest_create',
    description: 'Create a retest record for one finding, then delegate it to a subagent with agent_preset lingeye-retest. Returns the retest id and a ready-to-use delegation body.',
    parameters: {
      findingId: { type: 'string', required: true, description: 'Finding id to retest.' },
      notes: { type: 'string', description: 'Optional retest conditions or hints.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec)
      const retest = await store.retestCreate(sessionId, args)
      return {
        retest,
        delegation: `复测漏洞 ${retest.findingId}，retestId=${retest.id}。先调用 ly_retest_begin({ retestId: "${retest.id}" })，再按原始复现步骤验证；结论用 ly_retest_finish 提交。`,
      }
    },
  }))

  ctx.tools.register(tool({
    name: 'ly_attack_path_add',
    description: 'Record one attack path as an ordered list of steps.',
    parameters: {
      title: { type: 'string', required: true, description: 'Path title.' },
      summary: { type: 'string', description: 'One-paragraph path summary.' },
      status: { type: 'string', enum: ['suspected', 'validated', 'blocked', 'closed'], description: 'Path status (default suspected).' },
      steps: {
        type: 'array',
        description: 'Ordered steps.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            edgeId: { type: 'string', description: 'Graph edge id this step traverses.' },
            note: { type: 'string', description: 'What this step does.' },
          },
        },
      },
    },
    output: { schema: objectOutput, render: lineRender('攻击路径已记录：') },
    execute: async (args, exec) => store.addAttackPath(sessionIdOf(exec), args),
  }))

  // Keep the closed vocabularies referenced so schema drift is caught at load.
  void FACT_KINDS
  void FACT_BASES
}

/** Loader entry: commander tool row mounted inside the `lingeye` preset. */
export const name = 'lingeye-commander'
/** Services required by the commander tools. */
export const inject = ['tools', 'systemPrompt', 'lingeyeStore']
/** Mount the commander surface. */
export function apply(ctx) {
  registerCommander(ctx)
}
