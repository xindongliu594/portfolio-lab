# Step Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 让调仓结果可解释，并可回看原始组合及每一步操作。
**Architecture:** 后端一次重放返回每步分析及影响；React 只切换服务端结果，SQLite 保持快照＋操作存储。
**Tech Stack:** 现有 TypeScript、React、Express、SQLite，无新依赖。
**Spec:** docs/superpowers/specs/2026-11-11-step-replay-design.md

## Global Constraints
保留原有业务计算、输入限制和原始数据隔离；纯白蓝色；回看不改变操作；历史视图不继续交易或保存；保存只保存完整有效草稿；重开复算。

## Review Focus
- 前后步骤数据相互独立、旧结果不随新步骤改变。
- 提醒增加/解除要比较对象身份，不能只比较数量。
- 回看时所有数据指向相同步骤，表单状态明确。
- 失败不能增加半个步骤或覆盖原有有效结果。
- 空操作、旧保存方案、刷新与服务重启保持兼容。

### Task 1：后端逐步分析
Files: shared/types.ts、server/domain.ts、tests/domain.test.ts、tests/api.test.ts。
Interfaces: Simulation.steps: SimulationStep[]；每步 analysis、operation、index、impact；impact 包含现金/标的/行业前后值和提醒变化。
- [x] 写测试，断言两步现金20000→30000→25000、标的和行业占比、解除2项后新增科技提醒；空操作steps为空，独立性和失败不变。
- [x] 看红灯后实现，运行完整 npm test。
- [x] 增加 HTTP 保存、重开及重启后 steps 一致的断言。

### Task 2：回看与解释交互
Files: client/StepInsights.tsx、client/format.ts、client/App.tsx、client/styles.css、tests/ui.test.ts、scripts/verify-browser.mjs。
Interfaces: StepTimeline(steps, selectedIndex, onSelect, ...)、TradeImpact(step)、CalculationDetails(analysis)。
- [x] 写 SSR 测试覆盖解释数值、时间线按钮、公式依据；红灯后实现。
- [x] 统一 current 为选中步骤结果，表单基于最新结果；历史视图关闭交易/保存，提供返回最新。
- [x] 浏览器验证原始/第一/第二步切换、公式展开、返回最新继续、失败不加步骤、保存/刷新/重启重开。

### Task 3：交付
- [x] 测试、构建、真实截图及窄屏检查；独立审阅并处理重要发现。
- [x] 更新 DESIGN/README/VERIFY/DEMO/实施日志，重新生成与核对提交包。
