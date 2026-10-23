# 灵眼认知哲学：论文与文献附注

这份附注配合 [lingeye-cognition.md](lingeye-cognition.md) 使用。列出的是写作时真正借用或对照过的来源，不是“读完就能造 AGI”的书单。每条都注明它支撑什么、不支撑什么，避免把类比当证明。

## 一、FakeAGI：本项目的思想来源与对照实验

- **FakeAGI 总论文**，guaidao2（个人项目）。  
  https://github.com/guaidao2/FakeAGI/blob/main/PAPER.md  
  相关：自维持假设、预测误差、十一条公理、生长/修剪、概念与符号。本文借的是“智能作为持续预测与修正过程”的视角，不借“自我保存作为 agent 目标”。

- **分论文一：规则变化适应**（PAPER_ADAPTATION.md）。  
  https://github.com/guaidao2/FakeAGI/blob/main/PAPER_ADAPTATION.md  
  相关：多通道误差修正与 active inference 基线的对比；长时窗适应、短时窗失败、代谢与驱动力修复。本文借“环境变化后旧模型会拖后腿”，不把具体倍率当作安全场景结论。

- **分论文二：语言社会性与信任**（PAPER_SOCIAL.md）。  
  https://github.com/guaidao2/FakeAGI/blob/main/PAPER_SOCIAL.md  
  相关：说话者信任、他者意图、通信预算。本文只借“可靠性不是单点分数”，不把多智能体实验数字直接搬到攻防。

- **分论文三：价值锚概念层**（PAPER_CONCEPTS.md）。  
  https://github.com/guaidao2/FakeAGI/blob/main/PAPER_CONCEPTS.md  
  相关：概念 = 观测簇 × 价值绑定 × 可重用；符号接地；零样本迁移。本文借“关系模板优先于表面特征”，不假设食物/危险价值信号能直接映射到安全价值。

- **分论文四：预注册的过程选择**（PAPER_PREREG.md）。  
  https://github.com/guaidao2/FakeAGI/blob/main/PAPER_PREREG.md  
  相关：预注册判据、负对照、叠加态可靠性估计。本文借“先声明判据再跑实验”的纪律，不把 n=30 的网格结果当作外部效度。

## 二、预测误差、主动推理与自由能

- Friston, K. (2010). The free-energy principle: a unified brain theory? *Nature Reviews Neuroscience*, 11, 127–138.  
  https://doi.org/10.1038/nrn2787  
  相关：感知与行动作为预测误差最小化的两条通路。本文只用它作为“预测误差是修正信号”的理论背景，不声称灵眼实现了变分自由能。

- Heins, C., et al. (2022). pymdp: A Python library for active inference in discrete state spaces. *Journal of Open Source Software*.  
  https://doi.org/10.21105/joss.04098  
  相关：离散 POMDP 主动推理基线。FakeAGI 分论文一用它做对照；灵眼没有实现 pymdp，也不把“主动推理”当产品标签。

## 三、归纳、证伪与科学方法

- Hume, D. *An Enquiry Concerning Human Understanding*；关于归纳问题的概述见 Stanford Encyclopedia of Philosophy。  
  https://plato.stanford.edu/entries/induction-problem/  
  相关：过去不能逻辑推出未来；归纳是实用假设。本文借它说明“扫描历史不能证明明天安全”，不把休谟当作“什么都不可知”的结论。

- Popper, K. *The Logic of Scientific Discovery*；概述见 Stanford Encyclopedia of Philosophy。  
  https://plato.stanford.edu/entries/popper/  
  相关：证伪、可检验性、反例。本文借“找到漏洞是存在性证明，没找到只是证伪失败”，不声称灵眼已经按 Popper 方法论完整运行。

- Lake, B. M., et al. (2017). Building machines that learn and think like people. *Behavioral and Brain Sciences*, 40, e253.  
  https://doi.org/10.1017/S0140525X16001837  
  相关：归纳偏置、因果模型、组合泛化。本文借“不是更大模型就自动更懂”，不把该文的具体架构建议当作灵眼路线。

## 四、时间、因果与自洽

- Novikov self-consistency principle（科普性说明，非原始论文）。  
  https://en.wikipedia.org/wiki/Novikov_self-consistency_principle  
  相关：只有自洽的历史才构成解；祖父悖论在单历史解释下被回避。本文只借这个结构做“因果一致性”的类比，不把时间旅行当物理结论，也不把小说设定当科学证明。

- Maturana, H. R., & Varela, F. J. (1980). *Autopoiesis and Cognition*.  
  相关：自创生、系统边界、自我维持。本文只在“系统边界与自维持视角”处引用，不声称灵眼是自创生系统。

## 五、安全工程与不确定性

- Saltzer, J. H., & Schroeder, M. D. (1975). The Protection of Information in Computer Systems. *Proceedings of the IEEE*, 63(9), 1278–1308.  
  https://doi.org/10.1109/PROC.1975.9939  
  相关：最小权限、完全中介、经济机制等经典原则。本文借“授权与边界是不可变约束”，不把经典原则当成覆盖全部攻击面的证明。

- DeepSeek Harness（DSH）仓库与文档。  
  https://github.com/deepseek-ai/deepseek-harness  
  相关：agent 模式、工具、会话、投影与插件机制。灵眼的工程边界以实际安装版本的 API 为准，本文不把 DSH 的内部接口当稳定标准。

## 六、阅读顺序建议

如果只想理解本文的论证链，建议按这个顺序：

1. FakeAGI 总论文 §2（公理）与 §4.4（E12 对照的诚实边界）；
2. 分论文四（预注册与负对照）；
3. 分论文三（概念/关系迁移）；
4. Friston 2010 与 pymdp（预测误差与主动推理背景）；
5. Hume/Popper 的二手概述（归纳与证伪）；
6. Novikov 条目（只作因果闭环类比）。

如果要做工程，不要从“全文实现”开始。先把本文第九节的一条可证伪预测做成小实验，再决定是否值得改灵眼的数据模型。

## 七、没有收进来的东西

- 没有收录版权不明的 PDF。链接指向作者公开仓库、DOI 或稳定的百科条目；版本会变，引用时以原文为准。
- 没有把 FakeAGI 的具体实验数字当作灵眼的安全结论。网格世界与真实攻防的外部效度不同，本文只借机制与边界。
- 没有列“竞品对比”。灵眼的设计选择以自身约束为准，不需要靠贬低别的工具来成立。
