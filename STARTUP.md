# 启动指南

## 项目结构

```
mascompelete/
├── crates/engine-core/     Rust 规则引擎
├── apps/local-match/       本地对战（两个内置 bot 直接跑）
├── apps/http-match/        HTTP bot 对战 runner
├── apps/arena-api/         Go 管控后端（bot注册 + 发起对战 + 排行榜）
├── web/arena-ui/           Next.js 前端（排行榜 + 发起对战 + 回放）
├── maps/                   地图文件（JSON 文本符号格式）
├── artifacts/replays/      比赛回放文件（自动生成）
├── scripts/                启动 / 测试脚本
└── deploy/k8s/             K8s 部署 yaml
```

---

## 页面一览

| 地址 | 说明 |
|------|------|
| `http://localhost:3000` | 回放页，播放比赛录像，比赛结束弹出胜负结果 |
| `http://localhost:3000?seed=99` | 指定 seed 的回放 |
| `http://localhost:3000/arena` | 竞技大厅：排行榜 / 发起对战 / 注册 Bot |
| `http://localhost:9090/bots` | API：查看所有已注册 bot |
| `http://localhost:9090/matches` | API：查看所有比赛记录 |
| `http://localhost:9090/rankings` | API：排行榜数据 |
| `http://localhost:9090/maps` | API：查看所有可用地图 |

---

## 本地启动（开发）

### 方式一：一键启动

```bash
./scripts/start-dev.sh
```

自动编译 Rust、启动 arena-api（9090）、启动前端（3000）。

### 方式二：手动分步启动

**第一步：编译 Rust**
```bash
cargo build --release
cp target/release/http-match apps/arena-api/
```

**第二步：启动 Arena API**
```bash
cd apps/arena-api
go run .
# 监听 :9090，首次自动创建 arena.db
```

**第三步：启动前端**
```bash
cd web/arena-ui
npm install   # 首次需要
npm run dev
# 监听 :3000
```

---

## 局域网对外暴露（让同事测试）

```bash
./scripts/start-public.sh
```

自动检测本机 IP，打印同事访问地址和注册 bot 的 curl 示例。

---

## 日常使用流程

### 1. 注册 bot

打开 `http://localhost:3000/arena` → 点「注册 Bot」，填入 Bot 名称、服务地址、Owner。

或 curl：
```bash
curl -X POST http://localhost:9090/bots \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-bot","url":"http://1.2.3.4:8080","owner":"张三"}'
```

### 2. 发起对战

打开 `/arena` → 点「发起对战」，选 Alpha bot、Beta bot、地图（留空随机），填 seed（留空随机），点开始。

比赛异步执行，状态从 `running` 变为 `done`，前端每 5 秒自动刷新。

或 curl：
```bash
# 随机地图
curl -X POST http://localhost:9090/matches \
  -H 'Content-Type: application/json' \
  -d '{"bot_a_id":1,"bot_b_id":2,"seed":42}'

# 指定地图
curl -X POST http://localhost:9090/matches \
  -H 'Content-Type: application/json' \
  -d '{"bot_a_id":1,"bot_b_id":2,"seed":42,"map_path":"maps/01-hourglass.json"}'
```

### 3. 查看排行榜

`/arena` 首页，按胜率和均分排序，实时更新。

### 4. 查看回放

比赛完成后访问 `http://localhost:3000?seed=<seed>` 查看回放，播放结束自动弹出胜负结果框。

---

## 测试脚本

### 本地快速测试（不需要 HTTP bot）

```bash
./scripts/test-local.sh                                    # seed=42，随机地图
./scripts/test-local.sh 1234                               # 指定 seed
./scripts/test-local.sh 42 --map maps/01-hourglass.json   # 指定地图
./scripts/test-local.sh --list                             # 列出所有可用地图
```

### HTTP bot 对战测试（验证接口联通）

```bash
./scripts/test-http.sh                                    # seed=42，随机地图
./scripts/test-http.sh 999                                # 指定 seed
./scripts/test-http.sh 42 --map maps/02-maze.json         # 指定地图
./scripts/test-http.sh --list                             # 列出所有可用地图
```

demo bot 在 `scripts/demo_bot.py`，随机动作，需要 Python 3。

---

## 可用地图

| 文件 | 名称 | 特点 |
|------|------|------|
| `maps/00-tutorial.json` | 教学图 | 标准走廊，适合新手测试 |
| `maps/01-hourglass.json` | 沙漏（卡口图） | 中央单格通道，极易堵塞 |
| `maps/02-maze.json` | 迷宫（死胡同图） | 密集内墙，路径规划复杂 |
| `maps/03-islands.json` | 传送带孤岛 | 机架在传送带孤岛上，难以到达 |
| `maps/04-desert.json` | 荒漠（极稀缺图） | 能量极少，高价值目标在敌方区域 |

---

## Bot 开发者须知

Bot 需要实现 4 个 HTTP 接口：

| 接口 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `POST /init` | 比赛开始，传入地图和配置 |
| `POST /act` | 每回合调用，**200ms 超时** |
| `POST /finish` | 比赛结束通知 |

详细接口格式见 `GAME_RULES.md`，Python 模板见 `GUIDE.md`。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_ARENA_API` | `http://localhost:9090` | 前端调用的 API 地址 |
| `ARENA_MAPS_DIR` | 自动向上查找 `maps/` | arena-api 读取地图的目录 |

---

## 容器化部署（K8s）

### 为什么需要 PVC

K8s 的 Pod 是无状态的，重启后容器内的文件全部丢失。项目有三类数据需要持久化：

- `arena.db` — SQLite 数据库，存所有 bot 和比赛记录，丢了就要重新注册
- `artifacts/replays/` — 比赛回放 JSON，丢了就看不了历史回放
- `maps/` — 地图文件，丢了比赛就跑不起来

PVC（PersistentVolumeClaim）就是给 Pod 挂一块持久化磁盘，Pod 重启、重建都不影响数据。

### 部署文件

```
deploy/k8s/
├── namespace.yaml     # namespace: arena
├── configmap.yaml     # 环境变量配置
├── pvc.yaml           # 三个 PVC：db / replays / maps
├── arena-api.yaml     # arena-api Deployment + Service
└── arena-ui.yaml      # arena-ui Deployment + Service
```

### 部署步骤

**第一步：构建推送镜像**
```bash
./scripts/build-images.sh <your-registry> <tag>
# 例如: ./scripts/build-images.sh registry.example.com/arena v1.0.0
```

**第二步：改配置**

- `deploy/k8s/arena-api.yaml` 和 `arena-ui.yaml` 里的 `your-registry/...` 改成实际镜像地址
- `deploy/k8s/configmap.yaml` 里的 `NEXT_PUBLIC_ARENA_API` 改成实际对外域名

**第三步：部署**
```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/
```

**第四步：首次上传地图**
```bash
kubectl -n arena cp maps/ <arena-api-pod>:/app/maps/
```

**验证**
```bash
kubectl -n arena get pods
kubectl -n arena logs -f deployment/arena-api
curl http://<arena-api-svc>:9090/maps
```

### 架构说明

- `http-match` 二进制通过 **initContainer** 从独立镜像复制到 emptyDir，arena-api 主容器挂载使用，Rust 和 Go 镜像解耦
- SQLite db 和 replays 各挂独立 PVC，数据持久化
- maps 挂 PVC，支持热更新地图

---

## TODO（后续迭代）

**比赛锁定机制**
- [ ] 参赛者 repo 约定 tag 格式（`arena-submit-v1`），写进 GUIDE.md
- [ ] CI 模板（GitHub Actions）：打 tag → 构建镜像 → 推到 registry
- [ ] `POST /bots` 增加 `image` 字段，存镜像地址

**K8s Bot 调度**
- [ ] arena-api 集成 `client-go`，in-cluster config 获取 k8s 权限
- [ ] 发起对战时动态创建两个 Bot Pod，等 Ready 后拿 Pod IP 传给 http-match
- [ ] 比赛结束后自动删除 Pod
- [ ] 给 arena-api ServiceAccount 配 RBAC（只允许操作指定 namespace 的 Pod）

**体验完善**
- [ ] 回放页面按 match_id 查（现在按 seed，同 seed 多场会冲突）
- [ ] 前端比赛详情点击直跳回放
- [ ] `GET /health` 接口（liveness probe 用）


## 项目结构

```
mascompelete/
├── crates/engine-core/     Rust 规则引擎
├── apps/local-match/       本地对战（两个内置 bot 直接跑）
├── apps/http-match/        HTTP bot 对战 runner
├── apps/arena-api/         Go 管控后端（bot注册 + 发起对战 + 排行榜）
└── web/arena-ui/           Next.js 前端（排行榜 + 发起对战 + 回放）
```

---

## 第一步：编译 Rust

```bash
cargo build --release
```

产物在 `target/release/`，包含 `http-match` 和 `local-match`。

---

## 第二步：把 http-match 放到 arena-api 旁边

arena-api 启动比赛时会调用 `http-match` 二进制，需要放在同目录下：

```bash
cp target/release/http-match apps/arena-api/
```

---

## 第三步：启动 Arena API（Go 后端）

```bash
cd apps/arena-api
go run .
```

监听 `http://localhost:9090`，首次运行自动创建 `arena.db`。

接口列表：
- `GET  /bots`          列出所有 bot
- `POST /bots`          注册 bot
- `GET  /matches`       比赛历史
- `POST /matches`       发起对战
- `GET  /matches/{id}`  单场详情
- `GET  /rankings`      排行榜
- `GET  /maps`          列出所有地图

---

## 第四步：启动前端

```bash
cd web/arena-ui
npm install   # 首次需要
npm run dev
```

访问 `http://localhost:3000/arena`

---

## 日常使用流程

### 1. 注册 bot

打开 `/arena` → 点「注册 Bot」，填入：
- Bot 名称（唯一）
- 服务地址，例如 `http://1.2.3.4:8080`
- Owner 名字

或者直接用 curl：

```bash
curl -X POST http://localhost:9090/bots \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-bot","url":"http://1.2.3.4:8080","owner":"张三"}'
```

### 2. 发起对战

打开 `/arena` → 点「发起对战」，选 Alpha bot、Beta bot、地图（留空随机生成），填 seed（留空随机），点开始。

或者 curl：

```bash
# 随机地图
curl -X POST http://localhost:9090/matches \
  -H 'Content-Type: application/json' \
  -d '{"bot_a_id":1,"bot_b_id":2,"seed":42}'

# 指定地图
curl -X POST http://localhost:9090/matches \
  -H 'Content-Type: application/json' \
  -d '{"bot_a_id":1,"bot_b_id":2,"seed":42,"map_path":"maps/01-hourglass.json"}'
```

比赛异步执行，状态从 `running` 变为 `done`，前端每 5 秒自动刷新。

### 3. 查看排行榜

`/arena` 首页，按胜率和均分排序，实时更新。

### 4. 查看回放

比赛完成后，replay 文件保存在 `artifacts/replays/match-{seed}.json`，访问 `http://localhost:3000` 查看回放（当前加载 `match-42.json`）。

---

## 测试脚本

### 本地快速测试（不需要 HTTP bot）

用内置的两个示例 bot 直接跑一场，验证引擎是否正常：

```bash
./scripts/test-local.sh                                    # seed=42，随机地图
./scripts/test-local.sh 1234                               # 指定 seed
./scripts/test-local.sh 42 --map maps/01-hourglass.json   # 指定地图
./scripts/test-local.sh --list                             # 列出所有可用地图
```

输出示例：
```
==> 编译 Rust...
==> 运行本地对战 seed=42
seed=42 alpha_score=165 beta_score=183 replay=artifacts/replays/match-42.json
==> replay 已生成: artifacts/replays/match-42.json  大小: 16M  帧数: 500
```

### HTTP bot 对战测试（验证接口联通）

自动启动两个 Python demo bot，跑一场完整 HTTP 对战，验证 http-match runner 和接口协议：

```bash
./scripts/test-http.sh                                    # seed=42，随机地图
./scripts/test-http.sh 999                                # 指定 seed
./scripts/test-http.sh 42 --map maps/02-maze.json         # 指定地图
./scripts/test-http.sh --list                             # 列出所有可用地图
```

demo bot 在 `scripts/demo_bot.py`，随机动作，仅用于测试联通性。需要 Python 3。

### 一键启动完整开发环境

自动检查 http-match 二进制、启动 Arena API、启动前端：

```bash
./scripts/start-dev.sh
```

启动后访问：
- 排行榜：`http://localhost:3000/arena`
- 回放：`http://localhost:3000`
- API：`http://localhost:9090`

---

## Bot 开发者须知

Bot 需要实现 4 个 HTTP 接口，监听 8080 端口：

| 接口 | 说明 |
|------|------|
| `GET /health` | 健康检查 |
| `POST /init` | 比赛开始，传入地图和配置 |
| `POST /act` | 每回合调用，**200ms 超时** |
| `POST /finish` | 比赛结束通知 |

详细接口格式见 `GAME_RULES.md`。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_ARENA_API` | `http://localhost:9090` | 前端调用的 API 地址 |
| `ARENA_MAPS_DIR` | 自动向上查找 `maps/` | arena-api 读取地图的目录 |

如果 arena-api 部署在其他机器，启动前端时设置：

```bash
NEXT_PUBLIC_ARENA_API=http://your-server:9090 npm run dev
```

---

## 局域网对外暴露（让同事测试）

```bash
./scripts/start-public.sh
```

自动检测本机 IP，打印同事访问地址和注册 bot 的 curl 示例。

---

## 容器化部署（K8s）

### 目录结构

```
deploy/k8s/
├── namespace.yaml     # namespace: arena
├── configmap.yaml     # 环境变量配置
├── pvc.yaml           # 三个 PVC：db / replays / maps
├── arena-api.yaml     # arena-api Deployment + Service
└── arena-ui.yaml      # arena-ui Deployment + Service
```

### 第一步：构建并推送镜像

```bash
./scripts/build-images.sh <your-registry> <tag>
# 例如:
./scripts/build-images.sh registry.example.com/arena v1.0.0
```

会构建三个镜像：
- `arena-api` — Go 后端
- `http-match` — Rust 对战 runner（通过 initContainer 注入到 arena-api）
- `arena-ui` — Next.js 前端

### 第二步：修改镜像地址

编辑 `deploy/k8s/arena-api.yaml` 和 `deploy/k8s/arena-ui.yaml`，把 `your-registry/...` 替换成实际镜像地址。

同时修改 `deploy/k8s/configmap.yaml` 中的 `NEXT_PUBLIC_ARENA_API` 为实际对外暴露的 API 地址。

### 第三步：初始化 maps PVC

maps PVC 首次需要手动上传地图文件（或通过 initContainer 从镜像复制）：

```bash
# 临时 pod 上传 maps
kubectl -n arena cp maps/ <arena-api-pod>:/app/maps/
```

### 第四步：部署

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/
```

### 验证

```bash
kubectl -n arena get pods
kubectl -n arena logs -f deployment/arena-api
curl http://<arena-api-svc>:9090/maps
```

### 架构说明

- arena-api 通过 **initContainer** 从 `http-match` 镜像复制二进制到 emptyDir，主容器挂载使用
- SQLite db 和 replays 各挂独立 PVC，数据持久化
- maps 挂 PVC，支持赛后热更新地图

---

## TODO（后续迭代）

**比赛锁定机制**
- [ ] 参赛者 repo 约定 tag 格式（`arena-submit-v1`），写进 GUIDE.md
- [ ] CI 模板（GitHub Actions）：打 tag → 构建镜像 → 推到 registry
- [ ] `POST /bots` 增加 `image` 字段，存镜像地址

**K8s Bot 调度**
- [ ] arena-api 集成 `client-go`，in-cluster config 获取 k8s 权限
- [ ] 发起对战时动态创建两个 Bot Pod，等 Ready 后拿 Pod IP 传给 http-match
- [ ] 比赛结束后自动删除 Pod
- [ ] 给 arena-api ServiceAccount 配 RBAC（只允许操作指定 namespace 的 Pod）

**体验完善**
- [ ] 回放页面按 match_id 查（现在按 seed，同 seed 多场会冲突）
- [ ] 前端比赛详情点击直跳回放
- [ ] `GET /health` 接口（liveness probe 用）
