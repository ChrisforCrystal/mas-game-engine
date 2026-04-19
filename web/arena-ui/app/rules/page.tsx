"use client";

export default function RulesPage() {
  return (
    <div className="shell">
      <div className="arena-shell frame" style={{ borderRadius: 28, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <p className="eyebrow">Agent Arena</p>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "2rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            游戏说明
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: 8 }}>
            1v1，每方 5 个机器人，500 回合，争夺能量、投递得分
          </p>
        </div>

        {/* 背景 */}
        <Section title="背景故事">
          <p>2026 年，算力需求爆发式增长。贵安数据中心建设了大规模机房集群，但机房内部的能量调度仍然依赖人工巡检。</p>
          <p>你的任务：派出一支 5 人机器人小队，在机房走廊中自主巡逻，采集散落的能量模块，投递到指定机架完成充能。对手也在同一片机房中争夺资源。你可以干扰对手、抢占关键通道、利用传送带加速——一切为了在 500 回合内拿到更高的充能得分。</p>
        </Section>

        {/* 地图 */}
        <Section title="1. 地图">
          <p>地图由 JSON 文件定义，每场比赛可选不同地图。Bot 需要在 <Code>/init</Code> 阶段解析地图数据，动态适应不同地形。</p>
          <p>坐标系：原点 <Code>(0,0)</Code> 在左上角，x 向右增大，y 向下增大。</p>
          <Table headers={["元素", "说明"]} rows={[
            ["Empty", "可通行空地"],
            ["Wall", "不可通行墙壁"],
            ["Conveyor(方向)", "传送带，进入后自动推送 1 格"],
            ["Energy { value, ttl }", "能量点，value 为能量值，ttl 为剩余存活回合"],
            ["Cabinet { id, capacity }", "机架，用于投递能量得分"],
          ]} />
          <h4 style={h4Style}>能量区域</h4>
          <Table headers={["区域", "位置", "数值范围", "特点"]} rows={[
            ["Main（主通道）", "靠近中心", "4~48", "容易拿但不值钱"],
            ["Side（侧区）", "中间地带", "8~62", "性价比均衡"],
            ["Deep（深区）", "四角/边缘", "12~88", "路程远但回报大"],
          ]} />
        </Section>

        {/* 游戏机制 */}
        <Section title="2. 游戏机制">
          <h4 style={h4Style}>能量系统</h4>
          <ul style={ulStyle}>
            <li>机器人背包上限：<Code>150</Code></li>
            <li><Code>PICK</Code>：站在 Energy 格上执行，拾取能量（不超过剩余背包容量）</li>
            <li>高价值能量（≥70）有 TTL（10~18 回合），到期消失</li>
            <li>能量按波次刷新：初始 8 个，之后每 10 回合刷新 3 个</li>
            <li>全局能量预算 = 所有机架总容量 × 80%，耗尽后不再刷新</li>
          </ul>

          <h4 style={h4Style}>得分系统</h4>
          <ul style={ulStyle}>
            <li><Code>DROP</Code>：站在 Cabinet 格上执行，将背包所有能量投入机架</li>
            <li>实际投入量 = min(背包能量, 机架剩余容量)</li>
            <li>得分 = 实际投入量（1:1），机架满后不再接受</li>
          </ul>

          <h4 style={h4Style}>干扰机制（JAM）</h4>
          <ul style={ulStyle}>
            <li>对相邻（曼哈顿距离=1）的敌方机器人执行</li>
            <li>被干扰机器人下一回合不能 PICK 和 DROP（可以移动）</li>
            <li>JAM 冷却：5 回合</li>
            <li>满载（cargo=150）时不能使用 JAM</li>
          </ul>

          <h4 style={h4Style}>传送带</h4>
          <ul style={ulStyle}>
            <li>进入传送带格后，回合结算时自动被推送 1 格</li>
            <li>推送目标被占据或为墙时，推送失败</li>
          </ul>

          <h4 style={h4Style}>碰撞规则</h4>
          <Table headers={["情况", "结果"]} rows={[
            ["两个机器人同时移动到同一格", "双方移动失败"],
            ["两个机器人尝试互换位置", "双方移动失败"],
            ["目标格有静止机器人", "移动失败"],
            ["移动目标为 Wall", "移动失败"],
            ["非法动作", "视为 WAIT"],
          ]} />
        </Section>

        {/* 回合结算 */}
        <Section title="3. 回合结算顺序">
          <ol style={{ ...ulStyle, paddingLeft: 20 }}>
            <li>收集双方所有机器人动作</li>
            <li>处理主动移动（含碰撞检测）</li>
            <li>更新冷却计时</li>
            <li>处理 PICK（被 jam 的跳过）</li>
            <li>处理 DROP（被 jam 的跳过）</li>
            <li>处理 JAM</li>
            <li>处理传送带推送</li>
            <li>更新能量 TTL</li>
            <li>每 10 回合刷新新能量</li>
          </ol>
        </Section>

        {/* 动作 */}
        <Section title="4. 机器人动作">
          <pre style={preStyle}>{`Move(Up)    向上移动一格（y-1）
Move(Down)  向下移动一格（y+1）
Move(Left)  向左移动一格（x-1）
Move(Right) 向右移动一格（x+1）
Pick        拾取当前格能量
Drop        向当前格机架投递能量
Jam         干扰相邻敌方机器人
Wait        不执行任何操作`}</pre>
        </Section>

        {/* Bot 接口 */}
        <Section title="5. Bot HTTP 接口规范">
          <p>Bot 需要实现一个 HTTP 服务，监听指定端口（默认 8080），实现以下 4 个接口：</p>

          <h4 style={h4Style}>GET /health</h4>
          <p style={pStyle}>健康检查，返回 200 即可。</p>

          <h4 style={h4Style}>POST /init</h4>
          <p style={pStyle}>比赛开始时调用一次，传入地图和初始状态。这是你获取地图信息的唯一机会。</p>
          <pre style={preStyle}>{`{
  "match_id": "string",
  "seed": 12345,
  "team": "Alpha",
  "my_robot_ids": [0, 1, 2, 3, 4],
  "config": {
    "max_turns": 500,
    "map_width": 36,
    "map_height": 36,
    "robot_capacity": 150
  },
  "initial_tiles": [ ... ],
  "initial_robots": [ ... ]
}`}</pre>
          <p style={pStyle}><Code>initial_tiles</Code> 是行优先一维数组，<Code>tiles[y * map_width + x]</Code> 是坐标 (x, y) 的格子。</p>

          <h4 style={h4Style}>POST /act</h4>
          <p style={pStyle}>每回合调用一次。超时 200ms，超时视为全员 WAIT。</p>
          <p style={pStyle}>响应格式：</p>
          <pre style={preStyle}>{`{
  "actions": {
    "0": "Move(Right)",
    "1": "Pick",
    "2": "Drop",
    "3": "Jam",
    "4": "Wait"
  }
}`}</pre>

          <h4 style={h4Style}>POST /finish</h4>
          <p style={pStyle}>比赛结束时调用一次，返回 200 即可。</p>
        </Section>

        {/* 策略建议 */}
        <Section title="6. Bot 开发建议">
          <ul style={ulStyle}>
            <li>动态适应地图：不同地图结构差异很大，必须在 /init 阶段解析地图</li>
            <li>深区高价值能量：Deep 区能量值可达 55~88，但路程远，需权衡往返成本</li>
            <li>背包管理：cargo 接近 150 时应优先回仓</li>
            <li>机架容量感知：注意分散投递目标，机架满了就不得分</li>
            <li>传送带利用与规避：可以加速移动，也可能推你进死路</li>
            <li>JAM 时机：在对手即将 DROP 时 JAM 可打断其投递节奏</li>
            <li>卡口控制：某些地图有关键卡口，控制卡口可以封锁对手</li>
          </ul>
        </Section>

        {/* Python 模板 */}
        <Section title="7. 最简 Python 模板">
          <p style={pStyle}>直接复制，改 /act 里的逻辑就行：</p>
          <pre style={preStyle}>{`import json, os, random
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PORT", 8080))
ACTIONS = ["Move(Up)", "Move(Down)", "Move(Left)", "Move(Right)",
           "Pick", "Drop", "Wait"]

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
            actions = {str(r["id"]): random.choice(ACTIONS)
                       for r in robots}
            self._ok({"actions": actions})
        elif self.path == "/finish":
            self._ok()

HTTPServer(("", PORT), Handler).serve_forever()`}</pre>
        </Section>

        {/* 提交方式 */}
        <Section title="8. 提交方式">
          <p>把你的服务部署到一个可访问的地址（本机、云服务器、内网都行），然后在排行榜页面注册 Bot，填入地址即可。</p>
          <pre style={preStyle}>http://你的IP:8080</pre>
          <p style={pStyle}>系统会用不同 seed + 不同地图发起多场对战，结果实时更新到排行榜。</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
      <h3 style={{ margin: "0 0 12px", fontSize: "1.1rem", color: "var(--alpha)", fontFamily: "var(--font-display)", letterSpacing: "0.04em" }}>
        {title}
      </h3>
      <div style={{ color: "var(--text)", fontSize: "0.88rem", lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ background: "rgba(25,225,255,0.08)", color: "var(--alpha)", padding: "1px 6px", borderRadius: 4, fontSize: "0.84em" }}>
      {children}
    </code>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: "auto", marginTop: 8, marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid var(--line)", color: "var(--muted)", fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "6px 10px" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const h4Style: React.CSSProperties = { margin: "16px 0 6px", fontSize: "0.92rem", color: "var(--gold)" };
const pStyle: React.CSSProperties = { margin: "4px 0", color: "var(--muted)" };
const ulStyle: React.CSSProperties = { margin: "4px 0 12px", paddingLeft: 18, color: "var(--text)", lineHeight: 1.8 };
const preStyle: React.CSSProperties = {
  background: "rgba(7,18,31,0.9)",
  border: "1px solid var(--line-strong)",
  borderRadius: 10,
  padding: "12px 16px",
  fontSize: "0.78rem",
  lineHeight: 1.6,
  overflowX: "auto",
  color: "var(--alpha)",
  margin: "8px 0 12px",
};
