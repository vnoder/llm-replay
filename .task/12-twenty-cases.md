# 12 构建总量 20 个测试用例

## 目标
- 现有 001/002，新增 003-020 共 18 个用例，覆盖：
  - API 级（脚本直录 DeepSeek，003-015）：中/英闲聊、多轮对话、reasoner 思维链、
    长代码生成分流式、JSON mode、角色扮演、摘要、翻译、低温度事实、models 列表、
    无效模型 400 错误、few-shot 分类
  - Agent 级（pi 多工具，016-020）：grep/find 代码库问答、write+bash 创建文件、
    bash 文本管道、读改跑 JSON 修复、两阶段 planner→executor 编排（subagent 模式）
- 工程化：scripts/record-api-cases.mjs、scripts/record-agent-cases.mjs（程序化管理
  录制服务器，杜绝 Windows 僵尸进程）、scripts/verify-cases.mjs（逐用例逐轮哈希回放比对）
- 验收：verify-cases 全绿（每用例每轮响应与录制逐字节一致）
- git 提交并 push

## 状态
done

## 结果（2026-11-13）
- 20 用例 / 42 轮全部录制完成（DeepSeek 真实上游），verify-cases 逐轮哈希回放比对 0 失败
- scripts/record-api-cases.mjs（13 个 API 级）、record-agent-cases.mjs（5 个 agent 级）、verify-cases.mjs 入库
- 调试记录：spawnSync 阻塞事件循环导致同进程录制服务器无法响应（pi 挂死）；异步 spawn + stdin ignore + await 修复
