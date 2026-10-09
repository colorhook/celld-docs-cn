<a id="queues"></a>

# Queues（消息队列）

[Queues](https://developers.cloudflare.com/queues/) 是消息代理服务。生产者 Worker 发送消息，消费者 Worker 随后按批次接收消息。每个队列对应一个 celld 单元。API 的详细说明请参阅 [Cloudflare Queues 文档](https://developers.cloudflare.com/queues/configuration/javascript-apis/)。

<a id="example"></a>

## 示例

[Queues 示例](../../examples/queues) 在收到请求时发送一个任务，并在队列处理函数中执行它。如果任务路径以 `/fail` 结尾，任务会重试两次，随后示例会从死信队列中读取它。

<!-- celld-example: queues -->

<a id="api"></a>

## API

- `env.JOBS.send(body, { contentType, delaySeconds })` 发送一条消息。`contentType` 可为 `"v8"`、`"json"`、`"text"` 或 `"bytes"`。
- `env.JOBS.sendBatch(messages)` 每次最多发送 100 条消息。
- 消费者脚本导出 `queue(batch, env, ctx)`。`batch.queue` 是队列名称；`batch.messages` 的每一项都包含 `id`、`timestamp`、`body` 和尝试次数 `attempts`。
- `message.ack()` 和 `message.retry({ delaySeconds })` 分别确认或重试一条消息。`batch.ackAll()` 和 `batch.retryAll()` 则处理整个批次。对于同一条消息，第一次调用生效。
- 处理函数正常返回时，会确认所有尚未处理的消息。处理函数抛出异常时，会重试所有尚未确认的消息。

<a id="producers"></a>

## 生产者

`queues.producers` 配置项包含 `binding` 和 `queue` 名称。集群中使用同一队列名称的生产者都会写入同一个队列。celld 执行 [Cloudflare 的限制](https://developers.cloudflare.com/queues/platform/limits/)：一条消息最多 128,000 字节，一次 `sendBatch()` 最多包含 100 条消息且总计不超过 256,000 字节，`delaySeconds` 最大为 86,400。生产者配置项可通过 `delivery_delay` 设置默认延迟。

`send()` 在队列单元提交消息后才会完成。该单元最多同时接受 256 次生产者调用，超出的调用会收到单元过载错误，生产者可以重试。

<a id="consumers"></a>

## 消费者

`queues.consumers` 配置项指定 `queue`。一个队列只能由一个脚本消费，因此如果一次部署中有两个脚本消费同一队列，部署会失败。该配置项还可以设置 `max_batch_size`（默认 10，最大 100）、以秒为单位的 `max_batch_timeout`（默认 5，最大 60）、`max_retries`（默认 3）、`max_concurrency`（最大 250）、`retry_delay` 和 `dead_letter_queue`。celld 在部署时校验各项取值范围。各字段的含义请参阅[批处理、重试和延迟](https://developers.cloudflare.com/queues/configuration/batching-retries/)。

celld 不保证投递顺序，并提供至少一次投递语义。重复投递时 `message.id` 保持不变，因此应用可以将它用作幂等键。如果处理函数始终未完成对批次的处理，它会一直持有租约，直到租约过期；celld 将其计为一次失败的投递。celld 不会自动为重试增加指数退避，应用应根据 `message.attempts` 计算延迟。消息超过 `max_retries` 后会进入 `dead_letter_queue`；如果消费者没有配置死信队列，celld 会删除该消息。

<a id="differences-from-cloudflare"></a>

## 与 Cloudflare 的差异

- 每个队列只有一个写入者。增加队列数量可以提高写入容量。
- 队列拥有者最多接受 256 次并发生产者调用。超出的调用会被拒绝，生产者可以重试。
- celld 将消息保留四天，保留时间不可配置。
- 不支持拉取消费者、Queues HTTP API、控制台管理、手动关联消费者、R2 事件通知和 Queue 事件订阅。

[Cloudflare 兼容性](../cloudflare-compat.md#services)页面列出了运行时 API 和不支持的服务。
