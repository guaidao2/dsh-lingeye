import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findCycles, hypothesisGroups, informationGain, coverageOpportunities, goalPaths, counterfactual } from '../src/reasoning.js'

test('cycle detection finds directed cycles and ignores a DAG', () => {
  assert.deepEqual(findCycles([{ srcId: 'a', dstId: 'b' }, { srcId: 'b', dstId: 'c' }]), [])
  const cycles = findCycles([{ srcId: 'a', dstId: 'b' }, { srcId: 'b', dstId: 'a' }])
  assert.equal(cycles.length, 1)
  assert.deepEqual(cycles[0].slice(0, 2).sort(), ['a', 'b'])
})

test('hypothesis groups separate support from contradiction', () => {
  const groups = hypothesisGroups([
    { id: 'f1', target: 'host', kind: 'port', basis: 'observed', confidence: 0.8 },
    { id: 'f2', target: 'host', kind: 'port', basis: 'negative', confidence: 0.9 },
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].supportIds, ['f1'])
  assert.deepEqual(groups[0].contradictionIds, ['f2'])
  assert.equal(groups[0].competing, true)
})

test('information gain stays normalized and coverage opportunities sort by gain', () => {
  const intent = { priority: 5, assetIds: ['a'], derivedFromFactIds: [] }
  const gain = informationGain(intent, { facts: [] })
  assert.ok(gain >= 0 && gain <= 1)
  const opportunities = coverageOpportunities([{ id: 'a', type: 'ip', value: '1' }, { id: 'b', type: 'ip', value: '2' }], new Set(['a']))
  assert.deepEqual(opportunities.map(item => item.id), ['b'])
})

test('goal paths walk recorded edges from open goals', () => {
  const result = goalPaths({
    goals: [{ id: 'g1', status: 'open', text: 'goal' }],
    edges: [{ srcId: 'g1', dstId: 'i1', kind: 'spawns' }, { srcId: 'i1', dstId: 'f1', kind: 'yields' }],
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].paths.length, 2)
})

test('counterfactual replay drops selected facts and reports coverage change', () => {
  const data = {
    facts: [{ id: 'f1', target: 'host', kind: 'port', basis: 'observed', confidence: 0.8, assetIds: ['a1'], evidenceIds: ['e1'] }],
    evidence: [{ id: 'e1' }],
    edges: [{ srcId: 'f1', dstId: 'a1', kind: 'anchors' }],
  }
  const replay = counterfactual(data, ['f1'])
  assert.equal(replay.coverageBefore, 1)
  assert.equal(replay.coverageAfter, 0)
  assert.deepEqual(replay.removedFacts, ['f1'])
})
