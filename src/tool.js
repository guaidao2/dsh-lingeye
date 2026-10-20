/**
 * `defineTool` wrapper that makes every execute result canonical JSON.
 *
 * Records contain optional fields; `undefined` is valid JS but invalid in the
 * tool result pipeline. The wrapper round-trips the value before the registry
 * validates it, so tool surfaces never leak non-JSON members.
 *
 * @module dsh-lingeye/tool
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { plain } from './plain.js'

/** Register one tool whose execute result is JSON-plain. */
export function tool(definition) {
  const execute = definition.execute
  return defineTool({
    ...definition,
    execute: async (args, exec) => plain(await execute(args, exec)),
  })
}
