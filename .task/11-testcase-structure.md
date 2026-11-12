# 11 assets 进化为测试用例库

## 目标
- 用例结构：`assets/NNN-用途/` 目录，内含：
  - `README.md`：用途说明、测试步骤、回放命令、预期结果
  - `session.jsonl`：回放数据
  - 夹具文件（如被测工作区初始状态）
- record `--tag` 升级：自动创建用例目录 + 生成 README.md 骨架（含录制日期、上游 host、回放命令）
- readJsonl 支持用例目录递归（一级），条目 id 前缀用用例名；兼容旧的扁平 NNN.jsonl / NNN-x.jsonl
- 序号续接同时扫描扁平文件与用例目录
- 迁移现有：001-note-qa、002-fix-calc-tools（补 README 与夹具）
- README 文档更新；e2e 测试覆盖用例目录

## 用例类型规划
- 001-note-qa：简单文件问答（单工具冒烟，hash 回放）
- 002-fix-calc-tools：代码修复多工具（read/edit/bash，sequence 回放 + 副作用断言）
- 后续可加：代码库问答、闲聊、subagent 等

## 状态
done（11/11 测试通过；001/002 已迁移并按 README 步骤实测复现：001 冒烟、002 原路径 4 HIT + PASS）

## 实测补充发现
- sequence 回放的副作用依赖录制时绝对路径（edit 参数烧入路径），换目录运行时文件编辑仍落原路径——已写入用例 README 与主 README 注意事项
