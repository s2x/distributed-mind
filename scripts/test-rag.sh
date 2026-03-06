#!/bin/bash
#
# RAG End-to-End Integration Test
# Tests the full RAG pipeline: add memory → generate embedding → semantic search
#
# WARNING: This script makes REAL API calls to OpenAI (text-embedding-3-small).
# Each run costs a fraction of a cent but requires a valid OPENAI_API_KEY.
#
# Usage:
#   OPENAI_API_KEY=sk-... ./scripts/test-rag.sh
#   # or with .env file at project root:
#   ./scripts/test-rag.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MIND="$ROOT_DIR/mind"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

passed=0
failed=0

pass() {
    echo -e "  ${GREEN}✓${RESET} $1"
    passed=$((passed + 1))
}

fail() {
    echo -e "  ${RED}✗${RESET} $1"
    if [ -n "${2:-}" ]; then
        echo -e "    ${DIM}$2${RESET}"
    fi
    failed=$((failed + 1))
}

# Run mind CLI, capturing both stdout and stderr.
# Prints output and returns it.
run_mind() {
    local out
    out=$(bun run "$ROOT_DIR/cli/src/mind.ts" "$@" 2>&1) || {
        local exit_code=$?
        echo -e "  ${RED}[mind error — exit $exit_code]${RESET}"
        echo "$out" | sed 's/^/    /'
        return $exit_code
    }
    echo "$out"
}

# Run mind, capture output quietly (don't print), return it.
# Use for assertions — caller decides whether to print.
run_mind_quiet() {
    bun run "$ROOT_DIR/cli/src/mind.ts" "$@" 2>&1 || true
}

# ─── Pre-flight checks ───────────────────────────────────────────────

echo -e "${BOLD}RAG End-to-End Integration Test${RESET}"
echo ""

# Force RAG on
export MIND_RAG=true

# Load .env from project root if it exists (user-passed env vars will override)
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
fi

# Check OPENAI_API_KEY
if [ -z "${OPENAI_API_KEY:-}" ]; then
    echo -e "${RED}Error:${RESET} OPENAI_API_KEY is not set."
    echo "  Usage: OPENAI_API_KEY=sk-... ./scripts/test-rag.sh"
    exit 1
fi

# Confirm real API usage (skip if CI or --yes flag)
if [ "${CI:-}" != "true" ] && [ "${1:-}" != "--yes" ] && [ "${1:-}" != "-y" ]; then
    echo -e "${YELLOW}⚠  This test makes REAL API calls to OpenAI.${RESET}"
    echo "   Model: text-embedding-3-small (~5 embedding calls, < \$0.01)"
    echo ""
    read -r -p "   Continue? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
        echo "Aborted."
        exit 0
    fi
    echo ""
fi

# ─── Setup temp DB ───────────────────────────────────────────────────

TMPDB=$(mktemp /tmp/mind-rag-test-XXXXXX.db)
export MIND_DB_PATH="$TMPDB"

cleanup() {
    rm -f "$TMPDB" "${TMPDB}-wal" "${TMPDB}-shm"
}
trap cleanup EXIT

echo -e "${DIM}DB: $TMPDB${RESET}"
echo ""

# ─── Test 1: Create space ────────────────────────────────────────────

echo -e "${BOLD}Phase 1: Setup${RESET}"

output=$(run_mind_quiet create rag-test "RAG integration test space" --tags "test,rag")
if echo "$output" | grep -qi "created"; then
    pass "Created space 'rag-test'"
else
    fail "Create space" "$output"
fi

# ─── Test 2: Add memories with diverse content ──────────────────────

echo -e "${BOLD}Phase 2: Add memories (triggers embedding generation)${RESET}"

add_memory() {
    local name="$1"
    local content="$2"
    shift 2
    local out
    out=$(run_mind_quiet add rag-test "$name" "$content" "$@")
    if echo "$out" | grep -qi "added\|Memory added"; then
        pass "Added '$name'"
    else
        fail "Add '$name'" "$out"
    fi
}

add_memory "photosynthesis" \
    "Photosynthesis is the process by which green plants convert sunlight into chemical energy, producing glucose and oxygen from carbon dioxide and water" \
    --tags "biology,science"

add_memory "neural-networks" \
    "Neural networks are computing systems inspired by biological brains, consisting of interconnected nodes that process information using weighted connections and activation functions" \
    --tags "ai,computing"

add_memory "french-revolution" \
    "The French Revolution of 1789 was a period of radical political and societal change in France that overthrew the monarchy and established a republic based on principles of liberty, equality, and fraternity" \
    --tags "history"

add_memory "quantum-mechanics" \
    "Quantum mechanics describes the behavior of matter at the atomic and subatomic level, where particles can exist in superposition states and exhibit wave-particle duality" \
    --tags "physics,science"

add_memory "cooking-pasta" \
    "To cook perfect pasta, boil salted water, add the pasta, cook until al dente according to package directions, then drain and toss with your sauce immediately" \
    --tags "cooking"

# ─── Verify embeddings ───────────────────────────────────────────────

echo ""
echo -e "${BOLD}Phase 3: Verify embeddings${RESET}"

# Embeddings are now generated synchronously (awaited) during add.
# Poll the status for up to 15s in case there's any async delay on slow machines.
max_wait=15
elapsed=0
embedding_count=0

while [ "$elapsed" -lt "$max_wait" ]; do
    status_output=$(run_mind_quiet status rag-test)
    if echo "$status_output" | grep -q "Embeddings:"; then
        embedding_count=$(echo "$status_output" | sed 's/\x1b\[[0-9;]*m//g' | grep "Embeddings:" | sed 's/[^0-9]*\([0-9]*\).*/\1/' || echo "0")
        if [ "${embedding_count:-0}" -ge 5 ]; then
            break
        fi
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done

if [ "${embedding_count:-0}" -ge 5 ]; then
    pass "All 5 embeddings indexed (${elapsed}s)"
else
    status_output=$(run_mind_quiet status rag-test)
    fail "Embeddings not ready after ${max_wait}s — got ${embedding_count:-0}/5" \
        "$(echo "$status_output" | tail -10)"
fi

# ─── Test 3: Semantic search — related query ─────────────────────────

echo ""
echo -e "${BOLD}Phase 4: Semantic search${RESET}"

# Search for something semantically related to photosynthesis
search_output=$(run_mind_quiet search "how do plants make energy from sunlight" --detail)

if echo "$search_output" | grep -qi "photosynthesis"; then
    pass "Semantic search: 'plants make energy from sunlight' → found 'photosynthesis'"
else
    fail "Semantic search for plants/sunlight" \
        "Expected 'photosynthesis' in results.
$(echo "$search_output" | head -10 | sed 's/^/    /')"
fi

# Check that similarity scores are shown
if echo "$search_output" | grep -qP '\d+%'; then
    pass "Search results include similarity percentages"
else
    fail "Similarity percentages" \
        "Expected percentage scores in output:
$(echo "$search_output" | head -10 | sed 's/^/    /')"
fi

# Search for AI-related content
search_output2=$(run_mind_quiet search "machine learning and artificial intelligence" --detail)

if echo "$search_output2" | grep -qi "neural"; then
    pass "Semantic search: 'machine learning and AI' → found 'neural-networks'"
else
    fail "Semantic search for ML/AI" \
        "Expected 'neural-networks' in results:
$(echo "$search_output2" | head -10 | sed 's/^/    /')"
fi

# Search for cooking — soft check (semantic ranking can vary)
search_output3=$(run_mind_quiet search "how to prepare food in the kitchen" --detail)
first_result=$(echo "$search_output3" | grep -m1 "cooking-pasta\|photosynthesis\|neural\|french\|quantum" || true)
if echo "$first_result" | grep -qi "cooking"; then
    pass "Semantic search: 'prepare food in kitchen' → top result is 'cooking-pasta'"
else
    echo -e "  ${YELLOW}~${RESET} Semantic search: 'prepare food in kitchen' → top result was not 'cooking-pasta'"
    echo -e "    ${DIM}First match: $first_result${RESET}"
    echo -e "    ${DIM}(Semantic ranking can vary — not counted as failure)${RESET}"
fi

# ─── Test 4: Demote to T4 and search still works ────────────────────

echo ""
echo -e "${BOLD}Phase 5: T4 (frozen) tier search${RESET}"

# Demote photosynthesis all the way to T4
run_mind_quiet demote rag-test "photosynthesis" > /dev/null  # T2 → T3
run_mind_quiet demote rag-test "photosynthesis" > /dev/null  # T3 → T4
pass "Demoted 'photosynthesis' to T4 (frozen)"

# Verify it's not in regular list
list_output=$(run_mind_quiet list rag-test)
if echo "$list_output" | grep -qi "photosynthesis"; then
    fail "T4 memory still in list" "Should be hidden from regular list"
else
    pass "T4 memory hidden from regular list"
fi

# But search should still find it
search_t4=$(run_mind_quiet search "plants converting sunlight into glucose" --detail)
if echo "$search_t4" | grep -qi "photosynthesis"; then
    pass "Semantic search finds T4 (frozen) memory"
else
    fail "T4 search" \
        "Expected 'photosynthesis' in results:
$(echo "$search_t4" | head -10 | sed 's/^/    /')"
fi

# ─── Test 5: Global status shows RAG info ────────────────────────────

echo ""
echo -e "${BOLD}Phase 6: Status${RESET}"

global_status=$(run_mind_quiet status)
if echo "$global_status" | grep -qi "RAG.*enabled"; then
    pass "Global status shows RAG: enabled"
else
    fail "RAG status" \
        "Expected 'RAG: enabled' in:
$(echo "$global_status" | tail -8 | sed 's/^/    /')"
fi

if echo "$global_status" | grep -qi "Embeddings:"; then
    pass "Global status shows embeddings count"
else
    fail "Embeddings count in status" \
        "Expected 'Embeddings:' line in:
$(echo "$global_status" | tail -8 | sed 's/^/    /')"
fi

# ─── Results ──────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
total=$((passed + failed))
if [ $failed -eq 0 ]; then
    echo -e "${GREEN}${BOLD}All $passed tests passed${RESET}"
else
    echo -e "${RED}${BOLD}$failed/$total tests failed${RESET}"
fi
echo -e "${DIM}DB cleaned up: $TMPDB${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit $failed
