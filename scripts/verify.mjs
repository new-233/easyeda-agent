import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const dir = process.env.EASYEDA_DIR
const pkg = JSON.parse(readFileSync(dir + '/package.json', 'utf8'))
console.log('package.json OK:', pkg.name, '|', pkg.main, '|', pkg.dsh.bundle.patch)

const patch = readFileSync(dir + '/cordis.patch.yml', 'utf8')
console.log('cordis.patch.yml: has insert =', patch.includes('insert'), '| id =', patch.includes('easyeda-agent'))

const mod = await import(pathToFileURL(dir + '/lib/main.js').href)
console.log('main.js import OK:', mod.name, '| inject =', JSON.stringify(mod.inject), '| apply =', typeof mod.apply, '| Config =', typeof mod.Config)

const cfg = mod.Config({})
console.log('Config coercion:', JSON.stringify({ enabled: cfg.enabled, bin: cfg.easyedaBin, timeoutMs: cfg.timeoutMs }))

// 校验知识层与工具定义可构建
const toolsMod = await import(pathToFileURL(dir + '/lib/tools.js').href)
const knowledgeMod = await import(pathToFileURL(dir + '/lib/knowledge.js').href)
const topics = knowledgeMod.listTopics()
console.log('knowledge topics:', topics.map((t) => t.id + '(' + t.chars + 'ch)').join(', '))
const fakeCtx = { logger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }
const defs = toolsMod.buildToolDefinitions(fakeCtx, cfg)
console.log('tool defs:', defs.map((d) => d.name).join(', '))
console.log('ALL_OK')
