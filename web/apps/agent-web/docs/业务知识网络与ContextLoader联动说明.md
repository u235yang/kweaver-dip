# 业务知识网络与 ContextLoader 联动说明

## 文档目的

本文档用于说明在 Agent 配置页中，`业务知识网络` 与 `ContextLoader` 工具集之间的联动规则，方便后续开发、联调和问题排查。

## 相关对象

- `ContextLoader` 工具集 `box_id`
  - `e521d454-4a0b-4dc9-8a28-d0986de1cef9`
- 业务知识网络配置路径
  - `self_config.data_source.knowledge_network`
- 自动引用的变量
  - `header.x-account-id`
  - `header.x-account-type`
  - `self_config.data_source.knowledge_network[0].knowledge_network_id`

## 总体原则

- 前端会在特定场景下自动补全或重建 `ContextLoader` 工具集的工具参数。
- 自动补全完成后，所有参数都允许用户继续手动修改。
- 如果后续再次触发自动补全逻辑，则只按规则更新需要系统兜底的部分，不随意覆盖用户已有配置。
- 每个工具的人工干预配置属于用户配置，不自动覆盖。

## 触发场景

### 1. 用户添加业务知识网络，且当前未添加 ContextLoader

- 自动添加整个 `ContextLoader` 工具集。
- 效果等同于用户在“添加技能”弹窗中手动选择整个 `ContextLoader` 工具箱。

### 2. 用户添加业务知识网络，且当前已经添加过 ContextLoader

- 仍然按“重建整个 `ContextLoader` 工具集”处理。
- 这里的“重建”是指以工具箱下当前最新的工具列表为准重新生成技能项。
- 重建时会尽量保留用户已有配置，不做无意义覆盖。

### 3. 用户删除业务知识网络，且当前存在 ContextLoader

- 不删除 `ContextLoader` 工具集。
- 仅回写 `kn_id` 参数的取值逻辑。

### 4. 用户手动添加 ContextLoader 工具集

- 在用户确认添加时，前端自动初始化该工具箱下所有工具的输入参数。
- 初始化后，用户仍可继续手动修改。

## 参数自动处理规则

以下规则适用于：

- 用户手动添加 `ContextLoader` 工具集时
- 因业务知识网络变化而自动添加或重建 `ContextLoader` 工具集时

### 关键字段

#### `x-account-id`

- 自动处理时：
  - 设为 `启用`
  - 值设为 `引用变量 + header.x-account-id`
- 说明：
  - 如果用户之前手动改成了固定值或其它值，在再次触发自动处理时，会重置为上述默认规则。

#### `x-account-type`

- 自动处理时：
  - 设为 `启用`
  - 值设为 `引用变量 + header.x-account-type`
- 说明：
  - 如果用户之前手动改成了固定值或其它值，在再次触发自动处理时，会重置为上述默认规则。

#### `kn_id`

- 当前 Agent 已添加业务知识网络时：
  - 设为 `启用`
  - 值设为 `引用变量 + self_config.data_source.knowledge_network[0].knowledge_network_id`
- 当前 Agent 未添加业务知识网络时：
  - 设为 `启用`
  - 值设为 `模型生成`
- 说明：
  - `kn_id` 会跟随业务知识网络的增删重新计算。

### 其它非必填字段

- 如果当前字段不是启用状态：
  - 自动改为 `启用`
  - 值设为 `模型生成`
- 如果当前字段已经是启用状态：
  - 保留用户当前配置
  - 不覆盖其当前的取值方式和取值内容

## 用户手动修改后的处理原则

### 允许手动修改的范围

以下字段在自动初始化之后，用户都可以继续手动修改：

- `x-account-id`
- `x-account-type`
- `kn_id`
- 其它非必填字段

### 再次触发自动处理时的覆盖策略

- `x-account-id`
  - 重新按默认规则覆盖
- `x-account-type`
  - 重新按默认规则覆盖
- `kn_id`
  - 重新按当前是否存在业务知识网络的规则覆盖
- 其它非必填字段
  - 只有在当前未启用时，才自动设为 `启用 + 模型生成`
  - 如果当前已启用，则保留用户配置

## 人工干预配置处理原则

每个工具都支持人工干预相关配置，包括但不限于：

- `intervention`
- `intervention_confirmation_message`

联动规则如下：

- 在 `ContextLoader` 自动添加或重建过程中，不覆盖人工干预相关配置。
- 如果某个工具之前已经配置了人工干预开关或确认文案，重建后仍然保留。

## 实现语义说明

“自动添加”与“自动重建”的目标不是把工具恢复成完全初始状态，而是：

- 保证关键字段符合系统约定
- 保证缺失的非必填字段有可用兜底配置
- 尽量保留用户已经手动完成的有效配置

## 示例

### 示例 1：先手动添加 ContextLoader，再添加业务知识网络

初始状态：

- 用户手动添加了 `ContextLoader`
- 用户把某个工具的 `x-account-id` 改成固定值 `111`
- 用户把某个非必填字段设成固定值 `abc`

之后用户添加业务知识网络：

- `ContextLoader` 会按规则重建
- `x-account-id` 会被重置成 `引用变量 + header.x-account-id`
- `kn_id` 会被设成 `引用变量 + self_config.data_source.knowledge_network[0].knowledge_network_id`
- 如果非必填字段原本已经启用并配置为固定值 `abc`，则保持不变

### 示例 2：删除业务知识网络

初始状态：

- Agent 已添加业务知识网络
- `ContextLoader` 已存在

用户删除业务知识网络后：

- `ContextLoader` 保留
- `kn_id` 改为 `启用 + 模型生成`
- 其它参数保持原逻辑不变

## 建议

- 如果后续还会扩展 `ContextLoader` 相关规则，建议继续在本目录维护：
  - 需求规则放在 `逻辑.md`
  - 接口样例放在 `contextloader接口.json`
  - 稳定后的实现说明放在本文档
