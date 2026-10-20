/**
 * Retest subagent tools for the 灵眼 mode (`lingeye-retest` preset).
 *
 * A retest is an independent session over one finding: it reproduces from the
 * recorded steps and records a verdict without mutating the original finding
 * except for the automatic `fixed` status transition on a fixed verdict.
 *
 * @module dsh-lingeye/retest
 */

import { tool } from './tool.js'
import { RETEST_PROTOCOL, RETEST_SECTION, SECTION_ORDER } from './instructions.js'

/** Resolve the parent engagement session of a delegated retester. */
function parentSessionIdOf(exec) {
  const parentSessionId = exec.agent?.session?.header?.parentSession
  if (parentSessionId === undefined || parentSessionId === '') {
    throw new Error('lingeye retest tools are only available to a delegated subagent with a parent session')
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

/** Register the retest tools and protocol section. */
export function registerRetest(ctx) {
  const store = ctx.lingeyeStore
  ctx.systemPrompt.section({
    name: RETEST_SECTION,
    order: SECTION_ORDER,
    text: RETEST_PROTOCOL,
  })

  ctx.tools.register(tool({
    name: 'ly_retest_begin',
    description: 'Mark the retest running and read the original finding snapshot (steps, evidence, assets) needed to reproduce it.',
    parameters: {
      retestId: { type: 'string', required: true, description: 'Retest id supplied in the delegation.' },
    },
    output: { schema: objectOutput, render: jsonRender },
    execute: async (args, exec) => store.retestBegin(parentSessionIdOf(exec), args.retestId),
  }))

  ctx.tools.register(tool({
    name: 'ly_retest_finish',
    description: 'Submit the retest verdict and new evidence: reproduced (still exploitable), fixed, or inconclusive.',
    parameters: {
      retestId: { type: 'string', required: true, description: 'Retest id.' },
      verdict: { type: 'string', required: true, enum: ['reproduced', 'fixed', 'inconclusive'], description: 'Retest verdict.' },
      notes: { type: 'string', description: 'Conditions, differences from the original run, or why inconclusive.' },
      reportMarkdown: { type: 'string', description: 'Optional detailed retest report.' },
      evidence: {
        type: 'array',
        description: 'New evidence captured during the retest.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['http', 'command', 'file', 'text', 'image'], description: 'Evidence kind.' },
            label: { type: 'string', required: true, description: 'Short label.' },
            content: { type: 'string', description: 'Evidence body.' },
            refPath: { type: 'string', description: 'Optional file path.' },
            channel: { type: 'string', description: 'Observation channel.' },
            layers: { type: 'array', description: 'Per-layer interpretations.', items: { type: 'string' } },
          },
        },
      },
    },
    output: { schema: objectOutput, render: jsonRender },
    execute: async (args, exec) => store.retestFinish(parentSessionIdOf(exec), args),
  }))
}

/** Loader entry: retest tool row mounted inside the `lingeye-retest` preset. */
export const name = 'lingeye-retest'
/** Services required by the retest tools. */
export const inject = ['tools', 'systemPrompt', 'lingeyeStore']
/** Mount the retest surface. */
export function apply(ctx) {
  registerRetest(ctx)
}
