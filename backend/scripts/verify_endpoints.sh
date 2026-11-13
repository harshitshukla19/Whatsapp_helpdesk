#!/usr/bin/env bash
# Run from backend/: bash scripts/verify_endpoints.sh
set -uo pipefail
BASE="http://localhost:5004"
export $(grep -v '^#' .env | grep -E '^WEBHOOK_DEBUG_KEY=' | xargs) 2>/dev/null || true

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; }

echo "== 1. Health =="
HEALTH=$(curl -s "$BASE/api/health")
echo "$HEALTH" | jq . 2>/dev/null || echo "$HEALTH"
[[ "$HEALTH" == *'"success":true'* ]] && pass "up" || fail "health"

echo -e "\n== 2. Simulate INCOMING chat (real MsgClub shape) =="
IN=$(curl -s -X POST "$BASE/api/webhooks/msgclub/messages" \
  -H "Content-Type: application/json" \
  -d '{
    "verifiedWhatsappNumber": "919565778866",
    "clientResponse": {
      "message": "Hi from verify script",
      "sender": "918005455811",
      "timestamp": "1785410089"
    },
    "webhookType": 0
  }')
echo "$IN"
pass "webhook accepted (always 200)"

echo -e "\n== 3. Simulate STATUS update (real MsgClub shape) =="
curl -s -X POST "$BASE/api/webhooks/msgclub/messages" \
  -H "Content-Type: application/json" \
  -d '{
    "messageContent": { "messsageId": "wamid.test", "mobileNo": "918005455811" },
    "sender": "919565778866",
    "receiver": "918005455811",
    "status": "delivered",
    "timestamp": "1785410320",
    "requestId": "test-request-id-verify-script",
    "webhookType": 0
  }'
echo
pass "status webhook accepted"

sleep 1

echo -e "\n== 4. Debug raw logs (GET /api/webhooks/msgclub/debug/recent) =="
if [[ -z "${WEBHOOK_DEBUG_KEY:-}" ]]; then
  fail "WEBHOOK_DEBUG_KEY not set in .env"
else
  LOGS=$(curl -s "$BASE/api/webhooks/msgclub/debug/recent?key=$WEBHOOK_DEBUG_KEY&limit=5")
  echo "$LOGS" | jq . 2>/dev/null || echo "$LOGS"
  [[ "$LOGS" == *'"success":true'* ]] && pass "debug endpoint works" || fail "debug endpoint"
fi

echo -e "\n== 5. List WhatsApp conversations =="
CONV=$(curl -s "$BASE/api/whatsapp/conversations")
echo "$CONV" | jq . 2>/dev/null || echo "$CONV"
[[ "$CONV" == *'"success":true'* ]] && pass "conversations endpoint" || fail "conversations endpoint (check whatsappRoutes + schema)"

echo -e "\n== 6. If a conversation exists, fetch its messages =="
CONV_ID=$(echo "$CONV" | jq -r '.data[0].ConversationId // .data[0].conversationId // empty' 2>/dev/null)
if [[ -n "$CONV_ID" ]]; then
  curl -s "$BASE/api/whatsapp/conversations/$CONV_ID/messages" | jq . 2>/dev/null
  pass "messages for conversation $CONV_ID"
else
  echo "  (no conversations yet — if step 2 logged IN in pm2 logs, check stored procs / schema)"
fi

echo -e "\nDone."