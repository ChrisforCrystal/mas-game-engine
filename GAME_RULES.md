# Agent Arena — 游戏规则与 Bot 接入规范

> 版本：v2  
> 对局：1v1，每方 5 个机器人，500 回合  
> 地图：多张预设地图，每场比赛可选不同地图

---

## 背景

2026 年，算力需求爆发式增长。贵安数据中心建设了大规模机房集群，但机房内部的能量调度仍然依赖人工巡检——效率低、响应慢。

你的任务：派出一支 5 人机器人小队，在机房走廊中自主巡逻，采集散落的能量模块，投递到指定机架完成充能。

但你不是唯一的参赛者。对手也派出了自己的机器人小队，在同一片机房中争夺有限的能量资源。你可以干扰对手、抢占关键通道、利用传送带加速——一切为了在 500 回合内拿到更高的充能得分。

这不只是算法竞赛，更是一场策略博弈。

---

## 1. 地图

### 1.1 概述

地图由 JSON 文件定义，每场比赛可以选择不同的地图。地图尺寸、结构、机架数量和位置因图而异。

你的 Bot 需要在 `/init` 阶段解析地图数据，动态适应不同地形。不要硬编码任何地图结构。

坐标系：原点 `(0,0)` 在左上角，x 向右增大，y 向下增大。

### 1.2 地图元素

| 元素 | 说明 |
|------|------|
| `Empty` | 可通行空地 |
| `Wall` | 不可通行墙壁 |
| `Conveyor(方向)` | 传送带，进入后回合结算时自动推送 1 格（Up/Down/Left/Right） |
| `Energy { value, ttl }` | 能量点，value 为能量值，ttl 为剩余存活回合（null 表示永久） |
| `Cabinet { id, capacity, occupied_capacity }` | 机架，用于投递能量得分 |

### 1.3 当前可用地图

| 地图 | 风格 | 特点 |
|------|------|------|
| 标准走廊（新手图） | 均衡 | 主通道宽敞，传送带辅助移动，能量分布均匀，适合测试基础策略 |
| 沙漏（卡口图） | 对抗 | 中央只有单格通道连接两侧，必须穿越卡口才能得分，极易堵塞 |
| 迷宫（死胡同图） | 路径规划 | 密集内墙形成大量死胡同，高价值能量藏在尽头，传送带陷阱会推你进死路 |
| 孤岛（传送带陷阱图） | 博弈 | 高价值机架在四个孤岛上，只能通过单向传送带进入，进去容易出来难 |
| 荒漠（极限资源图） | 极限 | 能量极度稀缺且集中在对方出生区附近，机架极少，每一分都来之不易 |

地图会持续更新。

### 1.4 出生区

- Alpha 队：地图左侧（具体位置由地图定义）
- Beta 队：地图右侧（镜像对称）
- 机器人 id：Alpha 队 0~4，Beta 队 5~9

### 1.5 能量区域

能量掉落点按位置分为三个区域，影响掉落数值：

| 区域 | 位置特征 | 数值范围 | 特点 |
|------|---------|---------|------|
| Main（主通道） | 靠近地图中心 | 4~48 | 容易拿但不值钱 |
| Side（侧区） | 中间地带 | 8~62 | 性价比均衡 |
| Deep（深区） | 四角/边缘 | 12~88 | 路程远但回报大 |

地图也可以自定义能量区域，覆盖默认分类。

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
- 被干扰机器人下一回合不能执行 PICK 和 DROP（可以移动）
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

## 4. 机器人动作

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

---

## 5. Bot HTTP 接口规范

Bot 需要实现一个 HTTP 服务，监听指定端口（默认 8080），实现以下 4 个接口。

### 5.1 `GET /health`

健康检查，返回 200 即可。

---

### 5.2 `POST /init`

比赛开始时调用一次，传入地图和初始状态。这是你获取地图信息的唯一机会，务必解析并保存。

```json
{
  "match_id": "string",
  "seed": 12345,
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

`initial_tiles` 是行优先展开的一维数组，长度 = `map_width * map_height`。`tiles[y * map_width + x]` 是坐标 `(x, y)` 的格子。

注意：`map_width` 和 `map_height` 可能因地图不同而变化，不要硬编码。

返回 200 即可，内容忽略。

---

### 5.3 `POST /act`

每回合调用一次。超时 200ms，超时视为全员 WAIT。

请求：

```json
{
  "turn": 1,
  "tiles": [ ... ],
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

响应：

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

动作字符串：`Move(Up)` / `Move(Down)` / `Move(Left)` / `Move(Right)` / `Pick` / `Drop` / `Jam` / `Wait`

未提供动作的机器人默认 WAIT，非法动作也降级为 WAIT。

---

### 5.4 `POST /finish`

比赛结束时调用一次。

```json
{
  "final_scores": { "Alpha": 1234, "Beta": 987 },
  "winner": "Alpha",
  "total_turns": 500
}
```

返回 200 即可。

---

## 6. Bot 开发建议

### 关键策略点

1. **动态适应地图**：不同地图结构差异很大，必须在 `/init` 阶段解析地图，动态规划路径和策略
2. **深区高价值能量**：Deep 区能量值可达 55~88，但路程远，需权衡往返成本
3. **背包管理**：cargo 接近 150 时应优先回仓，否则无法继续拾取
4. **机架容量感知**：不同地图机架数量和容量差异很大，注意分散投递目标，机架满了就不得分
5. **传送带利用与规避**：传送带可以加速移动，也可能把你推到不想去的地方，某些地图有传送带陷阱
6. **JAM 时机**：在对手即将 DROP 时 JAM 可打断其投递节奏，但注意 5 回合冷却
7. **卡口控制**：某些地图（如沙漏图）有关键卡口，控制卡口可以封锁对手

### 最简 Python 模板

直接复制，改 `/act` 里的逻辑就行：

```python
import json, os, random
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PORT", 8080))
ACTIONS = ["Move(Up)", "Move(Down)", "Move(Left)", "Move(Right)", "Pick", "Drop", "Wait"]

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def _ok(self, body=None):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body or {}).encode())

    def do_GET(self):
        if self.path == "/health":
            self._ok({"status": "ok"})

    def do_POST(self):
        body = self._body()
        if self.path == "/init":
            self._ok()
        elif self.path == "/act":
            robots = body.get("robots", [])
            actions = {str(r["id"]): random.choice(ACTIONS) for r in robots}
            self._ok({"actions": actions})
        elif self.path == "/finish":
            self._ok()

HTTPServer(("", PORT), Handler).serve_forever()
```

### 提交方式

把你的服务部署到一个可访问的地址（本机、云服务器、内网都行），然后把地址发给我：

```
http://你的IP:8080
```

我会注册进排行榜，用不同 seed + 不同地图发起多场对战，结果实时更新。

---

## 7. 评分与排名

- 单局：得分高者胜，平局则平局
- 多局评测：多个 seed + 多张地图下的综合胜率和平均得分
- 比赛会在不同地图上进行，综合表现决定最终排名
