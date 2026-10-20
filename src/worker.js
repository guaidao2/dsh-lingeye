/**
 * Execution subagent tools for the 灵眼 mode (`lingeye-worker` preset).
 *
 * Workers never create graph structure: they read their intent context from
 * the parent engagement and submit observed results back into it. The parent
 * session is resolved from the durable delegation lineage.
 *
 * @module dsh-lingeye/worker
 */

import { tool } from './tool.js'
import {
  ASSET_TYPES, SEVERITIES, FACT_KINDS, FACT_BASES,
} from './spec.js'
import { WORKER_PROTOCOL, WORKER_SECTION, SECTION_ORDER } from './instructions.js'

/** Resolve the parent engagement session of a delegated worker. */
function parentSessionIdOf(exec) {
  const parentSessionId = exec.agent?.session?.header?.parentSession
  if (parentSessionId === undefined || parentSessionId === '') {
    throw new Error('lingeye worker tools are only available to a delegated subagent with a parent session')
  }
  return parentSessionId
}

/** A permissive object output schema. */
const objectOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {},
}

/** Render a JSON value. */
function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Register the worker tools and protocol section. */
export function registerWorker(ctx) {
  const store = ctx.lingeyeStore
  ctx.systemPrompt.section({
    name: WORKER_SECTION,
    order: SECTION_ORDER,
    text: WORKER_PROTOCOL,
  })

  ctx.tools.register(tool({
    name: 'ly_fetch',
    description: 'Fetch the delegated intent with the parent engagement context: goal, known facts (with basis), assets, active hints, constraints and existing findings. Read this before executing.',
    parameters: {
      intentId: { type: 'string', required: true, description: 'The parent intent id supplied in the delegation.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    execute: async (args, exec) => {
      const sessionId = parentSessionIdOf(exec)
      const state = await store.snapshot(sessionId)
      if (state.engagement === null) throw new Error('parent engagement is not initialized')
      const intent = state.intents.find(item => item.id === args.intentId)
      if (intent === undefined) throw new Error(`unknown parent intent ${args.intentId}`)
      const factsByIntent = state.facts.filter(fact => fact.intentId === intent.id || intent.derivedFromFactIds.includes(fact.id))
      return {
        engagement: state.engagement,
        intent,
        goal: state.goals.find(goal => goal.id === intent.goalId) ?? null,
        facts: factsByIntent.slice(-30),
        assets: state.assets,
        hints: state.hints.filter(hint => hint.state === 'active').slice(-10),
        constraints: state.constraints.filter(constraint => constraint.active),
        findings: state.findings.filter(finding => finding.intentId === intent.id),
      }
    },
  }))

  ctx.tools.register(tool({
    name: 'ly_asset_add',
    description: 'Record one newly discovered asset in the parent engagement (normalized, de-duplicated). Parent assets must already exist.',
    parameters: {
      type: { type: 'string', required: true, enum: ASSET_TYPES, description: 'Asset type.' },
      value: { type: 'string', required: true, description: 'Asset value.' },
      parentId: { type: 'string', description: 'Existing parent asset id.' },
      meta: { type: 'string', description: 'Optional metadata.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    execute: async (args, exec) => store.addAsset(parentSessionIdOf(exec), args),
  }))

  ctx.tools.register(tool({
    name: 'ly_submit',
    description: 'Atomically submit confirmed results into the delegated intent: facts (with basis), new assets, findings (with reproducible steps), evidence (with channel/layers), dataflows and activity notes. Submit incrementally; never resubmit an item.',
    parameters: {
      intentId: { type: 'string', required: true, description: 'The parent intent id supplied in the delegation.' },
      facts: {
        type: 'array',
        description: 'Observed, inferred, assumed or negative facts.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: FACT_KINDS, description: 'Fact kind (default info).' },
            target: { type: 'string', description: 'Host/URL/service this fact refers to.' },
            detail: { type: 'string', required: true, description: 'The observation and what it means.' },
            basis: { type: 'string', enum: FACT_BASES, description: 'Belief basis (default observed).' },
            confidence: { type: 'number', description: 'Belief strength 0..1.' },
            provenance: { type: 'string', description: 'Where the observation came from (command, response, file).' },
            evidenceIds: { type: 'array', description: 'Evidence ids from this or earlier submissions.', items: { type: 'string' } },
            assetIds: { type: 'array', description: 'Assets this fact anchors.', items: { type: 'string' } },
          },
        },
      },
      assets: {
        type: 'array',
        description: 'New assets discovered during execution.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', required: true, enum: ASSET_TYPES, description: 'Asset type.' },
            value: { type: 'string', required: true, description: 'Asset value.' },
            parentId: { type: 'string', description: 'Existing parent asset id.' },
            meta: { type: 'string', description: 'Optional metadata.' },
          },
        },
      },
      findings: {
        type: 'array',
        description: 'Confirmed vulnerabilities only; each needs reproducible steps.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            vulnclass: { type: 'string', description: 'Vulnerability class.' },
            title: { type: 'string', required: true, description: 'Short finding title.' },
            severity: { type: 'string', enum: SEVERITIES, description: 'Severity (default info).' },
            summary: { type: 'string', description: 'One-paragraph summary.' },
            description: { type: 'string', description: 'Root cause and details.' },
            impact: { type: 'string', description: 'Impact.' },
            trustBoundary: { type: 'string', description: 'For token/assertion issues: who asserts, who verifies, what is trusted.' },
            reproducibleSteps: { type: 'array', required: true, description: 'Ordered reproduction steps.', items: { type: 'string' } },
            assetIds: { type: 'array', description: 'Affected asset ids.', items: { type: 'string' } },
            evidenceIds: { type: 'array', description: 'Supporting evidence ids.', items: { type: 'string' } },
            reportMarkdown: { type: 'string', description: 'Optional detailed Markdown report.' },
          },
        },
      },
      evidence: {
        type: 'array',
        description: 'Evidence records created in this submission.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['http', 'command', 'file', 'text', 'image'], description: 'Evidence kind (default text).' },
            label: { type: 'string', required: true, description: 'Short label.' },
            content: { type: 'string', description: 'Evidence body.' },
            refPath: { type: 'string', description: 'Optional file path for large evidence.' },
            channel: { type: 'string', description: 'Observation channel (error/boolean/time/oob).' },
            layers: { type: 'array', description: 'Per-layer interpretations.', items: { type: 'string' } },
          },
        },
      },
      flows: {
        type: 'array',
        description: 'Dataflows / concat points discovered.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', required: true, description: 'Input source.' },
            transform: { type: 'string', description: 'Transforms along the path.' },
            sink: { type: 'string', required: true, description: 'Sink interpreter.' },
            evidenceIds: { type: 'array', description: 'Supporting evidence ids.', items: { type: 'string' } },
            confidence: { type: 'number', description: 'Confidence 0..1.' },
          },
        },
      },
      activity: {
        type: 'array',
        description: 'Execution notes for the activity timeline.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', description: 'Activity kind (note/tool/result).' },
            tool: { type: 'string', description: 'Tool name.' },
            summary: { type: 'string', description: 'Short summary.' },
            detail: { type: 'string', description: 'Longer detail (keep command output in evidence instead).' },
          },
        },
      },
    },
    output: { schema: objectOutput, render: jsonRender },
    execute: async (args, exec) => store.submit(parentSessionIdOf(exec), args),
  }))

  ctx.tools.register(tool({
    name: 'ly_trace_append',
    description: 'Append one execution note to the parent engagement activity timeline without submitting facts.',
    parameters: {
      intentId: { type: 'string', required: true, description: 'Delegated intent id.' },
      summary: { type: 'string', required: true, description: 'One-line note.' },
      detail: { type: 'string', description: 'Optional detail.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    execute: async (args, exec) => store.addActivity(parentSessionIdOf(exec), {
      intentId: args.intentId, worker: 'worker', kind: 'note',
      summary: args.summary, detail: args.detail ?? '',
    }),
  }))
}

/** Loader entry: worker tool row mounted inside the `lingeye-worker` preset. */
export const name = 'lingeye-worker'
/** Services required by the worker tools. */
export const inject = ['tools', 'systemPrompt', 'lingeyeStore']
/** Mount the worker surface. */
export function apply(ctx) {
  registerWorker(ctx)
}
