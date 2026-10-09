<a id="workflows"></a>

# Workflows（工作流）

Workflow 是持久化函数，以一系列具名步骤、休眠和事件组成执行流程。celld 将每个实例作为一个单元运行。API 的详细说明请参阅 [Cloudflare Workflows 文档](https://developers.cloudflare.com/workflows/build/workers-api/)。

<a id="example"></a>

## 示例

[Workflow 示例](../../examples/workflow) 获取一个文档，并保存持久化步骤的结果。

<!-- celld-example: workflow -->

<a id="api"></a>

## API

- 定义继承 `WorkflowEntrypoint` 的类，并实现 `run(event, step)`。`event.payload` 保存参数，返回值成为 `status()` 的 `output` 字段。
- `step.do(name, callback)` 执行一个持久化步骤，回调失败时会重试。
- `step.sleep(name, duration)` 和 `step.sleepUntil(name, timestamp)` 暂停实例，直到指定时间。
- `step.waitForEvent(name, options)` 暂停实例，直到收到匹配事件。
- `env.MY_WORKFLOW.create()`、`createBatch()` 和 `get(id)` 返回实例。`deleteBatch()` 删除多个实例。
- 实例提供 `status()`、`sendEvent()`、`pause()`、`resume()`、`restart()`、`terminate()` 和 `delete()`。

<a id="replay"></a>

## 重放

每当实例取得进展时，celld 都会从第一行重新调用 `run()`。已经完成的步骤会返回存储的结果，不再执行回调。因此，步骤回调以外的所有代码都会在每次重放时重新执行。按照 [Workflows 的规则](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)，每次子请求、每个副作用，以及所有必须保持稳定的值，都应放入 `step.do()` 回调中。如果节点故障前步骤结果尚未提交，该步骤会再次执行，因此步骤回调必须能容忍再次尝试。

`run()` 可以等待不属于步骤的工作，但重放无法恢复这种等待。如果没有任何步骤正在执行或等待，而这类工作使 `run()` 连续 60 秒未完成，celld 会将实例标记为失败。

<a id="sleeps-events-and-retries"></a>

## 休眠、事件与重试

`step.waitForEvent()` 默认在 24 小时后超时。在实例到达等待步骤之前收到的事件会被缓冲。休眠、事件等待和待执行的重试都会保存截止时间，因此崩溃或缓慢的重放不会改变截止时间。`status()` 对这三种情况均报告 `waiting`。

等待中的实例不占用隔离实例。如果下一次截止时间超出近期闹钟的驻留窗口，该单元会休眠。该窗口默认为一小时，可以通过 `CELLD_ALARM_RESIDENT_MS` 修改。

调用 `step.do()` 时如果没有提供 `retries` 对象，会使用 Cloudflare 的默认重试设置：重试 5 次，延迟 10 秒，采用指数退避，单次尝试超时为 10 分钟。

celld 不限制并发实例数量，实际数量受集群内存和驻留单元上限约束。

<a id="differences-from-cloudflare"></a>

## 与 Cloudflare 的差异

- celld 默认将成功或失败的实例保留 30 天。`retention` 选项中的每个时长最多为 30 天。
- `locationHint` 接受 Cloudflare 的取值，但单元位置由集群所有权机制决定。
- 不属于步骤的工作不能连续等待超过 60 秒。
- 步骤结果、事件载荷和工作流参数各自都有 1 MiB 的上限。
- 不支持回滚、敏感步骤结果，以及 `ReadableStream` 类型的步骤结果。
- `workflows` 配置项不能包含 `schedules`、`limits`，也不能通过 `script_name` 指向其他脚本。
- 不支持 Workflows REST API 和 `wrangler workflows` 命令。请通过绑定操作实例。

[Cloudflare 兼容性](../cloudflare-compat.md#services)页面列出了运行时 API 和不支持的服务。
