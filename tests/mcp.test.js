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
