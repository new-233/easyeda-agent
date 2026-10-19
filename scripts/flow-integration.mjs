/**
 * flow-integration.mjs — 全流程通道的**真实 CLI 集成自检**。
 *
 * 与 flow-selftest.mjs 的分工：
 *   flow-selftest.mjs     断言 argv 逐字正确 + 守卫必然报错（纯离线，无 CLI）
 *   flow-integration.mjs  把**被测构造函数产出的 argv 真的交给 easyeda CLI**，
 *                         证明「构造器 → 真实进程」这一段没有拼错。
 *
 * 选用的命令都**不需要 EasyEDA 窗口**：
 *   - `apply --dry-run`：只校验 playbook 并打印计划，不执行任何写入。
 *   - `sch gate`：用一个必然失败的工程名触发路由失败；只要 CLI 报的不是
 *     unknown flag / unknown command / invalid argument，就说明 argv 形态被接受。
 *     这是「静默拼错」唯一能在无窗口环境下被抓出来的方式。
 *
 * 用法：EASYEDA_DIR=<插件目录> node scripts/flow-integration.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const dir = process.env.EASYEDA_DIR
if (!dir) {
  console.log('FAIL EASYEDA_DIR is required (path to the plugin dir)')
  process.exit(1)
}
const { buildApplyArgs, buildGateArgs } = await import(pathToFileURL(dir + '/lib/actions.js').href)

let failed = 0
const ok = (m) => console.log(`OK   ${m}`)
const bad = (m) => { failed += 1; console.log(`FAIL ${m}`) }

/** 运行 argv；返回 { code, text }，不因非零退出而抛。 */
function run(args) {
  try {
    return { code: 0, text: execFileSync('easyeda', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (error) {
    return { code: error.status ?? 1, text: String(error.stdout || '') + String(error.stderr || '') }
  }
}

const ARGV_PARSE_ERROR = /unknown flag|unknown command|invalid argument|unknown shorthand/i

// --- 1) playbook 回放：构造器产出的 argv 必须被真实 CLI 接受并给出计划 -------------
const playbook = process.env.EASYEDA_PLAYBOOK
if (!playbook || !existsSync(playbook)) {
  console.log(`SKIP apply integration: set EASYEDA_PLAYBOOK to an existing playbook .json`)
} else {
  const args = buildApplyArgs({ playbook, project: 'dsh_integration_probe', dryRun: true })
  console.log(`BUILT apply argv = ${JSON.stringify(args)}`)
  const { code, text } = run(args)
  if (code !== 0) bad(`apply --dry-run exited ${code}: ${text.split('\n').filter(Boolean).slice(0, 3).join(' | ')}`)
  else if (!/step\(s\)/.test(text)) bad(`apply --dry-run printed no plan: ${text.slice(0, 200)}`)
  else {
    const steps = (text.match(/^playbook .*— (\d+) step\(s\)/m) || [])[1]
    ok(`apply --dry-run accepted the built argv and planned ${steps} step(s)`)
    // 确认门必须仍然可见：构造器没替调用方打开 --yes。
    if (args.includes('--yes')) bad('builder injected --yes without being asked')
    else ok('builder did not inject --yes; confirmation-gated steps stay gated')
  }
}

// --- 2) 门命令：argv 形态必须被 CLI 的参数解析器接受 -------------------------------
const probes = [
  { label: 'sch gate (strict, json)', input: { scope: 'sch', command: 'gate', project: 'dsh_integration_probe', doc: 'P1', strict: true, json: true } },
  { label: 'sch status (json)', input: { scope: 'sch', command: 'status', project: 'dsh_integration_probe', json: true } },
  { label: 'pcb drc (json, timeout)', input: { scope: 'pcb', command: 'drc', project: 'dsh_integration_probe', doc: 'PCB1', json: true, timeout: 5 } },
  { label: 'pcb list', input: { scope: 'pcb', command: 'list', project: 'dsh_integration_probe' } },
  { label: 'sch layout-lint (min-bool+eps)', input: { scope: 'sch', command: 'layout-lint', project: 'dsh_integration_probe', minGap: 2.54, pinEps: 0 } },
]
for (const { label, input } of probes) {
  const args = buildGateArgs(input)
  const { text } = run(args)
  if (ARGV_PARSE_ERROR.test(text)) bad(`${label}: CLI rejected the built argv ${JSON.stringify(args)} — ${text.split('\n').filter(Boolean)[0]}`)
  else ok(`${label}: argv accepted by the CLI (${JSON.stringify(args)})`)
}

console.log(`\n${failed ? 'FLOW_INTEGRATION_FAILED' : 'FLOW_INTEGRATION_OK'} failed=${failed}`)
process.exit(failed ? 1 : 0)
