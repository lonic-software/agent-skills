#!/bin/bash
# Prints a test run's output file: in full when short, otherwise only the
# failure blocks and summary lines, capped. Used by filter-test-output.sh.
f="$1"
n=$(wc -l < "$f" | tr -d ' ')
if (( n <= 80 )); then cat "$f"; exit 0; fi

grep -E -A6 '(FAIL|✗|×|AssertionError|Error:|error:|expected|Expected|Received|panicked|--- FAIL)' "$f" | head -150
echo '...'
grep -E '(Test Files|Tests[[:space:]]|Suites?:|passed|failed|Duration|^ok |^FAIL|=+ .*(passed|failed))' "$f" | tail -15
echo "[filter-test-output hook: showed failures + summary of $n lines; rerun with FULL_TEST_OUTPUT=1 for everything]"
