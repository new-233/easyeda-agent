/**
 * flow-selftest.mjs — 全流程执行通道的离线自检（不需要 daemon / EDA 窗口）。
 *
 * 覆盖本轮新增的两条主力通道：
 *   1. easyeda_apply  → buildApplyArgs（playbook 回放）
 *   2. easyeda_gate   → buildGateArgs（阶段验收门）
 *
 * 断言的是**精确 argv**与**守卫必然报错**：argv 拼错会让现场跑出错误的设计动作，
 * 守卫漏掉会让 agent 绕过确认门或存错页面，所以两者都必须逐字验证。
 *
 * 用法：EASYEDA_DIR=<插件目录> node scripts/flow-selftest.mjs
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const dir = process.env.EASYEDA_DIR
if (!dir) {
  console.log('FAIL EASYEDA_DIR is required (path to the plugin dir)')
  process.exit(1)
}

const actions = await import(pathToFileURL(dir + '/lib/actions.js').href)
const { buildApplyArgs, buildGateArgs, GATE_SPEC, GATE_COMMANDS } = actions

let passed = 0
let failed = 0

function ok(label) {
  passed += 1
  console.log(`OK   ${label}`)
}

function bad(label, detail) {
  failed += 1
  console.log(`FAIL ${label}: ${detail}`)
}

/** 断言 argv 逐字相等。 */
function argv(label, actual, expected) {
  try {
    assert.deepEqual(actual, expected)
    ok(`${label} → ${JSON.stringify(actual)}`)
  } catch {
    bad(label, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`)
  }
}

/** 断言调用必然抛错，且错误信息含关键片段（守卫不能变成静默通过）。 */
function refuses(label, fn, needle) {
  try {
    const produced = fn()
    bad(label, `expected a refusal but got ${JSON.stringify(produced)}`)
  } catch (error) {
    const message = String(error?.message ?? error)
    if (needle && !message.includes(needle)) bad(label, `refused but message lacks "${needle}": ${message}`)
    else ok(`${label} → refused (${message})`)
  }
}

// ---------------------------------------------------------------- apply ----

argv('apply(minimal)', buildApplyArgs({ playbook: 'sch.playbook.json' }), [
  'apply', 'sch.playbook.json',
])

argv('apply(routed + all switches)', buildApplyArgs({
  playbook: 'pcb.playbook.json',
  project: 'demo',
  doc: 'PCB1',
  dryRun: true,
  quiet: true,
  yes: true,
  from: '2',
  to: '5',
  journal: 'j.jsonl',
  stepDelay: 1,
  vars: { UID_U1: 'gge1' },
}), [
  '--project', 'demo',
  'apply', 'pcb.playbook.json',
  '--doc', 'PCB1',
  '--dry-run', '--quiet', '--yes',
  '--from', '2', '--to', '5', '--journal', 'j.jsonl',
  '--step-delay', '1',
  '--var', 'UID_U1=gge1',
])

// 窗口路由：不传 project 时用 --window，且不得与 project 同时出现。
argv('apply(window routing)', buildApplyArgs({ playbook: 'p.json', window: 'w1' }), [
  'apply', 'p.json', '--window', 'w1',
])

// 默认不开确认门：不传 yes 就不该出现 --yes。
{
  const produced = buildApplyArgs({ playbook: 'p.json', project: 'demo' })
  if (produced.includes('--yes')) bad('apply(no implicit --yes)', 'the confirmation gate was opened without being asked')
  else ok('apply(no implicit --yes) → gate stays closed')
}

refuses('apply(missing playbook)', () => buildApplyArgs({}), 'playbook is required')
refuses('apply(non-json playbook)', () => buildApplyArgs({ playbook: 'run.sh' }), 'must be a .json file')
refuses('apply(dryRun+resume)', () => buildApplyArgs({ playbook: 'p.json', dryRun: true, resume: true }), 'contradictory')
refuses('apply(project+window)', () => buildApplyArgs({ playbook: 'p.json', project: 'a', window: 'b' }), 'not both')
refuses('apply(negative stepDelay)', () => buildApplyArgs({ playbook: 'p.json', stepDelay: -1 }), 'non-negative')
refuses('apply(vars as array)', () => buildApplyArgs({ playbook: 'p.json', vars: ['A=1'] }), 'object of KEY=VALUE')
refuses('apply(bad var name)', () => buildApplyArgs({ playbook: 'p.json', vars: { '1BAD': 'x' } }), 'invalid playbook var name')
refuses('apply(nested var value)', () => buildApplyArgs({ playbook: 'p.json', vars: { A: { b: 1 } } }), 'must be a scalar')
refuses('apply(non-bool dryRun)', () => buildApplyArgs({ playbook: 'p.json', dryRun: 'yes' }), 'must be a boolean')

// ----------------------------------------------------------------- gate ----

argv('gate(sch gate --strict --json --only)', buildGateArgs({
  scope: 'sch', command: 'gate', project: 'demo', doc: 'P1',
  strict: true, json: true, only: 'layout-lint,drc',
}), [
  '--project', 'demo', 'sch', 'gate', '--doc', 'P1',
  '--strict', '--json', '--only', 'layout-lint,drc',
])

argv('gate(pcb drc timeout)', buildGateArgs({
  scope: 'pcb', command: 'drc', project: 'demo', doc: 'PCB1', json: true, timeout: 90,
}), [
  '--project', 'demo', 'pcb', 'drc', '--doc', 'PCB1', '--json', '--timeout', '90',
])

// 键顺序无关：同样的入参换个顺序必须得到同样的 argv。
{
  const a = buildGateArgs({ scope: 'sch', command: 'layout-lint', minGap: 2.54, strict: true })
  const b = buildGateArgs({ minGap: 2.54, strict: true, command: 'layout-lint', scope: 'sch' })
  argv('gate(key order independent)', a, b)
}

// 无额外旗标的子命令：任何额外键都必须被拒绝，而不是拼进 argv。
argv('gate(pcb list: no flags)', buildGateArgs({ scope: 'pcb', command: 'list', project: 'demo' }), [
  '--project', 'demo', 'pcb', 'list',
])
refuses('gate(pcb list + strict)', () => buildGateArgs({ scope: 'pcb', command: 'list', strict: true }), 'takes no extra flags')
// pcb layout-lint 没有 --strict（只有 --gate 历史模式，未收录）：必须拒绝。
refuses('gate(pcb layout-lint + strict)', () => buildGateArgs({ scope: 'pcb', command: 'layout-lint', strict: true }), 'has no flag')
// 已弃用的 --gate 历史模式故意不在白名单里。
refuses('gate(pcb layout-lint + deprecated gate)', () => buildGateArgs({ scope: 'pcb', command: 'layout-lint', gate: true }), 'has no flag')
refuses('gate(unknown scope)', () => buildGateArgs({ scope: 'lib', command: 'list' }), 'scope must be one of')
refuses('gate(unknown command)', () => buildGateArgs({ scope: 'sch', command: 'autoroute' }), 'unknown sch command')
refuses('gate(save without doc)', () => buildGateArgs({ scope: 'pcb', command: 'save', project: 'demo' }), 'bind both project and doc')
refuses('gate(save without project)', () => buildGateArgs({ scope: 'pcb', command: 'save', doc: 'PCB1' }), 'bind both project and doc')
refuses('gate(project+window)', () => buildGateArgs({ scope: 'sch', command: 'gate', project: 'a', window: 'b' }), 'not both')
refuses('gate(non-bool strict)', () => buildGateArgs({ scope: 'sch', command: 'gate', strict: 'yes' }), 'must be a boolean')
refuses('gate(non-number minGap)', () => buildGateArgs({ scope: 'sch', command: 'layout-lint', minGap: 'wide' }), 'must be a number')

// save 是写操作：带上 project+doc 时必须正常产出。
argv('gate(pcb save with routing)', buildGateArgs({ scope: 'pcb', command: 'save', project: 'demo', doc: 'PCB1' }), [
  '--project', 'demo', 'pcb', 'save', '--doc', 'PCB1',
])

// -------------------------------------------------------------- catalog ----

{
  const scopes = Object.keys(GATE_COMMANDS)
  if (scopes.join(',') !== 'sch,pcb') bad('gate catalog scopes', `got ${scopes.join(',')}`)
  else ok(`gate catalog scopes → ${scopes.join(',')}`)

  const emptySpec = Object.entries(GATE_SPEC).flatMap(([scope, cmds]) =>
    Object.entries(cmds).filter(([, s]) => !s || !s.flags).map(([cmd]) => `${scope} ${cmd}`))
  if (emptySpec.length) bad('gate catalog shape', `entries missing flags: ${emptySpec.join(', ')}`)
  else ok(`gate catalog shape → ${Object.keys(GATE_SPEC.sch).length} sch + ${Object.keys(GATE_SPEC.pcb).length} pcb commands`)

  // 每条登记的命令都必须能产出至少「scope command」这两个词。
  for (const [scope, cmds] of Object.entries(GATE_COMMANDS)) {
    for (const command of cmds) {
      const produced = buildGateArgs({ scope, command, project: 'p', doc: 'd' })
      if (!produced.includes(scope) || !produced.includes(command)) {
        bad(`gate(${scope} ${command})`, `argv missing scope/command: ${JSON.stringify(produced)}`)
      }
    }
  }
  ok('gate(every registered command builds)')
}

console.log(`\n${failed ? 'FLOW_SELFTEST_FAILED' : 'FLOW_SELFTEST_OK'} passed=${passed} failed=${failed}`)
process.exit(failed ? 1 : 0)
