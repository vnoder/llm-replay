# 10 录制文件命名：序号 + 任务含义

## 目标
- assets 下录制文件命名 `NNN-<任务含义>.jsonl`（如 001-note-qa.jsonl、002-fix-calc-tools.jsonl）
- record 新增 `--tag <label>`：目录模式下生成 `NNN-<label>.jsonl`，非法字符替换为 `-`
- 序号识别兼容 `NNN.jsonl` 与 `NNN-含义.jsonl`，续接取两者最大值
- 已有 assets/001.jsonl、002.jsonl 重命名为带含义格式

## 状态
done（10/10 测试通过，assets 实测续接到 003-<tag>.jsonl）
