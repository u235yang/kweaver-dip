---
name: 通道消息
description: 用户可以通过“@提及“通道用户来向数字员工下达指令将消息或任务结果投递给指定的通道用户
---

# 通道消息

## 需求背景

当用户在数字员工平台向数字员工下达指令或制定计划时，需要向指定通道发送通知或定时任务执行结果，例如：

- 每日汇总前一日的项目进度并主动发送给项目管理员。
- 收集材料生成 PPT 并发送给领导审核。

因此需要将通道用户与数字员工平台打通，使数字员工能够向指定的通道用户发送消息。

## 特性设计

### 术语

**通道**

指消息的投递渠道，例如：飞书、钉钉、企业微信等。

**@提及**

指用户在给数字员工下达指令时通过输入“@“符号并选择投递对象的能力。

### 角色定义

|  角色  |  说明  |
|  --  |  --  |
| 管理员 | - 查看、导入、导出通道用户<br>- 配置数字员工消息范围 |
| 普通用户 | - 在聊天中通过 @提及 指示数字员工向指定通道发送消息 |

### 通道用户管理

管理员可以在【系统配置】/【通道用户】界面统一查看和批量维护所有的通道用户账号。【通道用户】功能支持：

- 查看通道用户列表
- 使用 JSONL 模板导入导出通道用户
- 不支持在页面中单条新建、编辑、删除通道用户

#### 查看通道用户列表

- 通道用户列表展示以下信息：
  * 用户显示名
  * 所属通道
- 列表支持按“通道类型“进行过滤，并按显示名进行部分匹配。
- 如果一个用户属于多个通道，则显示两条独立的记录。

### 导出通道用户

- 以 `JSONL` 的数据格式存储通道用户列表。
- 导出文件的文件名格式为：`通道用户_<日期时间>.jsonl`，例如：`通道用户_2026_04_16_15_16_08.jsonl`。

### 导入通道用户

由于导入的 JSONL 数据不再经过转换而是被直接使用，因此需要对 JSONL 文件进行严格的格式检查。

- 导入通道用户时，需要检查 JSONL 所有记录行的完整性，对于数据格式不正确的文件直接报错并中断。
- 报错信息包括：
  * 错误行。
  * 错误原因：可能是字段缺失、数据类型错误，或其他原因。
  - 如果是重复记录，则提示重复行 + 重复原因。例如：假设 行1、行 10、行 20 为重复数据，则对行 10、行 20 进行。
  - 重复原因可能是：
    * user_id 重复
    * 显示名 + 通道类型的组合重复

### 发送消息给通道用户

- 普通用户在和数字员工对话时，可以通过输入 @ 触发选择通道用户。
- 通道用户列表记录显示格式为：`<通道类型>用户:<显示名>`，例如 “飞书用户: Zak“。
- 通道用户列表首次展示 10 条，滚动加载每次 +10 条记录。
- 用户可以在聊天框中边输入边过滤通道用户列表，过滤不区分大小写。例如：
  1. 用户输入 @ 时，出现按拼音首字母排序的用户列表。
  2. 用户输入 `@王子` 时，列表中出现显示名包含 `王子` 的用户，按照以下规则排序：
    * 匹配位置靠前优先，例如：`王子秦` 要出现在 `数学王子秦老师` 前。
    * 多通道匹配时，按通道名称首字母排序
- 列表始终聚焦第一条通道用户记录，当用户输入空格时，在输入框中生成通道用户内联块。
- 输入框中的通道用户内联块显示格式为：`<通道类型>用户: <显示名>`，例如 “飞书用户: Zak“。
- 在已发送的消息和历史消息中，同样使用内联块格式显示通道用户。

## 实现设计

### 通道用户文件

- 使用 JSONL 数据格式来存储通道用户记录，Schema 为：

```yaml
$schema: "http://json-schema.org/draft-07/schema#"
title: 通道用户记录
type: object
description: JSONL 中的每一行代表一个通道用户对象

properties:

  displayName:
    type: string
    description: 通道用户的显示名
  
  channel:
    type: object
    description: 通道信息
    properties:
      type:
        type: string
        enum: ["feishu", "dingding"]
      user_id:
        type: string
        description: 通道用户的 User ID
```

- 通道用户文件存放路径为`{OpenClaw 主目录}/workspace/channel-users.jsonl`

### 导入

- JSONL 中的记录必须保证以下字段（组合）全局唯一：
  * channel.user_id
  * displayName + channel.type

### 导出

- 导出通道用户时，通过 HTTP GET 协议读取 `channel-users.jsonl` 并导出

### 获取通道用户列表

以下逻辑适用于用户 @提及 时，获取过滤后的通道用户列表。

```mermaid
sequenceDiagram

participant SW as Web
participant BE as Studio Backend (Express)
participant OC as OpenClaw

SW ->> BE: GET /channel-users
BE ->> OC: 读取 channel-users.jsonl

alt 带过滤条件
  BE ->> BE: 根据过滤条件筛选列表
end

BE ->> BE: 根据 start 和 limit 分页
BE ->> SW: 返回列表数据

```

#### 过滤条件

- 过滤条件支持传入 `type` 和 `displayName`，根据过滤条件参数进一步筛选过滤列表。

### 通道用户接口范围

通道用户仅提供列表查询、导入和导出接口，不提供单条通道用户的新建、编辑、删除接口。

| 方法 | 路径 | 说明 |
| -- | -- | -- |
| GET | `/api/dip-studio/v1/channel-users` | 查询通道用户列表 |
| GET | `/api/dip-studio/v1/channel-users/export` | 导出通道用户 JSONL 文件 |
| POST | `/api/dip-studio/v1/channel-users/import` | 导入通道用户 JSONL 文件 |

### 获取数字员工的 @提及 列表

- 通过 HTTP GET /digital-human/:id/channel-users 获取指定数字员工的可 @提及 列表

### 投递消息

消息中的内联块，展开为原始数据结构为使用 `@{}` 包含的结构：

```text
@{channel:<channelType>:displayName:<displayName>:user_id:<userId>}
```

字段说明：

| 字段 | 说明 |
| -- | -- |
| `channelType` | 通道类型，例如 `feishu`、`dingding` |
| `displayName` | 通道用户显示名 |
| `userId` | 通道用户在对应通道中的 `user_id` |

解析规则：

1. 仅识别以 `@{channel:` 开始、以 `}` 结束的文本片段。
2. 在片段中按固定字段标记解析：`channel`、`displayName`、`user_id`。
3. `channelType` 位于 `@{channel:` 与 `:displayName:` 之间。
4. `displayName` 位于 `:displayName:` 与结束符 `}` 前最后一个 `:user_id:` 之间。
5. `userId` 位于结束符 `}` 前最后一个 `:user_id:` 与 `}` 之间。
6. 解析成功后，前端展示为通道用户内联块；解析失败时，按普通文本展示。

示例：

当用户向数字员工发送指令：

```
汇总 XX 项目进度，发送项目报告并发送给 [飞书用户: Zak]
```

指令文本需要被解析：

- [飞书用户: Zak] 表示内联的 @提及，底层消息结构为：`@{channel:feishu:displayName:Zak:user_id:feishu_user_id_3}`
- 转换成 Agent 收到的消息：
  ```text
  汇总 XX 项目进度，发送项目报告并发送给 @{channel:feishu:displayName:Zak:user_id:feishu_user_id_3}
  ```

Agent 接收到消息后：

1. 汇总项目进度并生成报告
2. 通过 OpenClaw 的通道消息机制发送报告给 user_id 为 `feishu_user_id_3` 的飞书（feishu）用户 Zak 


## 附

### 关于 Open ID 和 User ID 的说明

在飞书中有三种 ID 类型：

- Open ID。应用级 ID，格式为 ou_34ce25bdeb031c3cb68c1764632aaf7b。
- Union ID。开发商级 ID，格式为 on_5270f68eb0a59d97f3c9f8cd3933de4a
- User ID。租户级 ID，格式为 6e56d89e

这几种 ID 的主要区别在于生效范围，这里主要是 Open ID 和 User ID 的区别：

- Open ID 与应用（Bot）是 1 : 1 的关系，同一个用户对应不同的应用，Open ID 是不同的。
- User ID 与应用（Bot）是 1 : N 的关系，同一个用户对应不同的应用，User ID 是相同的。

| 应用 | 被 @用户的 Open ID | 被 @用户的 User ID |
|  --  |  -- |  -- |
| 运营助手 | ou_34ce25bdeb031c3cb68c1764632aaf7b | 6e56d89e |
| 产品专家 | ou_c4eb031c76417b36b68ce25bd32aaf3c | 6e56d89e |

因此，如果要让不同的数字员工能够向同一个用户投递消息，需要使用应用范围最广的 User ID。
