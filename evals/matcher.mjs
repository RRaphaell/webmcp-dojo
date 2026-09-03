// Faithful JavaScript port of the scoring logic in Google's `webmcp-evals` CLI
// (https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals,
// files src/matcher.ts and src/utils.ts, commit 41cb97a, 2026-09-02).
// Copyright 2026 Google LLC. SPDX-License-Identifier: Apache-2.0.
// Ported so the Dojo's numbers are computed the same way the official tool
// computes them: subset-matched objects, strict arrays, `$` constraint
// operators, bipartite matching for `unordered`, extra calls fail,
// `expectedCall: null` passes only on zero calls.

export function matchesArgument(expected, actual) {
  if (isConstraintObject(expected)) return matchesConstraint(expected, actual)
  return matchesRecursive(expected, actual)
}

function matchesConstraint(constraint, actual) {
  for (const key of Object.keys(constraint)) {
    if (key === '$pattern') {
      if (typeof actual !== 'string') return false
      if (!buildPattern(constraint[key]).test(actual)) return false
    } else if (key === '$contains') {
      if (typeof actual !== 'string') return false
      if (!actual.includes(constraint[key])) return false
    } else if (['$gt', '$gte', '$lt', '$lte'].includes(key)) {
      if (typeof actual !== 'number') return false
      const val = constraint[key]
      if (key === '$gt' && !(actual > val)) return false
      if (key === '$gte' && !(actual >= val)) return false
      if (key === '$lt' && !(actual < val)) return false
      if (key === '$lte' && !(actual <= val)) return false
    } else if (key === '$type') {
      const type = constraint[key]
      if (type === 'array') { if (!Array.isArray(actual)) return false }
      else if (type === 'null') { if (actual !== null) return false }
      else if (type === 'object') { if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false }
      else if (typeof actual !== type) return false
    } else if (key === '$any') {
      // always matches if present
    }
  }
  return true
}

const SUPPORTED_INLINE_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'])
function buildPattern(raw) {
  const m = /^\(\?([a-zA-Z]+)\)/.exec(raw)
  if (!m) return new RegExp(raw)
  for (const flag of m[1]) if (!SUPPORTED_INLINE_FLAGS.has(flag)) throw new SyntaxError(`Unsupported inline flag "(?${flag})" in $pattern ${JSON.stringify(raw)}`)
  return new RegExp(raw.slice(m[0].length), m[1])
}

function isConstraintObject(obj) {
  if (typeof obj !== 'object' || obj === null) return false
  const keys = Object.keys(obj)
  return keys.length > 0 && keys.every((k) => k.startsWith('$'))
}

function matchesRecursive(expected, actual) {
  if (expected === actual) return true
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return false
  const ea = Array.isArray(expected)
  if (ea !== Array.isArray(actual)) return false
  if (ea) {
    if (expected.length !== actual.length) return false
    for (let i = 0; i < expected.length; i++) if (!matchesArgument(expected[i], actual[i])) return false
    return true
  }
  for (const key of Object.keys(expected)) {
    if (!Object.prototype.hasOwnProperty.call(actual, key) || !matchesArgument(expected[key], actual[key])) return false
  }
  return true
}

// ---- trajectory scoring (utils.ts) ----

export function functionCallOutcome(expected, actual) {
  if (expected === null && actual === null) return 'pass'
  if (!expected || !actual) return 'fail'
  if (expected.functionName !== actual.functionName) return 'fail'
  if (expected.arguments != null && !matchesArgument(expected.arguments, actual.args)) return 'fail'
  if (expected.result !== undefined && !matchesArgument(expected.result, actual.result)) return 'fail'
  return 'pass'
}

const isUnordered = (n) => n !== null && typeof n === 'object' && 'unordered' in n
const isOrdered = (n) => n !== null && typeof n === 'object' && 'ordered' in n
const isCall = (n) => n !== null && typeof n === 'object' && 'functionName' in n

export function countExpectedCalls(nodes) {
  return nodes.reduce((c, n) => {
    if (isUnordered(n)) return c + countExpectedCalls(n.unordered)
    if (isOrdered(n)) return c + countExpectedCalls(n.ordered)
    if (isCall(n) && n.optional) return c
    return c + 1
  }, 0)
}

function hasNested(nodes) { return nodes.some((n) => isUnordered(n) || isOrdered(n)) }

function matchUnorderedGroup(nodes, executions, startIndex) {
  if (!hasNested(nodes)) return matchSimpleUnorderedGroup(nodes, executions, startIndex)
  return matchNestedUnorderedGroup(nodes, executions, startIndex, countExpectedCalls(nodes))
}

function matchSimpleUnorderedGroup(nodes, executions, startIndex) {
  const n = nodes.length
  const pool = Math.max(0, Math.min(n, executions.length - startIndex))
  const adj = []
  for (let i = 0; i < n; i++) {
    if (!isCall(nodes[i])) throw new Error('Expected FunctionCall in simple unordered group')
    const m = []
    for (let j = 0; j < pool; j++) if (functionCallOutcome(nodes[i], executions[startIndex + j]) === 'pass') m.push(j)
    adj.push(m)
  }
  const execToExp = Array(pool).fill(-1)
  function augment(i, visited) {
    for (const j of adj[i]) {
      if (visited[j]) continue
      visited[j] = true
      if (execToExp[j] < 0 || augment(execToExp[j], visited)) { execToExp[j] = i; return true }
    }
    return false
  }
  for (let i = 0; i < n; i++) augment(i, Array(pool).fill(false))
  const matched = new Set()
  for (let j = 0; j < pool; j++) if (execToExp[j] !== -1) matched.add(execToExp[j])
  let req = 0, reqMatched = 0
  for (let i = 0; i < n; i++) { if (nodes[i].optional === true) continue; req++; if (matched.has(i)) reqMatched++ }
  const allMatched = reqMatched === req && pool === matched.size
  const unmatched = nodes.filter((node, i) => !matched.has(i) && node.optional !== true)
  const mapped = []
  for (let j = 0; j < pool; j++) {
    const ei = execToExp[j]
    const actual = executions[startIndex + j]
    if (ei !== -1) mapped.push({ expected: nodes[ei], actual, outcome: 'pass' })
    else mapped.push({ expected: unmatched.shift() || null, actual, outcome: 'fail' })
  }
  for (const expected of unmatched) mapped.push({ expected, actual: null, outcome: 'fail' })
  return { matches: allMatched, consumed: n, mappedResults: mapped }
}

function matchNestedUnorderedGroup(nodes, executions, startIndex, expectedTotalConsumed) {
  const n = nodes.length
  if (n > 15) throw new Error(`Unordered group too large (${n} nodes). Max length is 15.`)
  const best = { matches: false, maxPasses: -1, consumed: 0, mappedResults: [] }
  const visited = Array(n).fill(false)
  const cache = new Map()
  const getMatch = (i, ei) => { const k = `${i}:${ei}`; let r = cache.get(k); if (!r) { r = matchExpectedNode(nodes[i], executions, ei); cache.set(k, r) } return r }
  function backtrack(done, consumed, matches, passes, mapped) {
    if (done === n) {
      if (passes > best.maxPasses) { best.maxPasses = passes; best.matches = matches; best.consumed = consumed; best.mappedResults = [...mapped] }
      return
    }
    const cur = startIndex + consumed
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue
      visited[i] = true
      const r = getMatch(i, cur)
      const p = r.mappedResults.filter((x) => x.outcome === 'pass').length
      mapped.push(...r.mappedResults)
      backtrack(done + 1, consumed + r.consumed, matches && r.matches, passes + p, mapped)
      mapped.length -= r.mappedResults.length
      visited[i] = false
    }
  }
  backtrack(0, 0, true, 0, [])
  return { matches: best.matches, consumed: best.maxPasses >= 0 ? best.consumed : expectedTotalConsumed, mappedResults: best.mappedResults }
}

export function matchExpectedNode(node, executions, startIndex) {
  if (isUnordered(node)) return matchUnorderedGroup(node.unordered, executions, startIndex)
  if (isOrdered(node)) return matchSequence(node.ordered, executions, startIndex)
  if (isCall(node)) {
    if (startIndex >= executions.length) {
      if (node.optional) return { matches: true, consumed: 0, mappedResults: [] }
      return { matches: false, consumed: 1, mappedResults: [{ expected: node, actual: null, outcome: 'fail' }] }
    }
    const actual = executions[startIndex]
    const outcome = functionCallOutcome(node, actual)
    if (node.optional && outcome === 'fail') return { matches: true, consumed: 0, mappedResults: [] }
    return { matches: outcome === 'pass', consumed: 1, mappedResults: [{ expected: node, actual, outcome }] }
  }
  return { matches: false, consumed: 0, mappedResults: [] }
}

export function matchSequence(nodes, executions, startIndex) {
  let cur = startIndex, all = true
  const mapped = []
  for (const node of nodes) {
    const r = matchExpectedNode(node, executions, cur)
    if (!r.matches) all = false
    cur += r.consumed
    mapped.push(...r.mappedResults)
  }
  return { matches: all, consumed: cur - startIndex, mappedResults: mapped }
}

/** executions: [{ functionName, args, result }] in call order. Returns rows [{ expected, actual, outcome }]. */
export function evaluateExecutionTrajectory(expectedCalls, executions) {
  if (!expectedCalls || expectedCalls.length === 0) {
    if (executions.length === 0) return expectedCalls === null ? [{ expected: null, actual: null, outcome: 'pass' }] : []
    return executions.map((actual) => ({ expected: null, actual, outcome: 'fail' }))
  }
  const { mappedResults, consumed } = matchSequence(expectedCalls, executions, 0)
  return [...mappedResults, ...executions.slice(consumed).map((actual) => ({ expected: null, actual, outcome: 'fail' }))]
}

/** The CLI's one-line failure detail (src/reporter). */
export function failureDetail(row) {
  if (row.outcome === 'pass') return '-'
  if (!row.actual) return 'No tool called'
  if (!row.expected) return 'Unexpected tool call'
  if (row.expected.functionName !== row.actual.functionName) return `Function mismatch (expected "${row.expected.functionName}", got "${row.actual.functionName}")`
  if (row.expected.arguments != null && !matchesArgument(row.expected.arguments, row.actual.args)) return 'Arguments mismatch'
  if (row.expected.result !== undefined) return `Result mismatch: expected "${JSON.stringify(row.expected.result)}", got "${String(JSON.stringify(row.actual.result)).slice(0, 37)}..."`
  return 'Failed'
}

/** System prompt the official CLI gives the agent under test (src/evaluator/prompts.ts), reused verbatim so numbers are comparable. */
export const OFFICIAL_SYSTEM_PROMPT = `
# INSTRUCTIONS
You are an agent helping a user navigate a page via the tools made available to you. You must
use the provided tools to query page content when you absolutely need it.
CRITICAL RULE: Do not try to use other tools than the available ones. Never use more tool calls than necessary.

# ADDITIONAL CONTEXT
Today's date is: ${new Date().toDateString()}.
`
