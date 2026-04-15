# Agent Arena MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建 Agent Arena MVP 的第一版可运行系统，先打通本地引擎、示例 bot 对抗、replay 产出，再逐步扩展到 repo 提交、容器运行和 Web 回放。

**Architecture:** 采用单仓多模块方式推进。第一阶段优先实现 Rust `game-engine` 与本地 CLI 对战器，确保规则、地图生成、回放格式先稳定；第二阶段补 Go `arena-api` 与 `match-runner`；第三阶段补 Next.js 单页面回放 UI，并将 replay 作为前后端的统一契约。

**Tech Stack:** Rust, Go, Next.js, React, Canvas, Postgres, Docker

---

## Current Focus

当前优先实现以下增量需求：

- 地图从基础对称图升级为更强结构化的机房走廊型布局
- 能量改为在路径点随机掉落
- 能量值为 `1-100`
- 采用区域偏置分布，深区更容易刷高值
- 单机器人背包上限改为按总能量值累计，容量 `150`
- 机架改为总容量限制，默认上限 `1000`
- Web 页面切换为中文文案

以上变更需要同步更新：

- 地图生成逻辑
- 回合结算逻辑
- replay 数据结构
- sample bots 策略
- 单页面回放 UI

### Task 1: 初始化仓库结构与根文档

**Files:**
- Create: `README.md`
- Create: `Cargo.toml`
- Create: `rust-toolchain.toml`
- Create: `apps/`
- Create: `crates/`
- Create: `services/`
- Create: `web/`

**Step 1: 写根 README 初稿**

补充项目定位、模块结构和第一阶段目标。

**Step 2: 初始化 Cargo workspace**

创建 `Cargo.toml`，先只纳入 `crates/engine-core` 和 `apps/local-match`。

**Step 3: 固定 Rust 工具链**

创建 `rust-toolchain.toml`，降低环境漂移。

**Step 4: 验证 workspace 能被 cargo 识别**

Run: `cargo metadata --no-deps`

Expected: 成功输出 workspace 元数据。

**Step 5: Commit**

```bash
git add README.md Cargo.toml rust-toolchain.toml
git commit -m "chore: initialize workspace skeleton"
```

### Task 2: 实现最小地图与状态模型

**Files:**
- Create: `crates/engine-core/Cargo.toml`
- Create: `crates/engine-core/src/lib.rs`
- Create: `crates/engine-core/src/types.rs`
- Create: `crates/engine-core/src/map.rs`
- Create: `crates/engine-core/tests/map_generation.rs`

**Step 1: 写失败测试，验证同一 seed 生成同一张图**

覆盖：
- 相同 seed 地图一致
- 地图尺寸为 36x36
- 双方出生点对称

**Step 2: 运行测试确认失败**

Run: `cargo test -p engine-core map_generation -- --nocapture`

Expected: 因缺少实现而失败。

**Step 3: 写最小实现**

实现基础类型：
- `Position`
- `Tile`
- `Map`
- `MapConfig`
- `generate_map(seed, config)`

**Step 4: 运行测试确认通过**

Run: `cargo test -p engine-core map_generation -- --nocapture`

Expected: 通过。

**Step 5: Commit**

```bash
git add crates/engine-core
git commit -m "feat: add deterministic map generation"
```

### Task 3: 实现机器人、动作与回合推进

**Files:**
- Modify: `crates/engine-core/src/lib.rs`
- Create: `crates/engine-core/src/state.rs`
- Create: `crates/engine-core/src/rules.rs`
- Create: `crates/engine-core/tests/turn_resolution.rs`

**Step 1: 写失败测试，覆盖一轮回合结算**

覆盖：
- 单机器人移动
- 同格碰撞失败
- 传送带推动
- `PICK` 成功增加载荷
- `DROP` 成功增加分数

**Step 2: 运行测试确认失败**

Run: `cargo test -p engine-core turn_resolution -- --nocapture`

Expected: 因状态机未实现而失败。

**Step 3: 写最小实现**

实现：
- `RobotState`
- `RobotAction`
- `GameState`
- `apply_turn()`

**Step 4: 运行测试确认通过**

Run: `cargo test -p engine-core turn_resolution -- --nocapture`

Expected: 通过。

**Step 5: Commit**

```bash
git add crates/engine-core
git commit -m "feat: add turn resolution engine"
```

### Task 4: 实现 replay 结构与事件流

**Files:**
- Create: `crates/engine-core/src/replay.rs`
- Modify: `crates/engine-core/src/lib.rs`
- Create: `crates/engine-core/tests/replay.rs`

**Step 1: 写失败测试，验证 replay 帧按回合累计**

覆盖：
- 初始状态存在
- 每回合生成 frame
- frame 中带 scores 和 events

**Step 2: 运行测试确认失败**

Run: `cargo test -p engine-core replay -- --nocapture`

Expected: 因 replay 未实现而失败。

**Step 3: 写最小实现**

实现：
- `Replay`
- `ReplayFrame`
- `Event`
- `summary`

**Step 4: 运行测试确认通过**

Run: `cargo test -p engine-core replay -- --nocapture`

Expected: 通过。

**Step 5: Commit**

```bash
git add crates/engine-core
git commit -m "feat: add replay model"
```

### Task 5: 实现本地对战 CLI

**Files:**
- Create: `apps/local-match/Cargo.toml`
- Create: `apps/local-match/src/main.rs`
- Create: `apps/local-match/tests/cli.rs`

**Step 1: 写失败测试，验证 CLI 能输出 replay 文件**

覆盖：
- 指定 seed 可运行比赛
- 输出 replay.json
- 输出最终比分摘要

**Step 2: 运行测试确认失败**

Run: `cargo test -p local-match cli -- --nocapture`

Expected: 因 CLI 未实现而失败。

**Step 3: 写最小实现**

实现：
- 读 seed
- 调用引擎跑 500 回合
- 把 replay 输出到 `artifacts/replays/`

**Step 4: 运行测试确认通过**

Run: `cargo test -p local-match cli -- --nocapture`

Expected: 通过。

**Step 5: Commit**

```bash
git add apps/local-match
git commit -m "feat: add local match runner"
```

### Task 6: 添加两个示例 bot 策略

**Files:**
- Create: `crates/engine-core/src/bots.rs`
- Create: `crates/engine-core/tests/sample_bots.rs`

**Step 1: 写失败测试，验证两个示例 bot 能完整对战**

覆盖：
- `GreedyCollectorBot`
- `CabinetRushBot`
- 500 回合内无 panic

**Step 2: 运行测试确认失败**

Run: `cargo test -p engine-core sample_bots -- --nocapture`

Expected: 因 bot 策略未实现而失败。

**Step 3: 写最小实现**

实现两个简单 bot：
- 最近资源优先
- 高倍率机柜优先

**Step 4: 运行测试确认通过**

Run: `cargo test -p engine-core sample_bots -- --nocapture`

Expected: 通过。

**Step 5: Commit**

```bash
git add crates/engine-core
git commit -m "feat: add sample bot strategies"
```

### Task 7: 定义 bot HTTP 契约草案与 Docker 规范

**Files:**
- Create: `docs/api/bot-openapi.yaml`
- Create: `docs/contracts/bot-runtime.md`
- Create: `examples/python-bot/`
- Create: `examples/js-bot/`

**Step 1: 写契约文档**

明确：
- `/health`
- `/init`
- `/act`
- `/finish`

**Step 2: 写最小示例 bot 骨架**

给团队一个最小接入模板。

**Step 3: 验证示例目录结构完整**

Run: `rg --files docs/api docs/contracts examples`

Expected: 输出协议文件和两个示例目录。

**Step 4: Commit**

```bash
git add docs/api docs/contracts examples
git commit -m "docs: define bot http contract and examples"
```

### Task 8: 实现 GitHub repo 提交与构建流水线

**Files:**
- Create: `services/arena-api/`
- Create: `services/match-runner/`
- Create: `services/arena-api/tests/`
- Create: `services/match-runner/tests/`

**Step 1: 先写接口层测试**

覆盖：
- 提交 repo URL
- 解析 commit SHA
- 记录 build job

**Step 2: 实现最小 API**

最小能力：
- `POST /bots/submissions`
- `POST /matches`
- `GET /matches/:id`

**Step 3: 实现最小构建器**

支持：
- clone repo
- checkout SHA
- docker build

**Step 4: 跑 API 与 runner 测试**

Run: `go test ./...`

Expected: 通过。

**Step 5: Commit**

```bash
git add services
git commit -m "feat: add repo submission and build pipeline"
```

### Task 9: 实现回放单页面

**Files:**
- Create: `web/arena-ui/`
- Create: `web/arena-ui/app/`
- Create: `web/arena-ui/components/`
- Create: `web/arena-ui/tests/`

**Step 1: 写组件测试**

覆盖：
- 加载 replay.json
- 播放暂停
- 时间轴跳转
- 分数和事件展示

**Step 2: 实现最小页面**

只做：
- 顶部比分条
- 地图 Canvas
- 右侧事件流
- 底部时间轴

**Step 3: 跑前端测试和构建**

Run: `npm test && npm run build`

Expected: 通过。

**Step 4: Commit**

```bash
git add web/arena-ui
git commit -m "feat: add replay web ui"
```

### Task 10: 整体联调与文档收尾

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-04-14-agent-arena-mvp-design.md`
- Create: `docs/runbooks/local-dev.md`

**Step 1: 编写本地开发说明**

覆盖：
- 如何跑本地对战
- 如何生成 replay
- 如何启动示例 bot
- 如何查看页面

**Step 2: 执行全量验证**

Run:
- `cargo test`
- `go test ./...`
- `npm test`
- `npm run build`

Expected: 全部通过。

**Step 3: Commit**

```bash
git add README.md docs
git commit -m "docs: add local development runbook"
```
