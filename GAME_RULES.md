# Agent Arena — 游戏规则与 Bot 接入规范

> 版本：v1（基于 engine-core 实际实现）  
> 地图：36×36，机房走廊型  
> 对局：1v1，每方 5 个机器人，500 回合

---

## 1. 地图结构

地图固定为 36×36，由规则生成，不随 seed 变化结构（当前版本地图结构固定，seed 影响能量掉落位置和数值）。

### 地图元素

| 元素 | 说明 |
|------|------|
| `Empty` | 可通行空地 |
| `Wall` | 不可通行墙壁 |
| `Conveyor(方向)` | 传送带，推送方向：Up/Down/Left/Right |
| `Energy { value, ttl }` | 能量点，value 为能量值，ttl 为剩余存活回合（null 表示永久） |
| `Cabinet { id, capacity, occupied_capacity }` | 机架，用于投递能量得分 |

### 出生区

- Alpha 队：x=2，y=16~20（地图左侧中央）
- Beta 队：x=33，y=16~20（地图右侧中央，镜像对称）
- 机器人 id：Alpha 队 0~4，Beta 队 5~9

### 机架分布（共 11 个）

| id | 位置 (x,y) | 容量 |
|----|-----------|------|
| 0 | (18, 18) 中央 | 1600 |
| 1 | (15, 16) | 1180 |
| 2 | (21, 20) | 920 |
| 3 | (6, 6) 左上角 | 760 |
| 4 | (29, 6) 右上角 | 700 |
| 5 | (6, 29) 左下角 | 640 |
| 6 | (29, 29) 右下角 | 600 |
| 7 | (5, 12) 左侧 | 540 |
| 8 | (30, 12) 右侧 | 500 |
| 9 | (5, 24) 左侧 | 440 |
| 10 | (30, 24) 右侧 | 380 |

### 传送带分布

- 中央纵向：x=17 向下，x=19 向上（y=12~24）
- 中央横向：y=14 和 y=22，左半段向右，右半段向左
- 侧通道纵向：x=8 和 x=27，上段向上，下段向下

### 能量区域分类

能量掉落点按位置分为三个区域，影响掉落数值分布：

| 区域 | 条件 | 数值范围 |
|------|------|---------|
| Main（主通道） | 距中心 x≤3 或 y≤2 | 4~48，偏低值 |
| Deep（深区/角落） | x≤8 或 x≥27 或 y≤8 或 y≥27 | 12~88，偏高值 |
| Side（侧区） | 其余区域 | 8~62，中等 |

---

## 2. 游戏机制

### 2.1 能量系统

- 机器人背包上限：**150**
- `PICK`：站在 Energy 格上执行，拾取 `min(格子能量值, 剩余背包容量)` 的能量
- 能量格被拾取至 0 后变为 Empty
- 高价值能量（value ≥ 70）有 TTL（10~18 回合），到期消失
- 能量按波次刷新：初始刷新 8 个，之后每 10 回合刷新 3 个
- 全局能量预算 = 所有机架总容量 × 80%，耗尽后不再刷新

### 2.2 得分系统

- `DROP`：站在 Cabinet 格上执行，将背包所有能量投入机架
- 实际投入量 = `min(背包能量, 机架剩余容量)`
- 得分 = 实际投入量（1:1）
- 机架有总容量上限，满后不再接受投递
- 最终得分高者获胜，平局则平局

### 2.3 干扰机制（JAM）

- 对相邻（曼哈顿距离=1）的敌方机器人执行
- 被干扰机器人下一回合**不能执行 PICK 和 DROP**（可以移动）
- JAM 冷却：5 回合
- 满载（cargo = 150）时不能使用 JAM

### 2.4 传送带

- 机器人进入传送带格后，回合结算时自动被推送 1 格
- 推送目标被占据或为墙时，推送失败
- 多个机器人同时被推向同一格时，全部推送失败

### 2.5 碰撞规则

| 情况 | 结果 |
|------|------|
| 两个机器人同时移动到同一格 | 双方移动失败，原地停留 |
| 两个机器人尝试互换位置 | 双方移动失败 |
| 目标格有静止机器人 | 移动失败 |
| 移动目标为 Wall | 移动失败 |
| 非法动作 | 视为 WAIT |

---

## 3. 回合结算顺序

每回合严格按以下顺序结算：

1. 收集双方所有机器人动作
2. 处理主动移动（含碰撞检测）
3. 更新冷却计时（jam_cooldown、jammed_turns 各减 1）
4. 处理 PICK（被 jam 的机器人跳过）
5. 处理 DROP（被 jam 的机器人跳过）
6. 处理 JAM
7. 处理传送带推送
8. 更新能量 TTL（到期变 Empty）
9. 若 `(turn + 1) % 10 == 0`，刷新新一批能量
10. turn 计数 +1

---

## 4. 机器人动作集合

```
Move(Up)    向上移动一格（y-1）
Move(Down)  向下移动一格（y+1）
Move(Left)  向左移动一格（x-1）
Move(Right) 向右移动一格（x+1）
Pick        拾取当前格能量
Drop        向当前格机架投递能量
Jam         干扰相邻敌方机器人
Wait        不执行任何操作
```

坐标系：原点 (0,0) 在左上角，x 向右，y 向下。

---

## 5. Bot HTTP 接口规范

Bot 需要实现一个 HTTP 服务，监听指定端口（默认 8080）。

### 5.1 `GET /health`

健康检查，服务就绪后返回 200。

**Response:** `200 OK`

---

### 5.2 `POST /init`

比赛开始时调用一次，传入地图和初始状态。

**Request Body:**
```json
{
  "match_id": "string",
  "seed": 12345,
  "team": "Alpha",          // "Alpha" 或 "Beta"
  "my_robot_ids": [0,1,2,3,4],
  "config": {
    "max_turns": 500,
    "map_width": 36,
    "map_height": 36,
    "robot_capacity": 150,
    "energy_spawn_interval": 10,
    "energy_spawn_batch": 3
  },
  "initial_tiles": [        // 长度 36*36=1296，行优先展开
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

**Response:** `200 OK`（内容忽略）

---

### 5.3 `POST /act`

每回合调用一次，超时视为全员 WAIT。

**超时限制：200ms**

**Request Body:**
```json
{
  "turn": 1,
  "tiles": [ /* 同 init，当前地图状态，长度 1296 */ ],
  "robots": [
    {
      "id": 0,
      "team": "Alpha",
      "position": { "x": 3, "y": 16 },
      "cargo": 0,
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

**Response Body:**
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

动作字符串枚举：
- `"Move(Up)"` / `"Move(Down)"` / `"Move(Left)"` / `"Move(Right)"`
- `"Pick"` / `"Drop"` / `"Jam"` / `"Wait"`

未提供动作的机器人默认 WAIT，非法动作也降级为 WAIT。

---

### 5.4 `POST /finish`

比赛结束时调用一次。

**Request Body:**
```json
{
  "final_scores": { "Alpha": 1234, "Beta": 987 },
  "winner": "Alpha",        // "Alpha" / "Beta" / null（平局）
  "total_turns": 500
}
```

**Response:** `200 OK`（内容忽略）

---

## 6. 快速启动

### 运行本地对战（Rust 内置 bot）

```bash
cd /path/to/mascompelete
cargo run -p local-match
```

回放文件输出到 `artifacts/replays/match-{seed}.json`。

### 指定 seed

```bash
# 修改 apps/local-match/src/main.rs 中的 seed 参数
cargo run -p local-match
```

### 构建引擎库

```bash
cargo build -p engine-core
```

---

## 7. Bot 开发建议

### 关键策略点

1. **深区高价值能量**：Deep 区能量值可达 55~88，但路程远，需权衡往返成本
2. **背包管理**：cargo 接近 150 时应优先回仓，否则无法继续拾取
3. **机架容量感知**：中央机架（id=0，容量 1600）最大，但竞争最激烈；角落机架容量小但路程近
4. **传送带利用**：侧通道传送带可加速纵向移动，中央传送带可快速进出中心区
5. **JAM 时机**：在对手即将 DROP 时 JAM 可打断其投递节奏，但注意 5 回合冷却

### Bot 模板结构（任意语言）

```
your-bot/
├── Dockerfile          # 必须，暴露 8080 端口
├── src/
│   └── main.*          # HTTP 服务入口
└── README.md
```

Dockerfile 最小示例（Go）：
```dockerfile
FROM golang:1.22-alpine
WORKDIR /app
COPY . .
RUN go build -o bot .
EXPOSE 8080
CMD ["./bot"]
```

---

## 8. 评分与排名

- 单局：得分高者胜，平局则平局
- 多局评测：多个 seed 下的综合胜率和平均得分
- 统计指标：非法动作率、平均响应延迟、JAM 次数、总投递量
