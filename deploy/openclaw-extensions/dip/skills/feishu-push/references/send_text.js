#!/usr/bin/env node

/**
 * Feishu Push Message - Text Message Helper
 *
 * Usage:
 *   node send_text.js <user_id> <message>
 */

const TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const MESSAGE_URL = "https://open.feishu.cn/open-apis/im/v1/messages";

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Feishu returned non-JSON response (${response.status}): ${text}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function getTenantAccessToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      "FEISHU_APP_ID and FEISHU_APP_SECRET environment variables must be set.\n" +
        "Please set them before running this script.",
    );
  }

  const data = await postJson(TOKEN_URL, {
    app_id: appId,
    app_secret: appSecret,
  });

  if (data.code !== 0) {
    throw new Error(`Failed to get access token: [${data.code}] ${data.msg}`);
  }

  return data.tenant_access_token;
}

async function sendMessage({
  userId,
  content,
  msgType = "text",
}) {
  const token = await getTenantAccessToken();
  const url = `${MESSAGE_URL}?receive_id_type=user_id`;
  const messageContent = msgType === "text" ? JSON.stringify({ text: content }) : content;

  return postJson(
    url,
    {
      receive_id: userId,
      msg_type: msgType,
      content: messageContent,
    },
    {
      Authorization: `Bearer ${token}`,
    },
  );
}

function printUsage() {
  console.log(`Feishu Push Message - Text Message Helper

Usage:
  node send_text.js <user_id> <message>

Examples:
  node send_text.js 7g9f6e2d "Hello World!"`);
}

async function main() {
  const [, , userId, message] = process.argv;

  if (!userId || !message) {
    printUsage();
    console.error(`\nArguments received: ${Math.max(process.argv.length - 2, 0)}, expected at least 2`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await sendMessage({
      userId,
      content: message,
      msgType: "text",
    });

    console.log(JSON.stringify(result, null, 2));

    if (result.code === 0) {
      console.log(`\nMessage sent successfully. Message ID: ${result.data?.message_id ?? "unknown"}`);
    } else {
      console.error(`\nMessage failed: [${result.code}] ${result.msg}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

main();
