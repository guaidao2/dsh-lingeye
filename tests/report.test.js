/**
 * Report and delivery-bundle tests.
 *
 * These cover the pure rendering path with a hand-built snapshot: no DSH
 * runtime, no storage backend. The fixture mirrors what the store serializes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rm, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { buildReport, buildExportBundle } from '../src/report.js'

/** One small engagement snapshot. */
function fixture() {
  const at = '2026-01-01T00:00:00.000Z'
  return {
    engagement: {
      id: 'eng-1', sessionId: 's1', target: 'example.com', objective: '验证报告',
      authorization: '本地测试', scope: 'example.com', status: 'active', createdAt: at,
    },
    goals: [{ id: 'goal-1', sessionId: 's1', text: '验证报告', vulnclass: '', status: 'open', evidenceIds: [], createdAt: at }],
    intents: [{
      id: 'intent-1', sessionId: 's1', goalId: 'goal-1', derivedFromFactIds: [], title: '枚举端点',
      detail: '目录发现', expectedObservation: '出现新端点', state: 'running', priority: 0,
      assetIds: ['asset-1'], createdAt: at, updatedAt: at,
    }],
    facts: [{
      id: 'fact-1', sessionId: 's1', intentId: 'intent-1', kind: 'info', target: 'example.com',
      detail: '事实正文', basis: 'assumed', confidence: 0.5, provenance: 'worker',
      evidenceIds: [], assetIds: ['asset-1'], state: 'confirmed', createdAt: at,
    }],
    findings: [{
      id: 'finding-1', sessionId: 's1', intentId: 'intent-1', vulnclass: 'test', title: '测试漏洞',
      severity: 'low', summary: '摘要', description: '描述', impact: '影响', status: 'pending',
      assetIds: ['asset-1'], evidenceIds: ['evidence-1'],
      reproducibleSteps: ['echo test'], reportMarkdown: '', trustBoundary: '无',
      evidenceVersion: 0, createdAt: at, updatedAt: at,
    }],
    hints: [],
    assets: [{
      id: 'asset-1', sessionId: 's1', type: 'root-domain', value: 'example.com',
      identifier: 'example.com', origin: 'scope', meta: '', createdAt: at,
    }],
    edges: [],
    flows: [{
      id: 'flow-1', sessionId: 's1', source: 'param', transform: 'decode', sink: 'sql',
      evidenceIds: [], confidence: 0.6, createdAt: at,
    }],
    evidence: [{
      id: 'evidence-1', sessionId: 's1', kind: 'command', label: 'echo test',
      content: 'test', refPath: '', sha256: '', size: 4, channel: 'command',
      layers: ['raw'], createdAt: at,
    }],
    activity: [],
    retests: [{
      id: 'retest-1', sessionId: 's1', findingId: 'finding-1', status: 'completed',
      verdict: 'fixed', notes: '复测通过', evidenceIds: [], reportMarkdown: '',
      createdAt: at, finishedAt: at,
    }],
    constraints: [{ id: 'constraint-1', sessionId: 's1', kind: 'deny', text: '不扫端口', origin: 'user', active: true, createdAt: at }],
    attackPaths: [],
  }
}

test('buildReport renders the delivery sections', () => {
  const markdown = buildReport(fixture())
  for (const heading of ['# 灵眼测试报告', '## 目标与判定', '## 探索链路', '## 漏洞', '## 资产', '## 数据流与拼接点', '## 证据', '## 复测', '## 信念缺口', '## 未完成项']) {
    assert.ok(markdown.includes(heading), `missing heading: ${heading}`)
  }
  assert.ok(markdown.includes('example.com'))
  assert.ok(markdown.includes('测试漏洞'))
  assert.ok(markdown.includes('echo test'))
  assert.ok(markdown.includes('信任边界：无'))
  assert.ok(markdown.includes('fact-1：事实正文'))
})

test('buildReport handles an empty engagement', () => {
  const markdown = buildReport({ ...fixture(), engagement: null })
  assert.ok(markdown.includes('尚未建立交战'))
})

test('buildExportBundle writes the delivery files', async () => {
  const dir = join(process.cwd(), '.tmp-test', 'export')
  await rm(join(process.cwd(), '.tmp-test'), { recursive: true, force: true })
  try {
    const result = await buildExportBundle(fixture(), { dir })
    assert.equal(result.dir, dir)
    for (const name of ['report.md', 'findings.json', 'assets.json', 'graph.json', 'coverage.json', 'retests.json']) {
      const info = await stat(join(dir, name))
      assert.ok(info.isFile(), `missing ${name}`)
    }
    const report = await readFile(join(dir, 'report.md'), 'utf8')
    assert.ok(report.includes('测试漏洞'))
    const coverage = JSON.parse(await readFile(join(dir, 'coverage.json'), 'utf8'))
    assert.equal(coverage.total, 1)
    assert.equal(coverage.tested, 1)
    const finding = await readFile(join(dir, 'findings', 'finding-1.md'), 'utf8')
    assert.ok(finding.includes('# 测试漏洞'))
  } finally {
    await rm(join(process.cwd(), '.tmp-test'), { recursive: true, force: true })
  }
})
