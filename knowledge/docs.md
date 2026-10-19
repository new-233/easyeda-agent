# 官方文档索引与读取指引

> 用途：绘制过程中需要「官方工艺参数 / API 能力 / 设计规则」时，从这里取 URL，
> 用 `easyeda_docs` 拉取正文，或直接访问官网。以下地址以官网当前结构为准。

## 扩展 API（开发插件/自动化读写用）

- 扩展 API 参考（全类/枚举/接口）：`https://prodocs.lceda.cn/cn/api/reference/pro-api.html`
  - 关键类：`SCH_Document` / `SCH_Primitive` / `SCH_Netlist` / `PCB_Document` / `PCB_Primitive` / `PCB_Drc` / `DMT_Project` / `DMT_Schematic` / `DMT_Pcb`
- 扩展开发指南（如何开始/调用 API/配置/CLI）：`https://prodocs.lceda.cn/cn/api/guide/`
- 命令行客户端：`https://prodocs.lceda.cn/cn/api/guide/cli.html`
- easyeda-api-sdk（官方 SDK）：`https://prodocs.lceda.cn/cn/api/guide/ancillary-projects/easyeda-api-sdk.html`

## 设计规则 / 用户指南

- 设计规则（DRC 规则配置）：`https://prodocs.easyeda.com/cn/pcb/design-design-rule/`
- 用户指南首页：`https://prodocs.lceda.cn/cn/`

## 工艺 / 制造能力

- JLCPCB 能力页：`https://jlcpcb.com/capabilities/pcb-capabilities`
- 阻抗计算下单页：`https://cart.jlcpcb.com/client/template/placeOrder/impedance.html`

## 读取指引

1. 需要「能不能这样做 / 某 API 是否存在」→ 先查扩展 API 参考对应类。
2. 需要「线宽线距钻孔等制造限制」→ 拉 JLCPCB 能力页（本插件 `knowledge/process` 有常见基线）。
3. 需要「DRC 规则怎么设」→ 拉设计规则页。
4. 拉取时给 `maxChars` 截断，正文超长就先看目录/摘要再二次拉取。
