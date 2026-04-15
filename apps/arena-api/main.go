package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"path/filepath"
	"strconv"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./arena.db")
	if err != nil {
		log.Fatal(err)
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
	mux.HandleFunc("GET /rankings", handleRankings)
	mux.HandleFunc("GET /maps", handleListMaps)

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
		writeErr(w, 400, "name and url are required")
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	res, err := db.Exec(`INSERT INTO bots (name, url, owner) VALUES (?, ?, ?)`, req.Name, req.URL, req.Owner)
	if err != nil {
		writeErr(w, 409, "bot name already exists or db error: "+err.Error())
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, 201, map[string]any{"id": id, "name": req.Name})
}

// ── DELETE /bots/{id} ────────────────────────────────────────────────────────

func handleDeleteBot(w http.ResponseWriter, r *http.Request) {
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
		writeErr(w, 400, "invalid request")
		return
	}

	var botAURL, botBURL string
	err := db.QueryRow(`SELECT url FROM bots WHERE id = ?`, req.BotAID).Scan(&botAURL)
	if err != nil {
		writeErr(w, 404, "bot_a not found")
		return
	}
	err = db.QueryRow(`SELECT url FROM bots WHERE id = ?`, req.BotBID).Scan(&botBURL)
	if err != nil {
		writeErr(w, 404, "bot_b not found")
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
		`INSERT INTO matches (bot_a_id, bot_b_id, seed, map_path, status) VALUES (?, ?, ?, ?, 'running')`,
		req.BotAID, req.BotBID, seed, mapPathPtr,
	)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	matchID, _ := res.LastInsertId()

	go runMatch(matchID, botAURL, botBURL, seed, req.MapPath)

	writeJSON(w, 202, map[string]any{"id": matchID, "seed": seed, "status": "running"})
}

func runMatch(matchID int64, botAURL, botBURL string, seed int64, mapPath string) {
	// find http-match binary relative to this process
	exe, err := os.Executable()
	if err != nil {
		exe = "."
	}
	// look for http-match next to this binary first, then cwd, then PATH
	runnerPath := filepath.Join(filepath.Dir(exe), "http-match")
	if _, err := os.Stat(runnerPath); err != nil {
		runnerPath = "./http-match"
	}
	if _, err := os.Stat(runnerPath); err != nil {
		runnerPath = "http-match"
	}

	args := []string{botAURL, botBURL, strconv.FormatInt(seed, 10)}
	if mapPath != "" {
		args = append(args, "--map", mapPath)
	}
	cmd := exec.Command(runnerPath, args...)
	out, err := cmd.CombinedOutput()
	log.Printf("[match %d] runner output:\n%s", matchID, string(out))

	if err != nil {
		db.Exec(`UPDATE matches SET status='error', finished_at=CURRENT_TIMESTAMP WHERE id=?`, matchID)
		return
	}

	// parse last line: "Done  winner=Alpha  alpha=1234  beta=987  replay=..."
	winner, scoreA, scoreB, replayPath := parseRunnerOutput(string(out))
	db.Exec(
		`UPDATE matches SET status='done', winner=?, score_a=?, score_b=?, replay_path=?, finished_at=CURRENT_TIMESTAMP WHERE id=?`,
		winner, scoreA, scoreB, replayPath, matchID,
	)
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
		       m.replay_path, m.started_at, m.finished_at
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
			&m.ReplayPath, &m.StartedAt, &m.FinishedAt)
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
		       m.replay_path, m.started_at, m.finished_at
		FROM matches m
		JOIN bots ba ON ba.id = m.bot_a_id
		JOIN bots bb ON bb.id = m.bot_b_id
		WHERE m.id = ?
	`, id).Scan(&m.ID, &m.BotAID, &m.BotBID, &m.BotAName, &m.BotBName,
		&m.Seed, &m.MapPath, &m.Status, &m.Winner, &m.ScoreA, &m.ScoreB,
		&m.ReplayPath, &m.StartedAt, &m.FinishedAt)
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
