/** Contract guards for project aggregation and the global panel. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const readPreset = () => readFileSync(new URL('../presets/lingeye.patch.yml', import.meta.url), 'utf8')

test('projectId is optional and old engagements stay valid', () => {
  const spec = read('spec.js')
  assert.match(spec, /projectId: z\.string\(\)\.default\(''\)/)
  assert.match(spec, /acceptance: z\.string\(\)\.default\(''\)/)
  const store = read('store.js')
  assert.match(store, /projectId: String\(input\.projectId \?\? ''\)\.trim\(\)/)
  assert.match(store, /acceptance: String\(input\.acceptance \?\? ''\)\.trim\(\)/)
  assert.match(store, /async linkProject\(sessionId, projectId\)/)
})

test('commander exposes project linking without moving records', () => {
  const commander = read('commander.js')
  assert.match(commander, /name: 'ly_project_link'/)
  assert.match(commander, /store\.linkProject\(sessionIdOf\(exec\), args\.projectId\)/)
  assert.match(commander, /projectId: \{ type: 'string'/)
})

test('client registers the global project page and the readable graph', () => {
  const client = read('client.js')
  assert.match(client, /key: 'lingeye-projects'/)
  assert.match(client, /name: 'sidebar\.panellist'/)
  assert.match(client, /projectionsBySession/)
  assert.match(client, /function ProjectsPanel/)
  assert.match(client, /foreignObject/)
  assert.match(client, /fullscreen/)
})

test('role presets are declared, allowed, and inserted before the commander', () => {
  const presets = readPreset()
  const commanderAt = presets.indexOf('- id: preset-lingeye\n')
  assert.ok(commanderAt > 0)
  for (const id of ['lingeye-intel', 'lingeye-enumerator', 'lingeye-threat-modeler']) {
    const at = presets.indexOf(`- id: preset-${id}\n`)
    assert.ok(at >= 0, `missing preset ${id}`)
    assert.ok(at < commanderAt, `${id} must precede the commander preset`)
    assert.match(presets, new RegExp(`- ${id}`))
  }
})

test('goal acceptance reaches the report and the UI contract', () => {
  assert.match(read('report.js'), /goal\.acceptance/)
  assert.match(read('client.js'), /验收：/)
})

test('project unlink keeps records and is exposed to the commander', () => {
  const store = read('store.js')
  assert.match(store, /async projectSessionIds\(projectId\)/)
  assert.match(store, /async unlinkProject\(projectId, callerSessionId\)/)
  assert.match(store, /projectId: ''/)
  assert.match(store, /project_tombstones/)
  const commander = read('commander.js')
  assert.match(commander, /name: 'ly_project_unlink'/)
  assert.match(commander, /store\.unlinkProject\(args\.projectId, sessionIdOf\(exec\)\)/)
  const client = read('client.js')
  assert.match(client, /userSelect: 'none'/)
  assert.match(client, /解除分组/)
  assert.match(client, /归档会话/)
  assert.match(client, /archiveSession/)
  assert.match(client, /projectTombstones/)
})
