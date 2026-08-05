# Task Plan: 项目升级改进与后续开发规划

## Goal
基于当前代码库、文档、测试、CI 与未提交改动，形成一份可执行、可验收、分阶段的升级改进计划和后续开发路线图。

## Phases
- [x] Phase 1: 建立规划工作区并确认现有改动边界
- [x] Phase 2: 盘点架构、功能、质量、性能、安全与交付现状
- [x] Phase 3: 识别差距、依赖关系、风险与优先级
- [x] Phase 4: 编制近期升级计划和中长期开发路线图
- [x] Phase 5: 交叉核验计划与代码证据并完成交付

## Key Questions
1. 当前产品定位、核心用户流程和已实现能力分别是什么？
2. 哪些问题会阻塞稳定发布，哪些改进能最快提升用户价值？
3. 现有未提交升级工作已覆盖什么，仍缺少什么？
4. 各阶段的依赖、验收标准、风险与工作量如何定义？

## Decisions Made
- 保留现有未提交文件与改动，不覆盖、不回退。
- 由于根目录 `task_plan.md` 和 `notes.md` 属于此前任务，本次采用带项目前缀的独立规划文件。
- 最终交付物使用 `PROJECT_ROADMAP.md`，避免覆盖已有的 `UPGRADE_PLAN.md` 与 `PERFORMANCE_UPGRADE.md`。
- 按 2 名开发者估算，以 local-first 为产品边界；多人协作或云端化另立项目。
- 真实发布副作用安全优先于新增平台和生成式功能。

## Errors Encountered
- 初次检查规划文件时，PowerShell 在 `foreach` 语句后直接接管道触发 `An empty pipe element is not allowed`；改为逐项输出后完成检查，不影响仓库。
- 最终核验时组合 `rg` 正则被 PowerShell 引号截断并报 `unclosed group`；改用多个固定字符串模式核验，不影响项目文件。

## Status
**Completed** - 已完成代码库现状盘点、差距与风险排序、10-12 周路线图、任务依赖、验收门禁和证据核验。
