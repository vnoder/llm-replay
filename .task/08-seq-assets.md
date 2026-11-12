# 08 录制文件按序号命名（assets 目录）

## 目标
- record `-o` 指向目录时自动命名 `NNN.jsonl`（001 起，取目录中最大序号 +1），目录不存在则创建
- replay / inspect `-f` 指向目录时按文件名序加载合并全部 `*.jsonl`（sequence 模式跨文件按序回放）
- `.gitignore` 放行 `assets/` 结构但忽略其内容（*.jsonl 已忽略）
- README 补充"录制多个会话"用法；e2e 补测试

## 状态
done
