/**
 * easyeda-agent — 嘉立创 EDA 专业版自动化插件（DSH host 插件）。
 *
 * 目标：驱动原理图 + PCB 绘制的全流程自动化。本文件是插件入口：
 *   - 注册一组类型化工具（lib/tools.js）——给 agent 装上的「手」；
 *   - 注册一个 agent skill（skill/SKILL.md）——教 agent 全流程怎么走；
 *   - 知识层（lib/knowledge.js + knowledge/*.md）——工艺参数与绘制原则随查随用。
 *
 * 分层（自下而上）：
 *   transport.js  → 复用 `easyeda` CLI（Go daemon + EDA Agent Connector）
 *   actions.js    → 类型化动作目录 + 路由守卫 + 参数组装
 *   knowledge.js  → 工艺参数 / 绘制原则 / 官方文档
 *   tools.js      → 把上面三层暴露成 DSH 工具
 *   main.js       → 本文件：装配与注册
 *
 * 可移植性：schemastery 是可选依赖——vendored 副本在就用它做 Config 校验与默认值，
 * 缺失时降级为「无 schema + 本地合并默认值」，保证仓库被裁剪（例如某些安装器丢弃
 * node_modules）后插件依然能加载运行。
 */
import { readFileSync } from 'node:fs'
import { buildToolDefinitions } from './tools.js'

export const name = 'easyeda-agent'

export const inject = ['tools', 'skills']

/** 插件版本，随 /health 类自省一起便于确认运行版本。 */
const VERSION = '0.4.0'

/** 默认配置：无论有没有 Config schema，都以此为准。 */
const DEFAULTS = { enabled: true, easyedaBin: '', timeoutMs: 300000 }

/**
 * 可选 Config：vendored schemastery 存在时提供完整 schema（校验 + 默认值 + 可配置）；
 * 缺失时保持 undefined（cordis 的 Config 导出是可选的），apply 里再合并 DEFAULTS。
 */
export let Config
try {
  const z = (await import('../node_modules/@deepseek-ai/schemastery/lib/index.mjs')).default
  Config = z.object({
    /** 插件总开关。 */
    enabled: z.boolean().default(true),
    /** `easyeda` CLI 二进制路径；留空则取环境变量 EASYEDA_BIN，再取 PATH 上的 easyeda。 */
    easyedaBin: z.string().default(''),
    /** CLI 单次调用超时（毫秒）。 */
    timeoutMs: z.number().default(300000),
  })
} catch {
  Config = undefined
}

/** 读取 skill 正文（best-effort：skill 注册失败不影响工具注册）。 */
function loadSkillText() {
  try {
    return readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8')
  } catch {
    return ''
  }
}

export function apply(ctx, rawConfig) {
  const logger = ctx.logger(name)
  const config = { ...DEFAULTS, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) }
  if (!config.enabled) {
    logger.info('已禁用（config.enabled = false），不注册工具与技能')
    return
  }

  // ---- 工具注册 ----
  const toolDefs = buildToolDefinitions(ctx, config)
  for (const def of toolDefs) {
    ctx.effect(() => ctx.tools.register(def))
  }

  // ---- 技能注册（教 agent 全流程） ----
  const skillText = loadSkillText()
  if (skillText) {
    ctx.effect(() => ctx.skills.register({
      name: 'easyeda-agent',
      description: '嘉立创 EDA 专业版自动化：读数据手册、画原理图、布局布线 PCB、铺铜、丝印与检查。用于「画板/改板/建库/整理原理图/检查工程」等任何需要驱动 EasyEDA Pro 的任务。',
      whenToUse: '当需要操作嘉立创 EDA 专业版（EasyEDA Pro）完成原理图或 PCB 的绘制、修改、检查、建库或导出时使用；先 easyeda_health 确认连接，再 easyeda_actions 查动作，用 easyeda_call 执行。',
      source: 'runtime',
      content: skillText,
      invocation: { modelInvocable: true, userInvocable: true },
    }))
  }

  logger.info(
    'easyeda-agent v%s 已启动：注册 %d 个工具 + 1 个技能（easyeda 后端=%s，超时=%sms）',
    VERSION, toolDefs.length, config.easyedaBin || process.env.EASYEDA_BIN || 'easyeda', config.timeoutMs,
  )
}
