---
name: feishu-push
description: >-
  向飞书指定用户（通过 user_id）推送消息。
  支持文本、卡片、图片、文件等多种消息类型。当用户需要给飞书用户发送推送消息时自动使用。
allowed-tools: Bash(curl *), node(*)
argument-hint: <user_id> <message-content> [msg_type]
---

# Feishu Push Message Skill

通过飞书开放平台 API 向指定飞书用户推送消息。

## 前提条件

1. 需要已经创建飞书自定义应用，并启用机器人能力
2. 应用已获取 `im:message`（或 `im:message:send_as_bot`）权限
3. 目标用户需要在应用的可用范围内
4. 需要配置以下环境变量或凭据：
   - `FEISHU_APP_ID`: 飞书应用 App ID (如 `cli_a94a1d897cb85cbb`)
   - `FEISHU_APP_SECRET`: 飞书应用 App Secret

## API 端点

```
POST https://open.feishu.cn/open-apis/im/v1/messages
```

## 使用方式

### 命令行方式（curl）

```bash
# 获取 tenant_access_token
TOKEN=$(curl -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"app_id\":\"$FEISHU_APP_ID\",\"app_secret\":\"$FEISHU_APP_SECRET\"}" | \
  node -e "let s=''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => console.log(JSON.parse(s).tenant_access_token));")

# 发送文本消息
curl --request POST "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=user_id" \
  --header "Authorization: Bearer $TOKEN" \
  --header "Content-Type: application/json; charset=utf-8" \
  --data-raw '{
    "receive_id": "<USER_ID>",
    "msg_type": "text",
    "content": "{\"text\":\"你的消息内容\"}"
  }'
```

### 接收者 ID 类型

当前技能只接收飞书租户内用户 ID，即 `receive_id_type=user_id`。调用时传入的第一个参数必须是 `user_id`。

### 支持的消息类型

| msg_type | 说明 |
|----------|------|
| `text` | 文本消息 |
| `post` | 富文本消息 |
| `image` | 图片消息（需要先上传图片获取 key）|
| `file` | 文件消息（需要先上传文件获取 key）|
| `audio` | 音频消息 |
| `media` | 视频消息 |
| `sticker` | 表情 |
| `interactive` | 互动卡片 |
| `share_chat` | 分享群名片 |
| `share_user` | 分享个人名片 |
| `system` | 系统消息（仅单会话有效）|

## 示例

### 发送文本消息给指定 user_id 用户

```bash
# 用法: feishu-push text <user_id> "你的消息内容"
```

### 环境变量配置

推荐在环境中配置应用凭证：
```bash
export FEISHU_APP_ID="cli_a94a1d897cb85cbb"
export FEISHU_APP_SECRET="your_app_secret_here"
```

## 错误处理

常见错误码及处理：

- `230013`: Bot 对该用户无可用权限 → 将用户添加到应用可用范围
- `230006`: 未启用机器人能力 → 在飞书开发者后台启用 bot 能力
- `230029`: 用户已离职 → 无法发送给已离职用户
- `230053`: 用户停止接收机器人消息 → 用户需要取消拉黑

## NodeJS 示例

```js
const tokenUrl = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const messageUrl = "https://open.feishu.cn/open-apis/im/v1/messages";

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function getTenantAccessToken() {
  const data = await postJson(tokenUrl, {
    app_id: process.env.FEISHU_APP_ID,
    app_secret: process.env.FEISHU_APP_SECRET,
  });

  if (data.code !== 0) {
    throw new Error(`Failed to get token: ${data.msg}`);
  }

  return data.tenant_access_token;
}

async function sendTextMessage(userId, content) {
  const token = await getTenantAccessToken();

  return postJson(
    `${messageUrl}?receive_id_type=user_id`,
    {
      receive_id: userId,
      msg_type: "text",
      content: JSON.stringify({ text: content }),
    },
    {
      Authorization: `Bearer ${token}`,
    },
  );
}

const [, , userId, message] = process.argv;
if (userId && message) {
  const result = await sendTextMessage(userId, message);
  console.log(JSON.stringify(result, null, 2));
}
```

## 调用示例

```
/feishu-push 给用户 7g9f6e2d 发送文本消息 "Hello from OpenClaw!"
/feishu-push send user_id 7g9f6e2d "这是一条测试推送消息"
```
