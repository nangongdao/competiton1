# Notes: 基于大语言模型的科研写作辅助平台综述

## Sources

### [1] Luo et al., 2025, LLM4SR: A Survey on Large Language Models for Scientific Research
- 文件: `2501.pdf`
- 类型: 总体综述
- 关键信息:
  - 将科研流程划分为假设发现、实验规划与实现、论文写作、同行评审四阶段。
  - 将 automated scientific writing 纳入科研全流程，而非孤立文本生成任务。
- 可支撑论点:
  - 科研写作平台应嵌入完整科研工作流。
  - 平台设计需要兼顾任务划分、评测基准与未来挑战。

### [2] Procko et al., 2024, Leveraging Large Language Models on the Traditional Scientific Writing Workflow
- 文件: `Leveraging_Large_Language_Models_on_the_Traditional_Scientific_Writing_Workflow.pdf`
- 类型: 工作流分析
- 关键信息:
  - 将传统论文拆为标题、摘要、关键词、章节重写等可被 LLM 辅助的子任务。
  - 强调“cautious adaptation”，即受约束的增效而非完全替代。
- 可支撑论点:
  - 平台可采用分阶段、分部件的人机协同架构。

### [3] Mücke et al., 2023/2024, Fine-Tuning Language Models for Scientific Writing Support
- 文件: `2306.pdf`
- 类型: 任务型系统
- 关键信息:
  - 提出 scientificness scoring、section classification、paraphrasing 三类写作支持任务。
  - 上下文信息可提升章节分类表现，最高约 90% F1。
- 可支撑论点:
  - 平台核心能力不应只包含续写，还应包括规范性判断、结构识别与改写建议。

### [4] Gero et al., 2022, Sparks: Inspiration for Science Writing using Language Models
- 文件: `3532106.3533533.pdf`
- 类型: 创意支持系统
- 关键信息:
  - 使用语言模型为科学写作提供启发式表达与灵感支持。
- 可支撑论点:
  - 平台应支持发散式构思，而不只优化已有文字。

### [5] Kim et al., 2023, Metaphorian: Leveraging Large Language Models to Support Extended Metaphor Creation for Science Writing
- 文件: `3563657.3595996.pdf`
- 类型: 修辞支持系统
- 关键信息:
  - 用 LLM 辅助科学写作中的延展隐喻生成。
- 可支撑论点:
  - 平台可扩展到解释性表达、科普转译与跨学科沟通。

### [6] Singh et al., 2024, FigurA11y: AI Assistance for Writing Scientific Alt Text
- 文件: `3640543.3645212.pdf`
- 类型: 多模态写作支持
- 关键信息:
  - 面向科研图像替代文本生成，强调可访问性写作。
- 可支撑论点:
  - 平台应覆盖图表说明、补充材料、无障碍文本等外围写作任务。

### [7] Huespe et al., 2023, Clinical Research With Large Language Models Generated Writing (CRAW)
- 文件: `clinical_research_with_large_language_models.9.pdf`
- 类型: 人机对比实验
- 关键信息:
  - 比较 GPT-3.5 与研究者撰写的临床研究背景部分。
  - 说明 LLM 在初稿生成上具备可用性，但不能替代专家判断。
- 可支撑论点:
  - 平台适合用于背景生成与草稿启动，但必须保留人工把关。

### [8] Meyer et al., 2023, ChatGPT and large language models in academia: opportunities and challenges
- 文件: `s13040-023-00339-9.pdf`
- 类型: 学术场景评论
- 关键信息:
  - 讨论效率提升、偏见、准确性与学术使用边界。
- 可支撑论点:
  - 平台治理需要透明使用声明与事实核验机制。

### [9] Salvagno et al., 2023, Can artificial intelligence help for scientific writing?
- 文件: `s13054-023-04380-2.pdf`
- 类型: 观点文章
- 关键信息:
  - 认为 AI 在组织材料、生成初稿、校对方面有用。
  - 强调幻觉、抄袭、可及性不平等和规范建设问题。
- 可支撑论点:
  - 平台必须内置风险提示、引用校验与伦理约束。

### [10] Ahn, 2024, The transformative impact of large language models on medical writing and publishing
- 文件: `kjpp-28-5-393.pdf`
- 类型: 综述
- 关键信息:
  - 总结 LLM 在文献检索、研究设计、写作辅助、质量评估、引文生成、数据分析、同行评审中的应用。
- 可支撑论点:
  - 平台应从“写句子”升级为“研究传播基础设施”。

### [11] Lazebnik and Rosenfeld, 2024, Detecting LLM-assisted writing in scientific communication: Are we there yet?
- 文件: `jdis-2024-0020.pdf`
- 类型: 检测与治理
- 关键信息:
  - 现有检测器对 LLM 辅助写作识别效果有限。
  - 需要更专门的科学传播检测工具。
- 可支撑论点:
  - 平台不能把合规建立在“事后检测”上，而应依赖全过程留痕和透明披露。

## Synthesized Findings

### 平台能力层
- 写作辅助平台的能力至少包括:
  - 结构化工作流编排。
  - 句级科学性判断与段落/章节分类。
  - 改写、润色、摘要、标题和关键词生成。
  - 图表说明、替代文本等多模态写作支持。

### 交互层
- 交互范式分为:
  - 草稿启动型: 快速生成背景、摘要、段落初稿。
  - 诊断反馈型: 判断文本是否符合学术风格与章节功能。
  - 启发创意型: 提供表达思路、比喻、重组方案。

### 风险层
- 高频风险:
  - 幻觉与虚假引文。
  - 学术署名与透明披露问题。
  - 偏见、领域适配不足、检测失灵。
- 对应设计原则:
  - 人工终审。
  - 证据链与提示链留痕。
  - 检索增强与引用核验。
  - 细粒度权限控制与场景化模板。
