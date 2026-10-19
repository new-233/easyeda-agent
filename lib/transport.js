/**
 * transport.js — 与 EasyEDA Pro 的传输层。
 *
 * 复用 proven 的 `easyeda` CLI（Go daemon + EDA Agent Connector）作为后端：
 * 所有对原理图/PCB 的读写最终都通过 `easyeda <subcommand>` 完成，
 * CLI 输出为 JSON（动作结果 / 错误 / 审计）。本模块只负责：
 *   1. 解析可执行文件（config.easyedaBin → 环境变量 EASYEDA_BIN → 默认 "easyeda"）；
 *   2. spawn CLI 子进程、设置超时与缓冲区上限；
 *   3. 把 stdout 解析为 JSON（失败时退回原文）。
 *
 * 与参考实现 easyeda-agent/mcp/src/core.mjs 的 runEasyeda 对齐，
 * 保证「换一个后端」只需替换本模块，不影响上层的动作/工具层。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 解析后端二进制路径：配置 > 环境变量 > 默认。 */
export function resolveBinary(config) {
  return (config && config.easyedaBin) || process.env.EASYEDA_BIN || 'easyeda'
}

/** 把 CLI 的 stdout 解析成 JSON；解析失败则返回原文（便于排查）。 */
export function parseOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 执行一次 `easyeda <args>`，返回统一结果对象：
 *   { ok: true,  result,  stderr? }
 *   { ok: false, error: { message, code, stdout, stderr } }
 *
 * @param {string[]} args
 * @param {{ config?: object, timeoutMs?: number }} [options]
 */
export async function runEasyeda(args, options = {}) {
  const config = options.config
  const bin = resolveBinary(config)
  const timeoutMs = options.timeoutMs ?? config?.timeoutMs ?? 300_000
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    })
    const trimmedErr = (stderr || '').trim()
    return {
      ok: true,
      result: parseOutput(stdout),
      // 不写 undefined：DSH 要求工具返回值是无损 JSON，undefined 会被判非法。
      ...(trimmedErr ? { stderr: trimmedErr } : {}),
    }
  } catch (error) {
    const errStderr = String(error.stderr || '').trim()
    return {
      ok: false,
      error: {
        message: error.message,
        code: error.code ?? null,
        stdout: parseOutput(error.stdout || ''),
        ...(errStderr ? { stderr: errStderr } : {}),
      },
    }
  }
}
