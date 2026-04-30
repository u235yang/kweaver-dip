#!/bin/bash
# Feishu Push Text Message - Bash Helper
# Usage: ./send_text.sh <receive_id> <message> [receive_id_type]
# Default receive_id_type: open_id

set -e

if [ -z "$FEISHU_APP_ID" ] || [ -z "$FEISHU_APP_SECRET" ]; then
    echo "❌ Error: FEISHU_APP_ID and FEISHU_APP_SECRET environment variables must be set"
    exit 1
fi

if [ $# -lt 2 ]; then
    cat << 'EOF'
Feishu Push Text Message

Usage:
  ./send_text.sh <receive_id> <message> [receive_id_type]

Arguments:
  receive_id      - Target user/chat ID (required)
  message         - Text content to send (required, quote your message!)
  receive_id_type - ID type: open_id|union_id|user_id|email|chat_id (default: open_id)

Example:
  ./send_text.sh ou_7999079c3251552c855725a3fd3a1deb "Hello from OpenClaw!"
  ./send_text.sh oc_123456 "Hello group chat" chat_id
EOF
    exit 1
fi

RECEIVE_ID="$1"
MESSAGE="$2"
RECEIVE_ID_TYPE="${3:-open_id}"

# Get access token
echo "🔑 Getting access token..."
TOKEN_RESPONSE=$(curl -s -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"app_id\":\"$FEISHU_APP_ID\",\"app_secret\":\"$FEISHU_APP_SECRET\"}")

CODE=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('code', -1))")

if [ "$CODE" != "0" ]; then
    MSG=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('msg', 'Unknown error'))")
    echo "❌ Failed to get access token: [$CODE] $MSG"
    exit 1
fi

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['tenant_access_token'])")

# Prepare JSON escaped content
JSON_CONTENT=$(python3 -c "import json; print(json.dumps({'text': '''$MESSAGE'''}))" | python3 -c "import json, sys; print(json.dumps(json.load(sys.stdin)))")

# Send message
echo "📤 Sending message..."
curl -s --request POST "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=$RECEIVE_ID_TYPE" \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json; charset=utf-8" \
  --data-raw "{
    \"receive_id\": \"$RECEIVE_ID\",
    \"msg_type\": \"text\",
    \"content\": $JSON_CONTENT
  }" | python3 -m json.tool

echo
