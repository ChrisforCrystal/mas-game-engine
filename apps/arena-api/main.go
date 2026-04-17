package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"path/filepath"
	"strconv"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var dataDir string
var adminToken string

// ── live match progress ──────────────────────────────────────────────────────

type matchProgress struct {
	Turn   int `json:"turn"`
	Total  int `json:"total"`
	ScoreA int `json:"score_a"`
	ScoreB int `json:"score_b"`
}

type matchLive struct {
	mu          sync.Mutex
	latest      matchProgress
	subscribers []chan matchProgress
	done        bool
}

var liveMatches sync.Map // map[int64]*matchLive

func getLive(matchID int64) *matchLive {
	v, _ := liveMatches.LoadOrStore(matchID, &matchLive{})
	return v.(*matchLive)
}

func (ml *matchLive) publish(p matchProgress) {
	ml.mu.Lock()
	defer ml.mu.Unlock()
	ml.latest = p
	for _, ch := range ml.subscribers {
		select {
		case ch <- p:
		default:
		}
	}
}

func (ml *matchLive) finish() {
	ml.mu.Lock()
	defer ml.mu.Unlock()
	ml.done = true
	for _, ch := range ml.subscribers {
		close(ch)
	}
	ml.subscribers = nil
}

func (ml *matchLive) subscribe() (chan matchProgress, func()) {
	ml.mu.Lock()
	defer ml.mu.Unlock()
	ch := make(chan matchProgress, 64)
	if ml.done {
		close(ch)
		return ch, func() {}
	}
	// send current state immediately
	if ml.latest.Total > 0 {
		ch <- ml.latest
	}
	ml.subscribers = append(ml.subscribers, ch)
	return ch, func() {
		ml.mu.Lock()
		defer ml.mu.Unlock()
		for i, c := range ml.subscribers {
			if c == ch {
				ml.subscribers = append(ml.subscribers[:i], ml.subscribers[i+1:]...)
				break
			}
		}
	}
}

func main() {
	// ARENA_DATA_DIR controls where all persistent data goes
	// container: set to /app/nas, local: defaults to "."
	dataDir = os.Getenv("ARENA_DATA_DIR")
	if dataDir == "" {
		dataDir = "."
	}
	os.MkdirAll(dataDir, 0755)

	// setup log directory and file
	logDir := filepath.Join(dataDir, "logs")
	if d := os.Getenv("ARENA_LOG_DIR"); d != "" {
		logDir = d
	}
	os.MkdirAll(logDir, 0755)
	logFile, err := os.OpenFile(filepath.Join(logDir, "arena-api.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		log.Fatal("open log file:", err)
	}
	defer logFile.Close()
	log.SetOutput(io.MultiWriter(os.Stdout, logFile))

	log.Printf("data dir: %s", dataDir)

	adminToken = os.Getenv("ARENA_ADMIN_TOKEN")
	if adminToken == "" {
		adminToken = "mascompelete2026"
		log.Printf("ARENA_ADMIN_TOKEN not set, using default token")
	}

	dbPath := filepath.Join(dataDir, "arena.db")
	var dbErr error
	db, dbErr = sql.Open("sqlite3", dbPath)
	if dbErr != nil {
		log.Fatal(dbErr)
	}
	defer db.Close()
	initDB()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /bots", handleRegisterBot)
	mux.HandleFunc("GET /bots", handleListBots)
	mux.HandleFunc("DELETE /bots/{id}", handleDeleteBot)
	mux.HandleFunc("POST /matches", handleStartMatch)
	mux.HandleFunc("GET /matches", handleListMatches)
	mux.HandleFunc("GET /matches/{id}", handleGetMatch)
	mux.HandleFunc("DELETE /matches/{id}", handleDeleteMatch)
	mux.HandleFunc("DELETE /matches", handleClearMatches)
	mux.HandleFunc("GET /rankings", handleRankings)
	mux.HandleFunc("GET /maps", handleListMaps)
	mux.HandleFunc("GET /maps/{name}", handleGetMap)
	mux.HandleFunc("GET /replays", handleListReplays)
	mux.HandleFunc("GET /replays/{name}", handleGetReplay)
	mux.HandleFunc("GET /matches/{id}/live", handleMatchLive)

	port := "9090"
	log.Printf("Arena API listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, cors(mux)))
}

func initDB() {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS bots (
			id      INTEGER PRIMARY KEY AUTOINCREMENT,
			name    TEXT NOT NULL UNIQUE,
			url     TEXT NOT NULL,
			owner   TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS matches (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			bot_a_id    INTEGER NOT NULL,
			bot_b_id    INTEGER NOT NULL,
			seed        INTEGER NOT NULL,
			map_path    TEXT,
			status      TEXT NOT NULL DEFAULT 'pending',
			winner      TEXT,
			score_a     INTEGER,
			score_b     INTEGER,
			replay_path TEXT,
			started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			finished_at DATETIME,
			FOREIGN KEY(bot_a_id) REFERENCES bots(id),
			FOREIGN KEY(bot_b_id) REFERENCES bots(id)
		);
	`)
	if err != nil {
		log.Fatal("initDB:", err)
	}
	// migrate: add map_path column if it doesn't exist yet
	db.Exec(`ALTER TABLE matches ADD COLUMN map_path TEXT`)
	db.Exec(`ALTER TABLE matches ADD COLUMN latency_a INTEGER`)
	db.Exec(`ALTER TABLE matches ADD COLUMN latency_b INTEGER`)
}

// pingBot sends a GET to bot's /health and returns latency in ms, or error
func pingBot(botURL string) (int, error) {
	url := strings.TrimRight(botURL, "/") + "/health"
	t := time.Now()
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	latency := int(time.Since(t).Milliseconds())
	if err != nil {
		return latency, fmt.Errorf("ping %s failed: %v", url, err)
	}
	resp.Body.Close()
	return latency, nil
}

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	token := r.URL.Query().Get("token")
	if token == "" {
		token = r.Header.Get("X-Admin-Token")
	}
	if token != adminToken {
		writeErr(w, 403, "需要管理员权限，请在 URL 中添加 ?token=xxx")
		return false
	}
	return true
}

// ── CORS middleware ───────────────────────────────────────────────────────────

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── helpers ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// ── POST /bots ────────────────────────────────────────────────────────────────

type Bot struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Owner     string `json:"owner"`
	CreatedAt string `json:"created_at"`
}

func handleRegisterBot(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name  string `json:"name"`
		URL   string `json:"url"`
		Owner string `json:"owner"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.URL == "" {
		log.Printf("[bot] register failed: invalid request")
		writeErr(w, 400, "name and url are required")
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	res, err := db.Exec(`INSERT INTO bots (name, url, owner) VALUES (?, ?, ?)`, req.Name, req.URL, req.Owner)
	if err != nil {
		log.Printf("[bot] register failed name=%s: %v", req.Name, err)
		writeErr(w, 409, "bot name already exists or db error: "+err.Error())
		return
	}
	id, _ := res.LastInsertId()
	log.Printf("[bot] registered id=%d name=%s url=%s", id, req.Name, req.URL)
	writeJSON(w, 201, map[string]any{"id": id, "name": req.Name})
}

// ── DELETE /bots/{id} ────────────────────────────────────────────────────────

func handleDeleteBot(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	res, err := db.Exec(`DELETE FROM bots WHERE id = ?`, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeErr(w, 404, "bot not found")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

// ── GET /bots ─────────────────────────────────────────────────────────────────

func handleListBots(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT id, name, url, owner, created_at FROM bots ORDER BY id`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	bots := []Bot{}
	for rows.Next() {
		var b Bot
		rows.Scan(&b.ID, &b.Name, &b.URL, &b.Owner, &b.CreatedAt)
		bots = append(bots, b)
	}
	writeJSON(w, 200, bots)
}

// ── POST /matches ─────────────────────────────────────────────────────────────

type Match struct {
	ID         int64   `json:"id"`
	BotAID     int64   `json:"bot_a_id"`
	BotBID     int64   `json:"bot_b_id"`
	BotAName   string  `json:"bot_a_name"`
	BotBName   string  `json:"bot_b_name"`
	Seed       int64   `json:"seed"`
	MapPath    *string `json:"map_path"`
	Status     string  `json:"status"`
	Winner     *string `json:"winner"`
	ScoreA     *int    `json:"score_a"`
	ScoreB     *int    `json:"score_b"`
	ReplayPath *string `json:"replay_path"`
	LatencyA   *int    `json:"latency_a"`
	LatencyB   *int    `json:"latency_b"`
	StartedAt  string  `json:"started_at"`
	FinishedAt *string `json:"finished_at"`
}

func handleStartMatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BotAID  int64  `json:"bot_a_id"`
		BotBID  int64  `json:"bot_b_id"`
		Seed    int64  `json:"seed"`
		MapPath string `json:"map_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[match] start failed: invalid request body")
		writeErr(w, 400, "invalid request")
		return
	}

	var botAURL, botAName, botBURL, botBName string
	err := db.QueryRow(`SELECT url, name FROM bots WHERE id = ?`, req.BotAID).Scan(&botAURL, &botAName)
	if err != nil {
		log.Printf("[match] start failed: bot_a id=%d not found", req.BotAID)
		writeErr(w, 404, "bot_a not found")
		return
	}
	err = db.QueryRow(`SELECT url, name FROM bots WHERE id = ?`, req.BotBID).Scan(&botBURL, &botBName)
	if err != nil {
		log.Printf("[match] start failed: bot_b id=%d not found", req.BotBID)
		writeErr(w, 404, "bot_b not found")
		return
	}

	// pre-match latency check
	latA, errA := pingBot(botAURL)
	latB, errB := pingBot(botBURL)
	log.Printf("[match] ping: %s=%dms(err=%v) %s=%dms(err=%v)", botAName, latA, errA, botBName, latB, errB)

	if errA != nil {
		writeErr(w, 400, fmt.Sprintf("无法连接 %s（%s）：%v", botAName, botAURL, errA))
		return
	}
	if errB != nil {
		writeErr(w, 400, fmt.Sprintf("无法连接 %s（%s）：%v", botBName, botBURL, errB))
		return
	}
	if latA > 500 {
		writeErr(w, 400, fmt.Sprintf("%s 延迟过高（%dms > 500ms），请检查网络后重试", botAName, latA))
		return
	}
	if latB > 500 {
		writeErr(w, 400, fmt.Sprintf("%s 延迟过高（%dms > 500ms），请检查网络后重试", botBName, latB))
		return
	}

	seed := req.Seed
	if seed == 0 {
		seed = time.Now().UnixNano() % 1_000_000
	}

	var mapPathPtr *string
	if req.MapPath != "" {
		mapPathPtr = &req.MapPath
	}

	res, err := db.Exec(
		`INSERT INTO matches (bot_a_id, bot_b_id, seed, map_path, status, latency_a, latency_b) VALUES (?, ?, ?, ?, 'running', ?, ?)`,
		req.BotAID, req.BotBID, seed, mapPathPtr, latA, latB,
	)
	if err != nil {
		log.Printf("[match] db insert failed: %v", err)
		writeErr(w, 500, err.Error())
		return
	}
	matchID, _ := res.LastInsertId()

	log.Printf("[match %d] started: %s(%s, %dms) vs %s(%s, %dms) seed=%d map=%s",
		matchID, botAName, botAURL, latA, botBName, botBURL, latB, seed, req.MapPath)

	go runMatch(matchID, botAURL, botBURL, seed, req.MapPath)

	writeJSON(w, 202, map[string]any{"id": matchID, "seed": seed, "status": "running", "latency_a": latA, "latency_b": latB})
}

func runMatch(matchID int64, botAURL, botBURL string, seed int64, mapPath string) {
	started := time.Now()
	log.Printf("[match %d] launching runner: alpha=%s beta=%s seed=%d map=%s", matchID, botAURL, botBURL, seed, mapPath)

	// find http-match binary relative to this process
	exe, err := os.Executable()
	if err != nil {
		exe = "."
	}
	// look for http-match: next to binary, cwd, project root target/release, then PATH
	cwd, _ := os.Getwd()
	candidates := []string{
		filepath.Join(filepath.Dir(exe), "http-match"),
		"./http-match",
		filepath.Join(cwd, "target", "release", "http-match"),
		filepath.Join(cwd, "..", "target", "release", "http-match"),
		filepath.Join(cwd, "..", "..", "target", "release", "http-match"),
	}
	runnerPath := "http-match" // fallback to PATH
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			if abs, err := filepath.Abs(c); err == nil {
				runnerPath = abs
			} else {
				runnerPath = c
			}
			break
		}
	}
	log.Printf("[match %d] runner binary: %s", matchID, runnerPath)

	args := []string{botAURL, botBURL, strconv.FormatInt(seed, 10)}
	if mapPath != "" {
		args = append(args, "--map", mapPath)
	}
	cmd := exec.Command(runnerPath, args...)
	cmd.Env = append(os.Environ(), "ARENA_DATA_DIR="+dataDir)
	// set working dir to project root (where maps/ lives)
	if d := mapsDir(); d != "maps" {
		cmd.Dir = filepath.Dir(d)
		log.Printf("[match %d] working dir: %s", matchID, cmd.Dir)
	}

	// pipe stdout for real-time progress reading
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("[match %d] FAILED to create stdout pipe: %v", matchID, err)
		db.Exec(`UPDATE matches SET status='error', finished_at=CURRENT_TIMESTAMP WHERE id=?`, matchID)
		return
	}
	// capture stderr separately
	var stderrBuf strings.Builder
	cmd.Stderr = &stderrWriter{matchID: matchID, buf: &stderrBuf}

	live := getLive(matchID)
	defer func() {
		live.finish()
		// delay cleanup so late SSE subscribers can still get final state
		go func() {
			time.Sleep(30 * time.Second)
			liveMatches.Delete(matchID)
		}()
	}()

	if err := cmd.Start(); err != nil {
		log.Printf("[match %d] FAILED to start: %v", matchID, err)
		db.Exec(`UPDATE matches SET status='error', finished_at=CURRENT_TIMESTAMP WHERE id=?`, matchID)
		return
	}
	log.Printf("[match %d] process started (pid=%d)", matchID, cmd.Process.Pid)

	var allOutput strings.Builder
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		allOutput.WriteString(line)
		allOutput.WriteByte('\n')

		var turn, total, sa, sb int
		if n, _ := fmt.Sscanf(line, "PROGRESS %d/%d %d:%d", &turn, &total, &sa, &sb); n == 4 {
			live.publish(matchProgress{Turn: turn, Total: total, ScoreA: sa, ScoreB: sb})
		}
	}
	if err := scanner.Err(); err != nil {
		log.Printf("[match %d] scanner error: %v", matchID, err)
	}

	err = cmd.Wait()
	elapsed := time.Since(started)
	out := allOutput.String()

	if err != nil {
		log.Printf("[match %d] FAILED after %s: %v", matchID, elapsed, err)
		db.Exec(`UPDATE matches SET status='error', finished_at=CURRENT_TIMESTAMP WHERE id=?`, matchID)
		return
	}

	// parse last line: "Done  winner=Alpha  alpha=1234  beta=987  replay=..."
	winner, scoreA, scoreB, replayPath := parseRunnerOutput(out)
	log.Printf("[match %d] DONE in %s: winner=%s score=%d-%d replay=%s", matchID, elapsed, winner, scoreA, scoreB, replayPath)
	db.Exec(
		`UPDATE matches SET status='done', winner=?, score_a=?, score_b=?, replay_path=?, finished_at=CURRENT_TIMESTAMP WHERE id=?`,
		winner, scoreA, scoreB, replayPath, matchID,
	)
}

// stderrWriter captures stderr and logs each line in real time
type stderrWriter struct {
	matchID int64
	buf     *strings.Builder
	lineBuf []byte
}

func (w *stderrWriter) Write(p []byte) (int, error) {
	w.buf.Write(p)
	w.lineBuf = append(w.lineBuf, p...)
	for {
		idx := -1
		for i, b := range w.lineBuf {
			if b == '\n' {
				idx = i
				break
			}
		}
		if idx < 0 {
			break
		}
		line := string(w.lineBuf[:idx])
		w.lineBuf = w.lineBuf[idx+1:]
		log.Printf("[match %d] stderr: %s", w.matchID, line)
	}
	return len(p), nil
}

func parseRunnerOutput(out string) (winner string, scoreA, scoreB int, replayPath string) {
	// scan for the "Done" line
	lines := splitLines(out)
	for _, line := range lines {
		var w string
		var a, b int
		var rp string
		n, _ := fmt.Sscanf(line, "Done  winner=%s  alpha=%d  beta=%d  replay=%s", &w, &a, &b, &rp)
		if n == 4 {
			return w, a, b, rp
		}
	}
	return "", 0, 0, ""
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i, c := range s {
		if c == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

// ── GET /matches ──────────────────────────────────────────────────────────────

func handleListMatches(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT m.id, m.bot_a_id, m.bot_b_id, ba.name, bb.name,
		       m.seed, m.map_path, m.status, m.winner, m.score_a, m.score_b,
		       m.replay_path, m.latency_a, m.latency_b, m.started_at, m.finished_at
		FROM matches m
		JOIN bots ba ON ba.id = m.bot_a_id
		JOIN bots bb ON bb.id = m.bot_b_id
		ORDER BY m.id DESC LIMIT 100
	`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	matches := []Match{}
	for rows.Next() {
		var m Match
		rows.Scan(&m.ID, &m.BotAID, &m.BotBID, &m.BotAName, &m.BotBName,
			&m.Seed, &m.MapPath, &m.Status, &m.Winner, &m.ScoreA, &m.ScoreB,
			&m.ReplayPath, &m.LatencyA, &m.LatencyB, &m.StartedAt, &m.FinishedAt)
		matches = append(matches, m)
	}
	writeJSON(w, 200, matches)
}

// ── GET /matches/{id} ─────────────────────────────────────────────────────────

func handleGetMatch(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	var m Match
	err = db.QueryRow(`
		SELECT m.id, m.bot_a_id, m.bot_b_id, ba.name, bb.name,
		       m.seed, m.map_path, m.status, m.winner, m.score_a, m.score_b,
		       m.replay_path, m.latency_a, m.latency_b, m.started_at, m.finished_at
		FROM matches m
		JOIN bots ba ON ba.id = m.bot_a_id
		JOIN bots bb ON bb.id = m.bot_b_id
		WHERE m.id = ?
	`, id).Scan(&m.ID, &m.BotAID, &m.BotBID, &m.BotAName, &m.BotBName,
		&m.Seed, &m.MapPath, &m.Status, &m.Winner, &m.ScoreA, &m.ScoreB,
		&m.ReplayPath, &m.LatencyA, &m.LatencyB, &m.StartedAt, &m.FinishedAt)
	if err == sql.ErrNoRows {
		writeErr(w, 404, "match not found")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, m)
}

// ── DELETE /matches/{id} ─────────────────────────────────────────────────────

func handleDeleteMatch(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	res, err := db.Exec(`DELETE FROM matches WHERE id = ?`, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeErr(w, 404, "match not found")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

// ── DELETE /matches (clear all) ─────────────────────────────────────────────

func handleClearMatches(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	res, err := db.Exec(`DELETE FROM matches`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	writeJSON(w, 200, map[string]any{"status": "cleared", "deleted": n})
}

// ── GET /maps ─────────────────────────────────────────────────────────────────

type MapInfo struct {
	Path        string `json:"path"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

func mapsDir() string {
	if dir := os.Getenv("ARENA_MAPS_DIR"); dir != "" {
		return dir
	}
	// fallback: walk up from cwd to find maps/
	cwd, _ := os.Getwd()
	for _, candidate := range []string{
		filepath.Join(cwd, "maps"),
		filepath.Join(cwd, "..", "maps"),
		filepath.Join(cwd, "..", "..", "maps"),
	} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return "maps"
}

func handleListMaps(w http.ResponseWriter, r *http.Request) {
	mapsDir := mapsDir()
	entries, err := os.ReadDir(mapsDir)
	if err != nil {
		writeJSON(w, 200, []MapInfo{})
		return
	}
	maps := []MapInfo{}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		path := filepath.Join(mapsDir, e.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var v struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		json.Unmarshal(data, &v)
		maps = append(maps, MapInfo{Path: filepath.Join("maps", e.Name()), Name: v.Name, Description: v.Description})
	}
	writeJSON(w, 200, maps)
}

// ── GET /maps/{name} ─────────────────────────────────────────────────────────

func handleGetMap(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	path := filepath.Join(mapsDir(), name)
	// safety: prevent path traversal
	if filepath.Dir(path) != mapsDir() {
		writeErr(w, 400, "invalid map name")
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		writeErr(w, 404, "map not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	w.Write(data)
}

// ── GET /rankings ─────────────────────────────────────────────────────────────

type Ranking struct {
	BotID    int64   `json:"bot_id"`
	BotName  string  `json:"bot_name"`
	Owner    string  `json:"owner"`
	Wins     int     `json:"wins"`
	Losses   int     `json:"losses"`
	Draws    int     `json:"draws"`
	Total    int     `json:"total"`
	WinRate  float64 `json:"win_rate"`
	AvgScore float64 `json:"avg_score"`
}

func handleRankings(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT b.id, b.name, b.owner,
			SUM(CASE
				WHEN (m.bot_a_id = b.id AND m.winner = 'Alpha') OR (m.bot_b_id = b.id AND m.winner = 'Beta') THEN 1
				ELSE 0 END) AS wins,
			SUM(CASE
				WHEN (m.bot_a_id = b.id AND m.winner = 'Beta') OR (m.bot_b_id = b.id AND m.winner = 'Alpha') THEN 1
				ELSE 0 END) AS losses,
			SUM(CASE WHEN m.winner IS NULL AND m.status = 'done' THEN 1 ELSE 0 END) AS draws,
			COUNT(CASE WHEN m.status = 'done' THEN 1 END) AS total,
			AVG(CASE WHEN m.bot_a_id = b.id THEN m.score_a
			         WHEN m.bot_b_id = b.id THEN m.score_b END) AS avg_score
		FROM bots b
		LEFT JOIN matches m ON (m.bot_a_id = b.id OR m.bot_b_id = b.id) AND m.status = 'done'
		GROUP BY b.id
		ORDER BY wins DESC, avg_score DESC
	`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	rankings := []Ranking{}
	for rows.Next() {
		var rk Ranking
		var avgScore sql.NullFloat64
		rows.Scan(&rk.BotID, &rk.BotName, &rk.Owner,
			&rk.Wins, &rk.Losses, &rk.Draws, &rk.Total, &avgScore)
		if avgScore.Valid {
			rk.AvgScore = avgScore.Float64
		}
		if rk.Total > 0 {
			rk.WinRate = float64(rk.Wins) / float64(rk.Total)
		}
		rankings = append(rankings, rk)
	}
	writeJSON(w, 200, rankings)
}

// ── GET /replays ─────────────────────────────────────────────────────────────

func replaysDir() string {
	return filepath.Join(dataDir, "artifacts", "replays")
}

func handleListReplays(w http.ResponseWriter, r *http.Request) {
	dir := replaysDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		writeJSON(w, 200, []string{})
		return
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	writeJSON(w, 200, names)
}

// ── GET /replays/{name} ──────────────────────────────────────────────────────

func handleGetReplay(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	// security: prevent path traversal
	if strings.Contains(name, "/") || strings.Contains(name, "..") {
		writeErr(w, 400, "invalid name")
		return
	}

	dir := replaysDir()
	// if name is just a seed number, find matching file
	if !strings.HasSuffix(name, ".json") {
		entries, err := os.ReadDir(dir)
		if err != nil {
			writeErr(w, 404, "replay not found")
			return
		}
		prefix := "match-" + name
		var found string
		for i := len(entries) - 1; i >= 0; i-- {
			e := entries[i]
			if strings.HasPrefix(e.Name(), prefix) && strings.HasSuffix(e.Name(), ".json") {
				found = e.Name()
				break
			}
		}
		if found == "" {
			writeErr(w, 404, "replay not found for seed "+name)
			return
		}
		name = found
	}

	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		writeErr(w, 404, "replay not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	w.Write(data)
}

// ── GET /matches/{id}/live (SSE) ─────────────────────────────────────────────

func handleMatchLive(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, 500, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	live := getLive(id)
	ch, unsub := live.subscribe()
	defer unsub()

	// if match already done, send final state and close
	ctx := r.Context()

	for {
		select {
		case <-ctx.Done():
			return
		case p, ok := <-ch:
			if !ok {
				// match finished
				fmt.Fprintf(w, "data: {\"done\":true}\n\n")
				flusher.Flush()
				return
			}
			data, _ := json.Marshal(p)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}
