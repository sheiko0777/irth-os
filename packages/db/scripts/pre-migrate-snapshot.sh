#!/usr/bin/env bash
# Snapshot the Neon production branch right before migrations run.
#
# Replaces a Neon branch named $1 (e.g. pre-migrate-api) with a fresh
# copy-on-write child of the default branch: instant, no compute attached, and
# holds the database exactly as it was before this deploy's migrations. The
# free plan keeps only 6h of point-in-time history, so this is the restore
# point for anything noticed later. See docs/db/RESTORE.md.
#
# Missing NEON_API_KEY / NEON_PROJECT_ID -> warning, continue (a repo without
# them configured must still deploy). Any API failure once configured -> exit 1,
# so migrations never run without a restore point.
set -euo pipefail

NAME="${1:?usage: pre-migrate-snapshot.sh <branch-name>}"

if [ -z "${NEON_API_KEY:-}" ] || [ -z "${NEON_PROJECT_ID:-}" ]; then
  echo "::warning title=No pre-migrate snapshot::NEON_API_KEY secret or NEON_PROJECT_ID variable not set; migrating without a restore point."
  exit 0
fi

API="https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}"
AUTH=(-H "Authorization: Bearer ${NEON_API_KEY}" -H "Accept: application/json")

branches=$(curl -fsS "${AUTH[@]}" "${API}/branches")
parent=$(echo "$branches" | jq -r '.branches[] | select(.default == true) | .id')
old=$(echo "$branches" | jq -r --arg n "$NAME" '.branches[] | select(.name == $n) | .id')

if [ -z "$parent" ]; then
  echo "::error::No default branch found in Neon project ${NEON_PROJECT_ID}"
  exit 1
fi

if [ -n "$old" ]; then
  curl -fsS -X DELETE "${AUTH[@]}" "${API}/branches/${old}" > /dev/null
  # Branch deletion is async; creation of the same name fails until it's gone.
  for _ in $(seq 1 30); do
    curl -fsS "${AUTH[@]}" "${API}/branches" | jq -e --arg n "$NAME" 'any(.branches[]; .name == $n)' > /dev/null || break
    sleep 2
  done
fi

created=$(curl -fsS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"branch\":{\"name\":\"${NAME}\",\"parent_id\":\"${parent}\"}}" \
  "${API}/branches")
echo "Snapshot branch ${NAME} = $(echo "$created" | jq -r '.branch.id') (parent ${parent}, $(date -u +%FT%TZ))"
