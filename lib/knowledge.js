/**
 * knowledge.js — 知识层：项目规则 + 工艺参数 + 绘制原则 + 官方文档。
 *
 * 这是本框架相对参考实现 easyeda-agent 的增量：把「读取用户规则/官方文档/工艺参数/绘制原则」
 * 做成一等公民的只读知识工具，供 agent 在绘制过程中随时查询，而不是全部塞进提示词。
 *
 * 设计要点：**knowledge/ 目录自动扫描**，不写死清单。
 * 用户往 knowledge/ 里新增任意 .md 即自动成为新主题（id = 文件名小写去扩展名，
 * 标题取正文第一个一级标题），编辑内容也**每次调用实时读取、立即生效**，无需改代码或重启。
 *
 * 提供：
 *   1. loadKnowledge()  —— 扫描 knowledge/*.md 得到主题清单与正文；
 *   2. listTopics()     —— 主题目录（id / title / 字符数）；
 *   3. getTopic(id)     —— 取某个主题全文；
 *   4. fetchDoc(url)    —— 拉取任意 http(s) 官方文档并截断（供 live 查询）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const knowledgeBase = new URL('../knowledge/', import.meta.url)

/** 主题展示顺序（其余主题按 id 字母序排在后面）。 */
const PREFERRED_ORDER = ['rules', 'process', 'drawing', 'docs']

function rank(id) {
  const index = PREFERRED_ORDER.indexOf(id)
  return index < 0 ? PREFERRED_ORDER.length : index
}

/** 取正文第一个一级标题作为主题标题；没有则回落到 id。 */
function titleOf(content, fallback) {
  const match = content.match(/^#\s+(.+?)\s*$/m)
  return match ? match[1] : fallback
}

/** 扫描 knowledge/*.md 读取全部知识主题。返回 [{ id, title, file, content, chars }]。 */
export function loadKnowledge() {
  let files
  try {
    files = readdirSync(fileURLToPath(knowledgeBase))
  } catch {
    return []
  }
  const topics = []
  for (const file of files) {
    if (!/\.md$/i.test(file)) continue
    const id = file.replace(/\.md$/i, '').toLowerCase()
    try {
      const content = readFileSync(new URL(file, knowledgeBase), 'utf8')
      topics.push({ id, title: titleOf(content, id), file, content, chars: content.length })
    } catch (error) {
      topics.push({ id, title: id, file, content: '', chars: 0, error: String(error?.message ?? error) })
    }
  }
  topics.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
  return topics
}

/**
 * 主题目录（不含正文）。注意不可留下 undefined 值——DSH 要求工具返回值是无损 JSON。
 */
export function listTopics() {
  return loadKnowledge().map(({ id, title, file, chars, error }) => (
    error === undefined ? { id, title, file, chars } : { id, title, file, chars, error }
  ))
}

/** 取单个主题全文。 */
export function getTopic(id) {
  const topic = loadKnowledge().find((t) => t.id === id)
  if (!topic) {
    const available = listTopics().map((t) => t.id).join(', ')
    throw new Error(`unknown knowledge topic: ${id}; available: ${available}`)
  }
  return topic
}

/**
 * 拉取官方文档（只读、截断）。用于在绘制过程中实时核对最新工艺参数与规则。
 * @param {string} url
 * @param {{ maxChars?: number, timeoutMs?: number }} [options]
 */
export async function fetchDoc(url, options = {}) {
  const maxChars = options.maxChars ?? 20_000
  const timeoutMs = options.timeoutMs ?? 20_000
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('url must be an absolute http(s) URL')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'dsh-plugin-easyeda-agent/0.3' },
    })
    const text = await response.text()
    const truncated = text.length > maxChars
    return {
      ok: response.ok,
      status: response.status,
      url,
      truncated,
      chars: text.length,
      content: truncated ? text.slice(0, maxChars) : text,
    }
  } catch (error) {
    return { ok: false, url, error: String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}
