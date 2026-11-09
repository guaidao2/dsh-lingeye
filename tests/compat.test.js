import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

test('subagent activation uses the flat 0.2.2 spec', () => {
  const store = read('src/store.js')
  const start = store.indexOf('startActivation(')
  const block = store.slice(start, store.indexOf('})', start))
  assert.match(block, /parent,/)
  assert.match(block, /agentPreset: 'lingeye-worker'/)
  assert.doesNotMatch(block, /request:/)
})

test('git bash uses the execution guard, not prompt tool filtering', () => {
  const gitbash = read('src/gitbash.js')
  const preset = read('presets/lingeye.patch.yml')
  assert.doesNotMatch(gitbash, /system-prompt\/assemble/)
  assert.match(gitbash, /exec\?\.name === 'pwsh'/)
  assert.equal((preset.match(/dsh-lingeye\/gitbash-agent/g) ?? []).length, 0)
})

test('pwsh is mounted by the agent gate only while Git Bash is off', () => {
  const gate = read('src/pwsh-gate.js')
  const preset = read('presets/lingeye.patch.yml')
  assert.match(gate, /ctx\.plugin\(plugin, \{\}\)/)
  assert.match(gate, /fiber\.dispose\(\)/)
  assert.equal((preset.match(/dsh-lingeye\/pwsh-gate/g) ?? []).length, 8)
  assert.equal((preset.match(/id: pwsh-gate[\s\S]{0,120}?disabled: !!js process\.platform !== 'win32'/g) ?? []).length, 8)
  assert.doesNotMatch(preset, /id: tool-pwsh/)
})

test('MCP config carries the 0.2.2 cleanup fields', () => {
  const mcp = read('src/mcp.js')
  assert.match(mcp, /closeTimeoutMs: 5000/)
  assert.match(mcp, /expandTemplates: false/)
})
