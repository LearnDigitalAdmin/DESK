#!/usr/bin/env bash
# Deploy the WhatsApp bot functions (codebase `default`, folder functions/) in small batches, the way PAY's
# deploy-batches.sh does: retries with a growing cool-down, and a cool-down between batches.
#
# Run from the DESK repo root (the folder containing firebase.json), in Git Bash:
#   bash deploy-lmmx.sh                      deploy the one function this change touched: whatsappWebhook
#   bash deploy-lmmx.sh whatsappWebhook      the same, named explicitly
#   bash deploy-lmmx.sh fnA fnB fnC fnD      any other `default` functions, batched (3 per deploy)
#
# Only `whatsappWebhook` changed (all of the bot lives behind it), so a plain `bash deploy-lmmx.sh` is the normal use.
# functions-desk/ (codebase `desk`) is NOT touched here.
#
# Options (environment variables):
#   BATCH_SIZE=3         functions per deploy
#   RETRIES=3            attempts per batch
#   PAUSE=30             seconds to cool down between batches
#   RETRY_PAUSE=60       seconds before the first retry (doubles on each further retry)
#   PROJECT=plot-9fd6e   Firebase project (default: whatever .firebaserc says)
#   CODEBASE=default     functions codebase in firebase.json
#   DRY_RUN=1            print the batches and exit without deploying

set -u

BATCH_SIZE="${BATCH_SIZE:-6}"
RETRIES="${RETRIES:-3}"
PAUSE="${PAUSE:-30}"
RETRY_PAUSE="${RETRY_PAUSE:-60}"
PROJECT="${PROJECT:-}"
CODEBASE="${CODEBASE:-desk}"

# More heap for the CLI and a longer code-analysis timeout (the "Cannot determine backend specification" error)
export NODE_OPTIONS="--max-old-space-size=4096"
export FUNCTIONS_DISCOVERY_TIMEOUT="${FUNCTIONS_DISCOVERY_TIMEOUT:-120}"

PROJECT_ARGS=()
[ -n "$PROJECT" ] && PROJECT_ARGS=(--project "$PROJECT")

if [ "$#" -gt 0 ]; then
  FUNCS=("$@")
else
  FUNCS=(whatsappWebhook)
fi

total=${#FUNCS[@]}
batches=$(( (total + BATCH_SIZE - 1) / BATCH_SIZE ))
echo "Deploying $total function(s) from codebase '$CODEBASE' in $batches batch(es) of up to $BATCH_SIZE"
echo "Retries per batch: $RETRIES | cool-down between batches: ${PAUSE}s | first retry wait: ${RETRY_PAUSE}s (doubles)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  i=0; n=0
  while [ "$i" -lt "$total" ]; do
    n=$((n + 1))
    echo "  Batch $n: ${FUNCS[*]:$i:$BATCH_SIZE}"
    i=$((i + BATCH_SIZE))
  done
  exit 0
fi

failed=()
succeeded=0
i=0
batch_no=0
while [ "$i" -lt "$total" ]; do
  batch=("${FUNCS[@]:$i:$BATCH_SIZE}")
  batch_no=$((batch_no + 1))
  only=$(printf "functions:${CODEBASE}:%s," "${batch[@]}")
  only="${only%,}"

  echo
  echo "=== Batch $batch_no/$batches: ${batch[*]} ==="

  ok=0
  attempt=1
  wait_s="$RETRY_PAUSE"
  while [ "$attempt" -le "$RETRIES" ]; do
    if firebase deploy --only "$only" --non-interactive "${PROJECT_ARGS[@]}"; then
      ok=1
      break
    fi
    echo "Batch $batch_no failed (attempt $attempt/$RETRIES)."
    attempt=$((attempt + 1))
    if [ "$attempt" -le "$RETRIES" ]; then
      echo "Cooling down ${wait_s}s before retry..."
      sleep "$wait_s"
      wait_s=$((wait_s * 2))
    fi
  done

  if [ "$ok" -eq 1 ]; then
    succeeded=$((succeeded + ${#batch[@]}))
  else
    failed+=("${batch[@]}")
  fi

  i=$((i + BATCH_SIZE))
  if [ "$i" -lt "$total" ]; then
    echo "Cooling down ${PAUSE}s before the next batch..."
    sleep "$PAUSE"
  fi
done

echo
echo "Deployed $succeeded of $total function(s)."
if [ "${#failed[@]}" -eq 0 ]; then
  echo "All batches deployed."
else
  echo "These functions failed:"
  printf '  %s\n' "${failed[@]}"
  echo
  echo "Re-run just those with:"
  echo "  bash deploy-lmmx.sh ${failed[*]}"
  exit 1
fi
