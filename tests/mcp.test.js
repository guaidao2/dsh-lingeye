import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

test('MCP settings stay in the lingeye domain and use the official client', () => {
  const spec = read('spec.js')
  assert.match(spec, /mcp_servers: domainTable\(mcpServerSchema\)/)
  const store = read('store.js')
  assert.match(store, /async mcpServers\(\)/)
  assert.match(store, /async saveMcpServer/)
  assert.match(store, /async deleteMcpServer/)
  assert.match(store, /input\.command\.trim\(\) === ''/)
  const mcp = read('mcp.js')
  assert.match(mcp, /@deepseek-ai\/dsh-mcp-client/)
  assert.match(mcp, /ctx\.plugin\(McpClient/)
  assert.match(mcp, /path: '\/lingeye\/mcp'/)
})

test('control center exposes the expected tabs and manual cookie cleanup', () => {
  const client = read('client.js')
  assert.match(client, /function McpPanel\(\)/)
  assert.match(client, /'overview'.*'projects'.*'environment'.*'mcp'/)
  assert.match(client, /cleanupCookies/)
  assert.match(client, /action: 'cleanup-cookies'/)
  assert.match(client, /confirm: true/)
})


test('0.6 decision-layer tools are registered', () => {
  const commander = readFileSync(new URL('../src/commander.js', import.meta.url), 'utf8')
  for (const name of ['ly_concept_add', 'ly_concept_link', 'ly_graph_prune', 'ly_graph_decay', 'ly_causal_audit', 'ly_counterfactual', 'ly_evidence_retire']) {
    assert.match(commander, new RegExp(`name: '${name}'`))
  }
})
