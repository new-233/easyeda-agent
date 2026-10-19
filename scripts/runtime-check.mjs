import { pathToFileURL } from 'node:url'

const dir = process.env.EASYEDA_DIR
const tools = await import(pathToFileURL(dir + '/lib/tools.js').href)
const transport = await import(pathToFileURL(dir + '/lib/transport.js').href)

/** 递归检测 undefined（DSH 要求工具返回值是无损 JSON，undefined 会判非法）。 */
function findUndefined(value, path = '$') {
  if (value === undefined) return path
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findUndefined(value[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  for (const [key, item] of Object.entries(value)) {
    const hit = findUndefined(item, `${path}.${key}`)
    if (hit) return hit
  }
  return null
}

/** 断言：无 undefined，且 JSON 往返无损。 */
function assertLossless(label, value) {
  const bad = findUndefined(value)
  if (bad) {
    console.log(`FAIL ${label}: contains undefined at ${bad}`)
    process.exitCode = 1
    return
  }
  const round = JSON.parse(JSON.stringify(value))
  if (JSON.stringify(round) !== JSON.stringify(value)) {
    console.log(`FAIL ${label}: JSON round-trip is lossy`)
    process.exitCode = 1
    return
  }
  console.log(`OK   ${label}: lossless JSON`)
}

// 用不存在的二进制，保证离线、可复现，同时覆盖 transport 的成功/失败两条路径。
const cfg = { easyedaBin: '__definitely_missing__', timeoutMs: 5000 }
const fakeCtx = { logger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }
const defs = tools.buildToolDefinitions(fakeCtx, cfg)
const byName = Object.fromEntries(defs.map((d) => [d.name, d]))

// 1) 纯知识工具
assertLossless('easyeda_knowledge(list)', await byName.easyeda_knowledge.execute({}))
assertLossless('easyeda_knowledge(rules)', await byName.easyeda_knowledge.execute({ topic: 'rules' }))
assertLossless('easyeda_knowledge(process)', await byName.easyeda_knowledge.execute({ topic: 'process' }))

// 2) CLI 工具（后端缺失 → 走失败路径，必须仍然无损）
assertLossless('easyeda_health(missing bin)', await byName.easyeda_health.execute({}))
assertLossless('easyeda_actions(missing bin)', await byName.easyeda_actions.execute({}))
assertLossless('easyeda_call(missing bin)', await byName.easyeda_call.execute({ action: 'project.create', window: 'w', payload: {} }))
// 全流程两条主力通道：后端缺失时也必须走失败路径而不是抛异常。
assertLossless('easyeda_apply(missing bin)', await byName.easyeda_apply.execute({ playbook: 'p.json', project: 'proj' }))
assertLossless('easyeda_gate(missing bin)', await byName.easyeda_gate.execute({ scope: 'sch', command: 'gate', project: 'proj', doc: 'P1' }))
assertLossless('easyeda_blocks(missing bin)', await byName.easyeda_blocks.execute({ operation: 'list' }))
assertLossless('easyeda_workflow(missing bin)', await byName.easyeda_workflow.execute({ operation: 'status', project: 'p' }))

// 3) transport 失败信封
assertLossless('runEasyeda(missing bin)', await transport.runEasyeda(['daemon', 'health'], { config: cfg, timeoutMs: 5000 }))

// 4) 真实后端（若可用）：健康检查与动作目录
const real = await transport.runEasyeda(['daemon', 'health'], { config: { easyedaBin: '', timeoutMs: 30000 } })
assertLossless('runEasyeda(real daemon health)', real)
console.log(real.ok ? 'INFO 真实后端可用（daemon health ok）' : 'INFO 真实后端不可用（跳过实机校验）')

console.log(process.exitCode ? 'RUNTIME_FAILED' : 'RUNTIME_OK')
