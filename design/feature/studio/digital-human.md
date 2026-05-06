# 创建新的数字员工

## 术语

**ISF**

Information Security Fabric：是 DIP 底层的数据安全模块，提供用户管理、应用账号管理、OAuth 认证、权限管控等能力。


## 业务流程

### 创建数字员工 Logic
```mermaid
sequenceDiagram
 
participant BE as Studio Backend（Express）
participant OC as OpenClaw

BE ->> BE: 1. 生成 UUID
BE ->> OC: 2. ws: agents.create
BE ->> OC: 3. 写 IDENTITY.md & SOUL.md
BE ->> OC: 4. 为 Agent 配置 Skill
BE ->> OC: 5. 配置知识
```

#### 1、生成 UUID
后端服务首先需要生成一个数字员工的 UUID

#### 2、创建 Agent
通过 OpenClaw 的 WebSocket RPC 执行 `agents.create` method。参考：@docs/references/openclaw-websocket-rpc.md。

#### 3、更新 IDENTITY.md 和 SOUL.md
通过 OpenClaw 的 WebSocket RPC 执行 `agents.files.list` method 更新 IDENTITY.md 和 SOUL.md。其中SOUL.md通过@templates/de_agent_soul.pug为模版。 参考：@docs/references/openclaw-websocket-rpc.md。

#### 4、为 Agent 配置 Skill
更新 agent 的 skills 白名单，仅允许数字员工使用白名单内的 Skills。

#### 5、配置知识（选择业务知识网络）

前提：要为数字员工配置知识，管理员先要为数字员工配置 KWeaver Token。

##### 配置 KWeaver Token

KWeaver Token 本质上是一个应用账号 Token，可以通过两种途径获得：

- 从现有应用账号列表获取 Token
- 一键创建新的应用账号并获取 Token

**1、从现有应用账号列表获取 Token**

```mermaid
sequenceDiagram

participant SW as Studio Web
participant ISF

SW ->> ISF: 获取应用账号列表
SW ->> SW: 选择应用账号
SW ->> ISF: 获取应用账号 Token 
```

**2、一键创建新的应用账号并获取 Token**

```mermaid
sequenceDiagram

participant SW as Studio Web
participant ISF

SW ->> SW: 输入 KWeaver Token 名称
SW ->> ISF: 创建应用账号
SW ->> ISF: 获取应用账号 Token
```

##### 选择业务知识网络

- 管理员使用自身的 OAuth Token 调用 KWeaver 相关接口来获取业务知识网络列表。
- 数字员工在运行时使用自己的 KWeaver Token 来读取业务知识网络相关数据。

注意：【配置知识】界面需要提醒管理：创建数字员工之后，需要前往【业务知识网络】为 KWeaver Token 配置业务知识网络的访问权限。

在已配置 KWeaver Token 的前提下，用户可以：

- 替换 KWeaver Token，替换不影响已选择的业务知识网络。
- 删除 KWeaver Token，删除后，已选择的业务知识网络将一并被移除。

##### 写入 KWeaver Token

创建数字员工时，将 KWeaver Token 值写入 `~/.openclaw/workspace/<agentId>/SECRET` 文件，内容为：`KWEAVER_TOEN={KWeaver Token}`

### 通过接口创建数字员工
提供 HTTP 接口来创建数字员工。
- endpoint: POST  /dip-studio/v1/digital-human

---

## 查询数字员工列表

### 数字员工列表 Logic
```mermaid
sequenceDiagram

participant BE as Studio Backend（Express）
participant OC as OpenClaw

BE ->> OC: 1. ws: agents.list
BE ->> OC: 2. ws: agents.files.get(IDENTITY.md)
BE ->> BE: 3. 解析 IDENTITY.md，组装列表项
```

1、获取 Agent 列表  
通过 OpenClaw 的 WebSocket RPC 执行 `agents.list` method，获取全部 agent 基础信息。

2、读取每个 Agent 的 IDENTITY.md  
通过 OpenClaw 的 WebSocket RPC 执行 `agents.files.get` method（`name=IDENTITY.md`），用于读取数字员工的名称和角色信息。

3、组装列表返回结果  
优先使用 IDENTITY.md 解析出的 `name` 和 `creature`。当文件缺失或读取失败时，回退到 OpenClaw agent 的基础字段（如 `agent.name`）。

### 通过接口查询数字员工列表
提供 HTTP 接口查询数字员工列表。
- endpoint: GET /dip-studio/v1/digital-human

---

## 查询数字员工详情

### 数字员工详情 Logic
```mermaid
sequenceDiagram

participant BE as Studio Backend（Express）
participant OC as OpenClaw

BE ->> OC: 1. ws: agents.files.get(IDENTITY.md)
BE ->> OC: 2. ws: agents.files.get(SOUL.md)
BE ->> BE: 3. 解析模板字段（name/creature/soul/bkn）
BE ->> BE: 4. 查询 Skill 绑定
BE ->> BE: 5. 读取 openclaw.json 中 channel 绑定（如存在）
```

1、读取模板文件  
通过 OpenClaw 的 WebSocket RPC 执行 `agents.files.get` method，分别读取 `IDENTITY.md` 和 `SOUL.md`。

2、解析详情字段  
后端将两个文件内容合并并解析为详情字段：`name`、`creature`、`soul`、`bkn`。

3、补充 Skill 信息  
通过 `AgentSkillsLogic.getAgentSkills` 查询当前 agent 的 skill 绑定。

4、补充 Channel 信息  
读取 OpenClaw 配置中的 `bindings/channels`，若当前 agent 存在匹配项，则补充 `channel` 信息（feishu 或 dingtalk）。

### 通过接口查询数字员工详情
提供 HTTP 接口查询单个数字员工详情。
- endpoint: GET /dip-studio/v1/digital-human/:id

---

## 编辑数字员工

### 编辑数字员工 Logic
```mermaid
sequenceDiagram

participant BE as Studio Backend（Express）
participant OC as OpenClaw

BE ->> OC: 1. ws: agents.files.get(IDENTITY.md & SOUL.md)
BE ->> BE: 2. 与 patch 合并
BE ->> OC: 3. ws: agents.files.list
BE ->> OC: 4. ws: agents.files.set(IDENTITY.md & SOUL.md)
BE ->> BE: 5. (可选) 更新 Skill
BE ->> BE: 6. (可选) 更新 Channel 绑定
```

1、读取当前模板 
通过 OpenClaw 的 WebSocket RPC 执行 `agents.files.get` method，获取当前 `IDENTITY.md` 和 `SOUL.md`。

2、合并更新内容 
将请求中的 patch 字段与当前模板合并，仅更新传入字段，未传字段保持不变。

3、写回模板文件 
先调用 `agents.files.list`，再调用 `agents.files.set` 写回新的 `IDENTITY.md`、`SOUL.md`。

4、更新 Skill（可选） 
当请求包含 `skills` 字段时，通过 `AgentSkillsLogic.updateAgentSkills` 更新该 agent 的技能绑定。

5、更新 Channel（可选） 
当请求包含 `channel` 字段时，通过 WebSocket RPC 的 `config.set` 更新 Agent ↔ Channel 绑定关系，具体参考：["绑定 Channel 和 数字员工"](#bind-channel)。

### 通过接口编辑数字员工
提供 HTTP 接口编辑数字员工（部分更新语义）。
- endpoint: PUT /dip-studio/v1/digital-human/:id

---

## 删除数字员工

### 删除数字员工 Logic
```mermaid
sequenceDiagram

participant BE as Studio Backend（Express）
participant OC as OpenClaw

BE ->> OC: 1. ws: agents.delete
BE ->> OC: 2. 删除数字员工计划
BE ->> BE: 3. 返回 204 No Content
```

1、删除 Agent
通过 OpenClaw 的 WebSocket RPC 执行 `agents.delete` method。可通过 `deleteFiles` 控制是否删除 agent 工作目录。

2、从所有 cron 任务列表中筛选出 agentID 等于数字员工 ID 的 cron 任务，然后执行 `cron.remove` 进行删除。

3、错误映射
当 OpenClaw 返回 agent 不存在相关错误时，后端转换为 404 语义返回。

### 通过接口删除数字员工
提供 HTTP 接口删除数字员工。
- endpoint: DELETE /dip-studio/v1/digital-human/:id
- query: `deleteFiles`（可选，默认按后端逻辑处理）


### 绑定 Channel 和 数字员工<a id="bind-channel"></a>
创建、编辑数字员工时，如果修改了 Channel，需要重新绑定 Agent ↔ Channel 关系。为避免 OpenClaw 网关自动重启，需要遵循以下流程：

1. 调 "config.get" 拿当前配置（从 parsed 取对象）和 hash。
2. 在返回的 "config.bindings" 里追加一条 binding。
3. 转回 raw JSON
4. 用 "config.set" 写回完整配置，并带上 baseHash。
5. 示例绑定 Telegram ops account 到 work agent：

```json
{
  "type": "req",
  "id": "2",
  "method": "config.get",
  "params": {}
}
```

拿到：

```json
{
  "ok": true,
  "payload": {
    "hash": "...",
    "config": {}
  }
}
```

写回时：

```json
{
  "type": "req",
  "id": "3",
  "method": "config.set",
  "params": {
    "baseHash": "<config.get 返回的 hash>",
    "raw": "{\"bindings\":[{\"type\":\"route\",\"agentId\":\"work\",\"match\":{\"channel\":\"telegram\",\"accountId\":\"ops\"}}]}",
    "parsed": {
      bindings: {
        ...
      }
    }
  }
}
```

实际代码里 binding 结构是：

```typescript
{
  type?: "route";
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: { kind: "direct" | "group" | "channel"; id: string };
    guildId?: string;
    teamId?: string;
    roles?: string[];
  };
}
```

几个常见写法：

```json
{ "type": "route", "agentId": "work", "match": { "channel": "telegram", "accountId": "ops" } }
```

```json
{ "type": "route", "agentId": "work", "match": { "channel": "discord", "accountId": "*" } }
```

```json
{ "type": "route", "agentId": "opus", "match": { "channel": "whatsapp", "peer": { "kind": "direct", "id": "+15551234567" } } }
```

是否会重启网关：

- config.patch 和 config.apply 会主动调用 scheduleGatewaySigusr1Restart，所以会安排网关重启。
- config.set 只写配置，不主动调重启。
- OpenClaw 的配置热重载规则里 bindings 是 kind: "none"，不会要求 restart，也不会触发 channel restart。
- 所以要避免重启：用 config.get + config.set 写完整配置，不用 config.patch / config.apply。绑定类变更会在后续路由读取配置时生效，不需要重启 channel 连接。