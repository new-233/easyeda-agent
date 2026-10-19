/**
 * selfcheck.mjs — 插件自检总入口（一条命令跑完全部离线+真实 CLI 校验）。
 *
 *   EASYEDA_DIR=<插件目录> [EASYEDA_PLAYBOOK=<任意 playbook.json>] node scripts/selfcheck.mjs
 *
 * 各步分工：
 *   1. verify.mjs             入口/配置/知识层/工具面是否可构建
 *   2. runtime-check.mjs      每个工具在后端缺失时仍返回无损 JSON（DSH 硬要求）
 *   3. flow-selftest.mjs      easyeda_apply / easyeda_gate 的 argv 逐字断言 + 守卫必然报错
 *   4. gate-flag-audit.mjs    白名单里的旗标确实被真实 CLI 支持（防止发明旗标）
 *   5. flow-integration.mjs   构造器产出的 argv 真的交给 easyeda CLI（需 EASYEDA_PLAYBOOK，可选）
 *
 * 退出码非 0 即表示有检查失败。**本脚本不接触 EDA 工程**（不读不写任何设计文档）。
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = process.env.EASYEDA_DIR
if (!dir) {
  console.log('FAIL EASYEDA_DIR is required (path to the plugin dir)')
  process.exit(1)
}
const here = dirname(fileURLToPath(import.meta.url))

const steps = [
  { name: 'verify', script: 'verify.mjs', required: true },
  { name: 'runtime-check', script: 'runtime-check.mjs', required: true },
  { name: 'flow-selftest', script: 'flow-selftest.mjs', required: true },
  { name: 'gate-flag-audit', script: 'gate-flag-audit.mjs', required: true },
  { name: 'flow-integration', script: 'flow-integration.mjs', required: false, needs: 'EASYEDA_PLAYBOOK' },
]

let failed = 0
const summary = []

for (const step of steps) {
  if (step.needs && !process.env[step.needs]) {
    summary.push(`SKIP ${step.name} (set ${step.needs} to enable)`)
    console.log(`\n=== ${step.name} === SKIPPED (set ${step.needs})`)
    continue
  }
  console.log(`\n=== ${step.name} ===`)
  let ok = true
  try {
    const out = execFileSync(process.execPath, [join(here, step.script)], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // 只回显每个脚本的结尾几行，避免刷屏；失败时回显全部。
    const lines = out.trimEnd().split(/\r?\n/)
    console.log(lines.slice(-4).join('\n'))
  } catch (error) {
    ok = false
    const out = String(error.stdout || '') + String(error.stderr || '')
    console.log(out.trimEnd())
    failed += 1
  }
  if (!ok && !step.required) {
    summary.push(`FAIL ${step.name} (optional)`)
  } else {
    summary.push(`${ok ? 'PASS' : 'FAIL'} ${step.name}`)
  }
}

console.log('\n================ SELFCHECK SUMMARY ================')
for (const line of summary) console.log(line)
console.log(failed ? `SELFCHECK_FAILED (${failed} required step(s) failed)` : 'SELFCHECK_OK')
process.exit(failed ? 1 : 0)
