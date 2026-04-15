#!/bin/bash
# Mock test script for arena-api endpoints
# Usage: ./scripts/test-api.sh [base_url]

BASE=${1:-"http://localhost:9090"}
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

check() {
  local name="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    green "PASS: $name"
    PASS=$((PASS+1))
  else
    red "FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL+1))
  fi
}

check_status() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    green "PASS: $name (HTTP $actual)"
    PASS=$((PASS+1))
  else
    red "FAIL: $name (expected HTTP $expected, got HTTP $actual)"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Arena API Test Suite ==="
echo "Target: $BASE"
echo ""

# 1. GET /bots (empty)
echo "--- Bots ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/bots")
check_status "GET /bots returns 200" "200" "$STATUS"

# 2. Register bot A
BODY=$(curl -s -w "\n%{http_code}" -X POST "$BASE/bots" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-bot-alpha","url":"http://fake:8080","owner":"tester"}')
STATUS=$(echo "$BODY" | tail -1)
RESP=$(echo "$BODY" | head -1)
check_status "POST /bots register bot A returns 201" "201" "$STATUS"
BOT_A_ID=$(echo "$RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
check "Bot A has id" '"id":' "$RESP"

# 3. Register bot B
BODY=$(curl -s -w "\n%{http_code}" -X POST "$BASE/bots" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-bot-beta","url":"http://fake:8081","owner":"tester"}')
STATUS=$(echo "$BODY" | tail -1)
RESP=$(echo "$BODY" | head -1)
check_status "POST /bots register bot B returns 201" "201" "$STATUS"
BOT_B_ID=$(echo "$RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

# 4. List bots
BODY=$(curl -s "$BASE/bots")
check "GET /bots contains bot A" "test-bot-alpha" "$BODY"
check "GET /bots contains bot B" "test-bot-beta" "$BODY"

# 5. Duplicate bot name
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/bots" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-bot-alpha","url":"http://dup:8080","owner":"dup"}')
check_status "POST /bots duplicate name returns 409" "409" "$STATUS"

# 6. Start a match
echo ""
echo "--- Matches ---"
BODY=$(curl -s -w "\n%{http_code}" -X POST "$BASE/matches" \
  -H "Content-Type: application/json" \
  -d "{\"bot_a_id\":$BOT_A_ID,\"bot_b_id\":$BOT_B_ID,\"seed\":9999}")
STATUS=$(echo "$BODY" | tail -1)
RESP=$(echo "$BODY" | head -1)
check_status "POST /matches start match returns 202" "202" "$STATUS"
check "Match has status running" '"status":"running"' "$RESP"
MATCH_ID=$(echo "$RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

# 7. List matches
sleep 1
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/matches")
check_status "GET /matches returns 200" "200" "$STATUS"

# 8. Get single match
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/matches/$MATCH_ID")
check_status "GET /matches/$MATCH_ID returns 200" "200" "$STATUS"

# 9. Delete single match
BODY=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/matches/$MATCH_ID")
STATUS=$(echo "$BODY" | tail -1)
RESP=$(echo "$BODY" | head -1)
check_status "DELETE /matches/$MATCH_ID returns 200" "200" "$STATUS"
check "Delete match response" '"status":"deleted"' "$RESP"

# 10. Delete non-existent match
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/matches/99999")
check_status "DELETE /matches/99999 returns 404" "404" "$STATUS"

# 11. Start another match then clear all
curl -s -X POST "$BASE/matches" \
  -H "Content-Type: application/json" \
  -d "{\"bot_a_id\":$BOT_A_ID,\"bot_b_id\":$BOT_B_ID,\"seed\":1111}" > /dev/null
curl -s -X POST "$BASE/matches" \
  -H "Content-Type: application/json" \
  -d "{\"bot_a_id\":$BOT_A_ID,\"bot_b_id\":$BOT_B_ID,\"seed\":2222}" > /dev/null

BODY=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/matches")
STATUS=$(echo "$BODY" | tail -1)
RESP=$(echo "$BODY" | head -1)
check_status "DELETE /matches (clear all) returns 200" "200" "$STATUS"
check "Clear matches response" '"status":"cleared"' "$RESP"

# 12. Maps
echo ""
echo "--- Maps ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/maps")
check_status "GET /maps returns 200" "200" "$STATUS"

# 13. Rankings
echo ""
echo "--- Rankings ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/rankings")
check_status "GET /rankings returns 200" "200" "$STATUS"

# Cleanup: delete test bots
echo ""
echo "--- Cleanup ---"
curl -s -X DELETE "$BASE/bots/$BOT_A_ID" > /dev/null
curl -s -X DELETE "$BASE/bots/$BOT_B_ID" > /dev/null
green "Cleaned up test bots"

# Summary
echo ""
echo "==========================="
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -eq 0 ]; then
  green "ALL TESTS PASSED"
else
  red "SOME TESTS FAILED"
  exit 1
fi
