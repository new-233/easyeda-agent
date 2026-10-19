/**
 * gate-flag-audit.mjs — 用真实 CLI 的 `--help` 反查 easyeda_gate 的旗标白名单。
 *
 * 为什么需要它：白名单里的旗标名如果拼错或根本不存在，工具在**现场**会拼出一条
 * CLI 直接报 unknown flag 的命令；离线单测抓不到这一点（单测只验证「我拼出的字符串
 * 和我期望的字符串一致」，不验证这个旗标真的存在）。所以这里把每个登记的命令的
 * `--help` 拉下来，逐个核对白名单里的旗标确实被该命令支持。
 *
 * 只读、离线（除调用 CLI 自身外不接触 EDA）。
 *
 * 用法：EASYEDA_DIR=<插件目录> node scripts/gate-flag-audit.mjs
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const dir = process.env.EASYEDA_DIR
if (!dir) {
  console.log('FAIL EASYEDA_DIR is required (path to the plugin dir)')
  process.exit(1)
}
const { GATE_SPEC } = await import(pathToFileURL(dir + '/lib/actions.js').href)

/** 真实 CLI 全局旗标：不算某条子命令「支持」的旗标。 */
const GLOBAL_FLAGS = new Set([
  '--doc', '--host', '--ports', '--project', '--window',
  '--skip-version-check', '--force-stale-read', '--help', '-h',
])

/** 取 `easyeda <scope> <command> --help` 里声明的旗标名（长旗标）。 */
function declaredFlags(scope, command) {
  let text
  try {
    text = execFileSync('easyeda', [scope, command, '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    return { error: String(error.stderr || error.message || error) }
  }
  const flags = new Set()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s+(--[a-z0-9][a-z0-9-]*)/)
    if (match) flags.add(match[1])
  }
  for (const flag of GLOBAL_FLAGS) flags.delete(flag)
  return { flags, text }
}

const toFlag = (key) => '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

let failed = 0
let checkedFlags = 0

for (const [scope, commands] of Object.entries(GATE_SPEC)) {
  for (const [command, spec] of Object.entries(commands)) {
    const { flags, error } = declaredFlags(scope, command)
    if (error) {
      failed += 1
      console.log(`FAIL ${scope} ${command}: --help failed — ${error.split('\n')[0]}`)
      continue
    }
    const wanted = Object.keys(spec.flags).map(toFlag)
    const missing = wanted.filter((f) => !flags.has(f))
    checkedFlags += wanted.length
    if (missing.length) {
      failed += 1
      console.log(`FAIL ${scope} ${command}: allowlist has flag(s) the CLI does not support: ${missing.join(', ')}`)
      const near = [...flags].filter((f) => missing.some((m) => f.includes(m.slice(2, 6))))
      if (near.length) console.log(`     did you mean: ${near.join(', ')}`)
    } else {
      const extra = [...flags]
      console.log(`OK   ${scope} ${command}: ${wanted.length} allowlisted flag(s) all supported` +
        (extra.length ? ` (command also has: ${extra.join(' ')})` : ' (no other flags)'))
    }
  }
}

console.log(`\nchecked ${checkedFlags} allowlisted flags across ${Object.values(GATE_SPEC).reduce((n, c) => n + Object.keys(c).length, 0)} commands`)
console.log(failed ? `GATE_FLAG_AUDIT_FAILED (${failed} command(s))` : 'GATE_FLAG_AUDIT_OK')
process.exit(failed ? 1 : 0)
