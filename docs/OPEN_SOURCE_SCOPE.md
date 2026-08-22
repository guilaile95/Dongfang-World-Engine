# Open Source Scope

本仓库开源的是 **Persistent AI World Simulator / 持久化 AI 世界模拟器的引擎、数据模型、验证机制与通用工具链**。

## 包含

- World Engine 核心代码；
- Candidate Event / Validator / Commit / Projector；
- Event Log 与 Materialized State；
- Character Knowledge 与权限边界；
- 通用 Lore / Memory / Provider 接口；
- 原创测试世界与最小 Demo；
- 测试、文档与开发工具。

## 不包含

本仓库不会内置或分发未经授权的第三方作品完整世界包、原著文本或大量受版权保护的设定内容。

例如基于现有小说、影视、游戏 IP 的个人世界文件，应保留在用户本地，并通过后续 World Pack 导入机制使用，而不是作为本仓库默认内容发布。

推荐本地目录：

```text
local-content/
world-packs/local/
worlds/local/
```

这些目录已加入 `.gitignore`。

## 设计目标

引擎应与具体世界内容解耦：同一套 World Engine 可以加载原创世界、用户自建世界或用户自行准备的本地 World Pack，而不把任何特定 IP 写死进核心代码。
