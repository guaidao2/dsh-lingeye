/**
 * Pure reasoning helpers for the 灵眼 decision layer.
 *
 * They turn the recorded graph into planner-facing signals without writing
 * state: causal cycles, competing hypotheses, information gain, and goal
 * paths. Keeping them pure makes the planner testable and lets the Web tab
 * reuse the same calculations.
 *
 * @module dsh-lingeye/reasoning
 */

/** Directed cycle search over session edges. */
export function findCycles(edges) {
  const adjacency = new Map()
  for (const edge of edges) {
    if (!adjacency.has(edge.srcId)) adjacency.set(edge.srcId, [])
    adjacency.get(edge.srcId).push(edge.dstId)
  }
  const color = new Map()
  const stack = []
  const cycles = []
  const visit = (node) => {
    color.set(node, 1)
    stack.push(node)
    for (const next of adjacency.get(node) ?? []) {
      if (color.get(next) === 1) {
        const start = stack.indexOf(next)
        if (start >= 0) cycles.push([...stack.slice(start), next])
      } else if (color.get(next) !== 2) {
        visit(next)
      }
    }
    stack.pop()
    color.set(node, 2)
  }
  for (const node of adjacency.keys()) if (color.get(node) === undefined) visit(node)
  return cycles
}

/** Group facts into competing hypotheses by target + kind. */
export function hypothesisGroups(facts) {
  const groups = new Map()
  for (const fact of facts) {
    const key = `${fact.target || ''}\u0000${fact.kind || 'info'}`
    let group = groups.get(key)
    if (group === undefined) {
      group = { target: fact.target || '', kind: fact.kind || 'info', positive: [], negative: [], assumed: [] }
      groups.set(key, group)
    }
    if (fact.basis === 'negative') group.negative.push(fact)
    else if (fact.basis === 'assumed') group.assumed.push(fact)
    else group.positive.push(fact)
  }
  return [...groups.values()].map((group) => {
    const support = group.positive.reduce((value, fact) => value * (1 - fact.confidence), 1)
    const contradiction = group.negative.reduce((value, fact) => value * (1 - fact.confidence), 1)
    return {
      target: group.target,
      kind: group.kind,
      confidence: Math.max(0, Math.min(1, (1 - support) * contradiction + (group.assumed.length === 0 ? 0 : 0.05))),
      supportIds: group.positive.map(fact => fact.id),
      contradictionIds: group.negative.map(fact => fact.id),
      assumedIds: group.assumed.map(fact => fact.id),
      competing: group.positive.length > 1 || group.negative.length > 0,
    }
  })
}

/** Expected information gain of one experiment, normalized to 0..1. */
export function informationGain(intent, data) {
  const assetCount = Array.isArray(intent.assetIds) ? intent.assetIds.length : 0
  const hasAssets = assetCount > 0
  const dependencyPenalty = Array.isArray(intent.derivedFromFactIds) && intent.derivedFromFactIds.length > 0 ? 0.15 : 0
  const cost = Number.isFinite(intent.priority) ? Math.max(0, Math.min(1, intent.priority / 10)) : 0.5
  const uncertainty = Math.max(0, 1 - (data.facts?.length ?? 0) / 50)
  const base = hasAssets ? 0.55 : 0.35
  return Math.max(0, Math.min(1, base + uncertainty * 0.35 - dependencyPenalty - cost * 0.2))
}

/** Coverage opportunities sorted by remaining untested surface. */
export function coverageOpportunities(assets, testedIds) {
  const total = assets.length
  return assets
    .filter(asset => !testedIds.has(asset.id))
    .map(asset => ({ id: asset.id, type: asset.type, value: asset.value, gain: total === 0 ? 0 : 1 / total }))
    .sort((left, right) => right.gain - left.gain)
}

/** Walk forward from each open goal through recorded edges. */
export function goalPaths(data) {
  const edgesBySource = new Map()
  for (const edge of data.edges ?? []) {
    if (!edgesBySource.has(edge.srcId)) edgesBySource.set(edge.srcId, [])
    edgesBySource.get(edge.srcId).push(edge)
  }
  const openGoals = (data.goals ?? []).filter(goal => goal.status === 'open')
  return openGoals.map((goal) => {
    const paths = []
    const walk = (node, path, seen) => {
      if (seen.has(node)) return
      seen.add(node)
      for (const edge of edgesBySource.get(node) ?? []) {
        const next = { edgeKind: edge.kind, id: edge.dstId }
        const nextPath = [...path, next]
        paths.push(nextPath)
        walk(edge.dstId, nextPath, new Set(seen))
      }
    }
    walk(goal.id, [], new Set())
    return { goalId: goal.id, text: goal.text, paths: paths.slice(-20) }
  })
}

/**
 * Replay the recorded state without a set of facts/evidence and report what
 * changes. Used as a counterfactual check, not as a second source of truth.
 */
export function counterfactual(data, removeIds) {
  const removed = new Set(removeIds)
  const facts = (data.facts ?? []).filter(fact => !removed.has(fact.id))
  const evidence = (data.evidence ?? []).filter(item => !removed.has(item.id))
  const edges = (data.edges ?? []).filter(edge => !removed.has(edge.srcId) && !removed.has(edge.dstId))
  const coveredBefore = new Set()
  const coveredAfter = new Set()
  for (const fact of data.facts ?? []) for (const assetId of fact.assetIds ?? []) if ((fact.evidenceIds ?? []).length > 0) coveredBefore.add(assetId)
  for (const fact of facts) for (const assetId of fact.assetIds ?? []) if ((fact.evidenceIds ?? []).length > 0) coveredAfter.add(assetId)
  return {
    removedIds: [...removed],
    hypothesesBefore: hypothesisGroups(data.facts ?? []),
    hypothesesAfter: hypothesisGroups(facts),
    coverageBefore: coveredBefore.size,
    coverageAfter: coveredAfter.size,
    removedFacts: (data.facts ?? []).filter(fact => removed.has(fact.id)).map(fact => fact.id),
    removedEvidence: (data.evidence ?? []).filter(item => removed.has(item.id)).map(item => item.id),
    danglingEdges: edges.filter(edge => removed.has(edge.srcId) || removed.has(edge.dstId)).length,
  }
}
