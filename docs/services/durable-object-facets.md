<a id="durable-object-facets"></a>

# Durable Object Facets（子对象）

facet 是 Durable Object 内部的子对象，拥有独立的 SQLite 数据库。主管类使用 [Worker Loader](dynamic-workers.md) 提供的类启动 facet，让生成的代码或不受信任的代码无需 Durable Object 命名空间也能获得持久化存储。标准 API 请参阅 [Cloudflare Durable Object Facets 文档](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/)。

<a id="example"></a>

## 示例

[facets 示例](../../examples/facets) 使用 Worker Loader 提供的类创建 facet。

<!-- celld-example: facets -->

<a id="api"></a>

## API

- `ctx.facets.get(name, callback)` 返回具名 facet 的代理。回调返回 `{ class, id }`，celld 只在启动 facet 时运行它。
- Worker Loader 绑定上的 `worker.getDurableObjectClass("App")`，或 `ctx.exports.App`，提供所需的 `class`。
- `ctx.exports.App({ props })` 创建带启动属性的类句柄。
- `ctx.facets.abort(name, reason)` 停止 facet，保留数据库。
- `ctx.facets.delete(name)` 停止 facet，删除数据库。
- 代理可以响应 `fetch()` 和类的 RPC 方法。

<a id="a-facet-is-a-part-of-its-root-object"></a>

## facet 是根对象的一部分

facet 不是单元，没有自己的所有权记录和隔离纪元，而是使用根单元的记录和纪元。详见 [Durable Objects 页面](durable-objects.md#ownership-and-the-single-threaded-model)。

facet 在根单元的拥有者节点上运行。逐出、重置和迁移都会将根对象与所有 facet 作为一个整体处理，下次调用时会重新执行启动回调。

与 workerd 一样，facet 写入在 facet 自己的数据库中提交，因此回滚根对象事务不会撤销事务内的 facet 调用。facet 与根对象永远不会原子提交。celld 会暂扣 facet 的出站副作用以及 facet 调用的回复，直到 facet 复制流证明此次调用的写入已经持久化。副作用还必须通过根单元的输出门控。

<a id="starting-and-addressing-a-facet"></a>

## 启动与寻址

`ctx.facets.get(name, callback)` 返回代理，只有 facet 尚未运行时 celld 才会执行回调。回调返回 `class` 和可选的 `id`。`class` 可以来自 Worker Loader 绑定的 `worker.getDurableObjectClass("App")`，也可以来自未声明存储迁移的导出 `DurableObject` 类的 `ctx.exports.App`；后一种 facet 运行在根对象的隔离实例中。

加载的类可以继承 `DurableObject`，也可以是具有 `(state, env)` 构造函数的普通类。普通类可以响应 `fetch()`；与 workerd 一样，其 RPC 方法需要 `js_rpc` 兼容性标志。

`id` 设置 facet 中的 `ctx.id`。`DurableObjectId` 会保留名称，字符串 ID 保持字符串形式；省略 ID 时则继承父对象的 ID 和名称。未迁移的类句柄没有 `idFromName()`，因此应使用 Durable Object 命名空间创建具名 ID。

`ctx.exports.App({ props })` 创建带启动属性的类句柄。调用时会复制属性，因此之后修改原对象不会影响 `ctx.props`。这些属性必须支持结构化克隆。不带属性的回环类会提供空对象。

- 数据库只由名称决定，因此改变 `id` 仍会访问相同的存储数据。名称长度上限为 256 字节。
- facet 可以启动自己的 facet，总深度最多为 4 层，包含根对象。
- `ctx.facets.abort(name, reason)` 停止 facet 并保留数据库。调用已停止的代理会抛出指定的原因。
- `ctx.facets.delete(name)` 停止 facet，并删除它及其所有下级 facet 的数据库。

根对象之外无法凭名称访问 facet，因此外部流量必须经过主管对象。如果子对象需要运行在不同节点上，应使用通过 [`idFromName()`](durable-objects.md#identity-and-addressing) 寻址的独立 Durable Object。

<a id="websockets-in-a-facet"></a>

## facet 中的 WebSocket

facet 可以接受 WebSocket：其 `fetch()` 返回带 `WebSocketPair` 客户端端点的 `101` 响应，根对象再返回该响应。facet 可以在服务端端点上调用 `accept()`，或将其传给 `ctx.acceptWebSocket()`。facet 也可以使用 `new WebSocket(url)` 或带有 `Upgrade: websocket` 的 fetch 打开 WebSocket。celld 将每个这类连接的事件交给 facet，而不是根对象。连接输出会等待 facet 复制流，并通过根单元的输出门控。

facet 连接不会休眠，因为 celld 无法脱离根对象重新启动 facet。facet 接受或打开的连接会使根单元保持驻留，直到连接关闭。来自其他 Durable Object 的 `101` 响应的客户端端点则不会。`getWebSockets()` 返回该 facet 的连接。

`ctx.facets.abort()` 和 `ctx.facets.delete()` 会以状态码 `1001` 关闭所有被停止 facet 的连接，facet 不会收到关闭事件。workerd 会直接断开连接，因此其客户端看到的是 `1006`。排空、所有权转移或代际切换会以 `1012` 关闭 facet 连接，输出门控失败则使用 `1011`。

<a id="differences-from-cloudflare"></a>

## 与 Cloudflare 的差异

- Durable Object 绑定不能提供 facet 类。声明了存储迁移的类也不能提供，因为 `ctx.exports` 将该类保存为命名空间。
- 每个 facet 都有独立的 SQLite 数据库，celld 在根 Durable Object 的存储桶前缀下，以独立复制流进行复制。
- facet 不能设置闹钟。在 facet 内调用 `storage.setAlarm()` 会抛出异常，因此调度计划必须由根对象维护。
- facet 连接不会休眠，会使根单元持续驻留，直到连接关闭。
- facet 代理不能被 `await`，也不支持流水线属性路径，因此调用必须指定一个方法。
- 不支持 `clone()` 方法。

[Cloudflare 兼容性](../cloudflare-compat.md#services)页面列出了运行时 API 和不支持的服务。
