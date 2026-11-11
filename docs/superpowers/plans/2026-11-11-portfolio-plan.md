# Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付符合 VC-FIN-001 / V3.0 的投资组合全栈原型、设计材料及真实验收证据。

**Architecture:** React 工作台调用 Express API。后端集中执行整数分估值、顺序重放及校验；SQLite 保存不可变原始快照和操作，重开时重新计算。

**Tech Stack:** Node.js 24、TypeScript、Express、React、Vite、node:sqlite、node:test。

**Spec:** docs/superpowers/specs/2026-11-11-portfolio-design.md（用户已于 2026-11-11 同意按要求实施）。

## Global Constraints
- 固定数据、单用户、CNY；前端不作为计算和验证的权威。
- 单标的 >30%、行业 >50% 才提醒；金额/比例显示两位小数。
- 初始数据不可修改；失败不改变有效模拟；保存后刷新及服务重启均可恢复。
- 原始 PLAN.md 保留首次提交版本；测试与截图结果据实记录。

## Review Focus
- 数量类型与溢出：拒绝非正整数、不安全整数、未知标的。
- 未舍入比例边界：展示为 30.00% 的实际超限仍应提醒。
- 批次后半段失败：不产生部分有效操作或保存。
- 存储或网络失败：保留当前页面结果并给出明确错误。
- 快照隔离：重开旧方案不受初始化数据变更影响。

### Task 1: 规则与类型
**Files:** shared/types.ts、server/domain.ts、tests/domain.test.ts、data/portfolio.json、package.json、tsconfig.json。
**Interfaces:** `simulate(snapshot: Snapshot, input: unknown): Simulation`；`analyze(snapshot: Snapshot): Analysis`。金额十进制字符串，比例字符串，超限以后端布尔值为准。
- [x] 配置依赖/锁文件，复制原始附件数据，编写 AC-01～AC-04、输入类型、溢出、批次原子性及未舍入阈值测试。
- [x] 运行 `npm test` 确认尚无实现导致失败；实现领域计算，再运行至全绿。

### Task 2: API 与持久化
**Files:** server/store.ts、server/app.ts、server/index.ts、tests/api.test.ts。
**Interfaces:** `createApp({snapshot, store, staticDir?})`；`PlanStore(path)` 保存快照及操作；五个 API 按 spec，统一错误结构。
- [x] 写实际 HTTP/SQLite 测试：AC-05、404、非法 JSON、命名、空操作、超限数量、错误不保存、关闭重开数据库、快照隔离及存储失败。
- [x] 红灯后实现 API/SQLite；运行 `npm test`。

### Task 3: 中文工作台
**Files:** client/App.tsx、client/main.tsx、client/styles.css、index.html、vite.config.ts、tests/ui.test.tsx。
**Interfaces:** 使用共享响应类型；有效操作仅在模拟成功后更新；保存方案为只读。
- [x] 写 SSR 页面断言覆盖组合和操作表单、空状态；红灯后实现界面。
- [x] 提供加载/错误/空方案状态、未保存提醒、金额格式、桌面与窄屏排布。
- [x] `npm test`、`npm run build` 通过；浏览器按 AC-01～AC-05 操作并截取四类证据。

### Task 4: 验收及交付
**Files:** README.md、DESIGN.md、VERIFY.md、docs/DEMO.md、docs/screenshots/*、scripts/package.mjs。
- [x] 真实启动构建产物，保存后刷新和重启后重开；检查窄屏无横向溢出。
- [x] 完成设计、运行、复盘及 AI 协作记录；据实写投入时间。
- [x] 请求独立代码审阅，修复重要问题并验证。
- [x] 运行 `npm test`、`npm run build`，生成不含依赖/本地数据库/密钥的提交 ZIP，并检查清单。
