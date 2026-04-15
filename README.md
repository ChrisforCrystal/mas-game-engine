# Agent Arena

内部 Agent 对抗评测场。你写 bot，我来跑比赛。

---

## 怎么参赛

你只需要做两件事：

1. 写一个 HTTP 服务，实现下面的 4 个接口
2. 把代码发给我，我在服务端启动你的服务，用引擎跑对战

语言不限，Go / Python / Java / Rust / Node 都行，只要能起一个 HTTP 服务就行。

---

## 游戏规则

### 基本设定

- 地图：36×36，机房走廊型，内墙多，有主通道、侧通道、深区
- 对局：1v1，你方 5 个机器人 vs 对手 5 个机器人
- 回合数：500 回合，得分高者胜
- 可见性：全图可见，每回合你能看到完整地图状态

### 坐标系

原点 `(0,0)` 在左上角，`x` 向右，`y` 向下。

### 你的机器人

- Alpha 队出生在地图左侧：`x=2, y=16~20`，机器人 id 为 `0~4`
- Beta 队出生在地图右侧：`x=33, y=16~20`，机器人 id 为 `5~9`
- 每个机器人背包上限 **150**

### 地图元素

| 元素 | 说明 |
|------|------|
| `Empty` | 可通行空地 |
| `Wall` | 墙，不可进入 |
| `Conveyor(方向)` | 传送带，进入后本回合结算时自动推送 1 格 |
| `Energy { value, ttl }` | 能量点，站上去执行 `Pick` 拾取 |
| `Cabinet { id, capacity, occupied_capacity }` | 机架，站上去执行 `Drop` 投递得分 |

### 机架分布（共 11 个）

| id | 位置 (x,y) | 容量 |
|----|-----------|------|
| 0 | (18, 18) 中央 | 1600 |
| 1 | (15, 16) | 1180 |
| 2 | (21, 20) | 920 |
| 3 | (6, 6) 左上 | 760 |
| 4 | (29, 6) 右上 | 700 |
| 5 | (6, 29) 左下 | 640 |
| 6 | (29, 29) 右下 | 600 |
| 7 | (5, 12) 左侧 | 540 |
| 8 | (30, 12) 右侧 | 500 |
| 9 | (5, 24) 左侧 | 440 |
| 10 | (30, 24) 右侧 | 380 |

机架有总容量上限，满了就不再接受投递。

### 能量机制

- 能量按区域分布，数值 1~88
  - **主通道**（靠近地图中心）：偏低值 4~48
  - **侧区**：中等 8~62
  - **深区/角落**（x≤8 或 x≥27 或 y≤8 或 y≥27）：偏高值 12~88
- 高价值能量（value ≥ 70）有 TTL，10~18 回合后消失
- 初始刷新 8 个能量点，之后每 10 回合刷新 3 个
- 全局能量总预算 = 所有机架总容量 × 80%，耗尽后不再刷新

### 动作集合

每个机器人每回合提交 1 个动作：

| 动作 | 说明 |
|------|------|
| `Move(Up)` | 向上移动（y-1） |
| `Move(Down)` | 向下移动（y+1） |
| `Move(Left)` | 向左移动（x-1） |
| `Move(Right)` | 向右移动（x+1） |
| `Pick` | 拾取当前格能量 |
| `Drop` | 向当前格机架投递能量得分 |
| `Jam` | 干扰相邻敌方机器人 |
| `Wait` | 不动 |

非法动作自动降级为 `Wait`。

### 碰撞规则

- 两个机器人同时移动到同一格 → 双方失败，原地停留
- 两个机器人互换位置 → 双方失败
- 目标格有静止机器人 → 移动失败
- 目标格是墙 → 移动失败

### 传送带

进入传送带格后，回合结算时自动被推送 1 格。推送目标被占据或是墙时推送失败。

### JAM（干扰）

- 只对曼哈顿距离 = 1 的相邻敌方机器人生效
- 被干扰的机器人下一回合不能执行 `Pick` 和 `Drop`（可以移动）
- JAM 冷却 5 回合
- 满载（cargo = 150）时不能使用 JAM

### 回合结算顺序

1. 处理移动（含碰撞检测）
2. 更新冷却计时
3. 处理 Pick
4. 处理 Drop
5. 处理 Jam
6. 处理传送带推送
7. 更新能量 TTL
8. 每 10 回合刷新新能量

---

## Bot HTTP 接口规范

你的服务需要实现以下 4 个接口，默认监听 **8080 端口**。

### `GET /health`

健康检查，服务就绪后返回 `200 OK`。

---

### `POST /init`

比赛开始时调用一次，传入地图和初始状态。

```json
{
  "match_id": "abc123",
  "seed": 42,
  "team": "Alpha",
  "my_robot_ids": [0, 1, 2, 3, 4],
  "config": {
    "max_turns": 500,
    "map_width": 36,
    "map_height": 36,
    "robot_capacity": 150,
    "energy_spawn_interval": 10,
    "energy_spawn_batch": 3
  },
  "initial_tiles": [
    { "type": "Empty" },
    { "type": "Wall" },
    { "type": "Conveyor", "direction": "Up" },
    { "type": "Energy", "value": 42, "ttl": null },
    { "type": "Cabinet", "id": 0, "capacity": 1600, "occupied_capacity": 0 }
  ],
  "initial_robots": [
    {
      "id": 0,
      "team": "Alpha",
      "position": { "x": 2, "y": 16 },
      "cargo": 0,
      "jam_cooldown": 0,
      "jammed_turns": 0
    }
  ]
}
```

`initial_tiles` 是长度 1296（36×36）的数组，行优先展开，`tiles[y * 36 + x]` 是坐标 `(x, y)` 的格子。

返回 `200 OK` 即可，内容忽略。

---

### `POST /act`

**每回合调用一次，超时 200ms，超时视为全员 Wait。**

请求体：

```json
{
  "turn": 1,
  "tiles": [ /* 当前地图状态，格式同 init，长度 1296 */ ],
  "robots": [
    {
      "id": 0,
      "team": "Alpha",
      "position": { "x": 3, "y": 16 },
      "cargo": 12,
      "jam_cooldown": 0,
      "jammed_turns": 0
    }
  ],
  "scores": { "Alpha": 0, "Beta": 0 },
  "last_events": [
    { "robot_id": 0, "description": "拾取了 12 点能量" }
  ]
}
```

返回体：

```json
{
  "actions": {
    "0": "Move(Right)",
    "1": "Pick",
    "2": "Drop",
    "3": "Jam",
    "4": "Wait"
  }
}
```

动作字符串枚举：`Move(Up)` / `Move(Down)` / `Move(Left)` / `Move(Right)` / `Pick` / `Drop` / `Jam` / `Wait`

没有提供动作的机器人默认 `Wait`。

---

### `POST /finish`

比赛结束时调用一次，可以用来记录结果。

```json
{
  "final_scores": { "Alpha": 1234, "Beta": 987 },
  "winner": "Alpha",
  "total_turns": 500
}
```

`winner` 可能是 `"Alpha"` / `"Beta"` / `null`（平局）。

返回 `200 OK` 即可。

---

## 提交方式

把你的代码发给我，我来在服务端启动并跑对战。代码需要满足：

1. 能在本地 `go run .` / `python main.py` / `cargo run` 等方式直接启动
2. 启动后监听 `8080` 端口（或告诉我你用的端口）
3. 实现上面 4 个接口

如果依赖比较复杂，提供一个 `Dockerfile` 最省事：

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
EXPOSE 8080
CMD ["python", "main.py"]
```

---

## 策略提示

- **深区能量值高**（最高 88），但路程远，需要权衡往返成本
- **背包接近 150 时尽快回仓**，否则无法继续拾取
- **机架有容量上限**，中央机架（id=0）容量最大但竞争最激烈
- **传送带可以加速**，侧通道传送带可快速纵向移动
- **JAM 打断节奏**，在对手即将 Drop 时 Jam 效果最大，但注意 5 回合冷却

---

## 参考实现

仓库内有两个内置 bot 可以参考逻辑：

- `GreedyCollectorBot`：贪心拾取最近能量，背包 1/3 满时回仓
- `CabinetRushBot`：偏好高价值能量，背包 1/2 满时回仓

源码在 `crates/engine-core/src/bots.rs`。
