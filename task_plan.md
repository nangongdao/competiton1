# Task Plan: 基于大语言模型的科研写作辅助平台综述报告

## Goal
基于 `F:\cankaowenxian` 中可核验的论文，完成一篇约 2000-3000 字的中文综述报告，按数字编号组织参考文献并在正文中交叉引用。

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Extract paper metadata and evidence
- [x] Phase 3: Build ordered references and outline
- [x] Phase 4: Draft the review report
- [x] Phase 5: Verify citations and deliver

## Key Questions
1. 目录中的每篇 PDF 能否可靠提取出题名、作者、年份和摘要？
2. 哪些论文直接支撑“科研写作辅助平台”这一主题，哪些只适合作为应用背景？
3. 哪些条目存在元数据不完整，需要在文稿中显式标注核验不足？

## Decisions Made
- 使用 `ml-paper-writing` 的 `related-work + citation workflow` 路径处理本任务。
- 使用 `planning-with-files` 将计划、笔记和成稿落盘，避免中途引用编号漂移。
- 先按“与主题相关性 + 可核验度”排序参考文献，再撰写正文。

## Errors Encountered
- `pdftotext` / `pdfinfo` 不可用，改用 Python `pypdf` / `fitz` 本地提取 PDF 文本与元数据。

## Status
**Completed** - 已完成综述初稿、参考文献编号和正文交叉引用核对；参考文献 [3] 的正式年份/出处仍建议人工按原始出版信息复核。
