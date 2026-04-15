# Agent Arena 参赛指南

> 机房调度走廊 · 1v1 · 5v5 机器人 · 500 回合

---

## 背景

这是一个内部 Agent 对抗评测场。你需要写一个 HTTP 服务，控制 5 个机器人在 36×36 的机房地图上采集能量、投递机架、对抗对手，最终得分高者获胜。

比赛由裁判方统一调度，你只需要把服务部署好、把地址发给我，剩下的我来跑。

---

## 游戏规则

### 地图

36×36 机房走廊型地图，有主通道、侧通道、深区。地图结构固定，每场比赛的能量分布由 seed 决定。

```
坐标系：原点 (0,0) 在左上角，x 向右，y 向下
```

地图元素：

| 元素 | 说明 |
|------|------|
| `Empty` | 可通行空地 |
| `Wall` | 墙，不可进入 |
| `Conveyor` | 传送带，进入后自动推送 1 格 |
| `Energy` | 能量点，站上去 Pick 拾取 |
| `Cabinet` | 机架，站上去 Drop 投递得分 |

### 你的机器人

- 每方 5 个机器人，背包上限 **150**
- Alpha 队出生在左侧 x=2，Beta 队出生在右侧 x=33
- 机器人 id：Alpha 队 0~4，Beta 队 5~9

### 得分

站在机架上执行 `Drop`，将背包能量投入机架，得分 = 实际投入量。机架有总容量上限，满了不再接受投递。500 回合结束，得分高者胜。

### 能量

能量按区域分布，数值 1~88：

| 区域 | 位置 | 数值范围 |
|------|------|---------|
| 主通道 | 靠近地图中心 | 4~48，偏低 |
| 侧区 | 中间地带 | 8~62，中等 |
| 深区 | 四角边缘 | 12~88，偏高 |

高价值能量（≥70）有 TTL，10~18 回合后消失。每 10 回合刷新 3 个新能量点。

### 动作

每个机器人每回合提交 1 个动作：

| 动作 | 说明 |
|------|------|
| `Move(Up/Down/Left/Right)` | 移动一格 |
| `Pick` | 拾取当前格能量 |
| `Drop` | 向当前格机架投递 |
| `Jam` | 干扰相邻敌方机器人（下回合对方不能 Pick/Drop，冷却 5 回合，满载不可用） |
| `Wait` | 不动 |

非法动作自动降级为 `Wait`。

### 碰撞

两个机器人同时移动到同一格 → 双方失败原地停留。目标格有静止机器人或墙 → 移动失败。

### 回合结算顺序

移动 → 冷却计时 → Pick → Drop → Jam → 传送带推送 → 能量 TTL → 刷新能量

---

## 接入方式

你需要实现一个 HTTP 服务，监听 **8080 端口**，实现以下 4 个接口。

### `GET /health`

健康检查，返回 200 即可。

---

### `POST /init`

比赛开始时调用一次。

```json
{
  "match_id": "match-42",
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
  "initial_tiles": [ ... ],
  "initial_robots": [ ... ]
}
```

`initial_tiles` 是长度 1296 的数组（36×36），`tiles[y*36+x]` 是坐标 `(x,y)` 的格子。

返回 200 即可，内容忽略。

---

### `POST /act`

**每回合调用一次，超时 200ms，超时视为全员 Wait。**

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

---

### `POST /finish`

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

## 最简 Python 模板

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
            # ↓ 在这里写你的策略
            actions = {str(r["id"]): random.choice(ACTIONS) for r in robots}
            self._ok({"actions": actions})
        elif self.path == "/finish":
            self._ok()

HTTPServer(("", PORT), Handler).serve_forever()
```

启动：

```bash
python3 bot.py
# 或指定端口
PORT=8080 python3 bot.py
```

---

## 提交方式

把你的服务部署到一个可访问的地址（本机、云服务器、内网都行），然后把地址发给我：

```
http://你的IP:8080
```

我会注册进排行榜，用不同 seed 发起多场对战，结果实时更新。

---

## 策略提示

- 深区能量值高（最高 88），但路程远，需要权衡往返成本
- 背包接近 150 时尽快回仓，否则无法继续拾取
- 11 个机架容量不同（380~1600），中央机架容量最大但竞争最激烈
- 传送带可以加速移动，也可能把你推到不想去的地方
- Jam 可以打断对手的 Drop 节奏，但注意 5 回合冷却
- 机架满了就不得分，注意分散投递目标
