<a id="durable-objects--cells"></a>

# Durable Objects / 单元

Durable Object 是具有独立 SQLite 数据库的单线程 actor。celld 将每个运行中的 Durable Object 称为单元（cell），并将数据库复制到集群中。标准 API 请参阅 [Cloudflare Durable Objects 文档](https://developers.cloudflare.com/durable-objects/)。

<a id="example"></a>

## 示例

[counter 示例](../../examples/counter) 在 Durable Object 的键值存储中保存计数器，并通过 `idFromName()` 为每个名称建立独立计数器。

<!-- celld-example: counter -->

<a id="api"></a>

## API

- `env.COUNTER.idFromName(name)` 返回 ID，`env.COUNTER.get(id)` 返回代理对象（stub）。`getByName(name)` 合并这两个步骤。
- `newUniqueId()` 创建随机 ID，`idFromString()` 解析随机 ID。
- `ctx.storage.get()`、`put()`、`delete()`、`list()` 和 `deleteAll()` 是键值存储方法。
- `ctx.storage.sql.exec()` 在对象的数据库上执行 SQL。
- `transaction()` 和 `transactionSync()` 将多次写入组织为事务。
- `storage.setAlarm()`、`getAlarm()` 和 `deleteAlarm()` 管理每个对象的一个闹钟，celld 会调用 `alarm(alarmInfo)` 处理函数。
- `ctx.acceptWebSocket()` 接受可休眠 WebSocket，celld 为每个帧调用 `webSocketMessage()`。
- `blockConcurrencyWhile()` 关闭输入门控。
- `storage.sync()` 等待之前已提交的写入达到持久化要求。

<a id="identity-and-addressing"></a>

## 标识与寻址

celld 在首次调用代理对象的方法时创建对象，而不是在调用 `get()` 时创建。

`idFromName()` 使用 HMAC-SHA-256 对名称进行计算，得到 64 位十六进制 ID；密钥由 celld 根据脚本名和类名构造。因此，从任意节点访问同一名称都会到达同一对象。与 Cloudflare 一样，名称不超过 1024 个 UTF-8 字节时，`ctx.id.name` 会保存该名称；更长的名称仍然可以正确路由。

`newUniqueId()` 生成随机字节，因此应保存其 `toString()` 形式，以便再次访问对象。`idFromString()` 会校验 HMAC，因此 celld 拒绝来自其他命名空间的 ID。

因此，重命名 Worker 脚本后会访问新的空对象，旧对象的数据仍保存在旧 ID 下。

<a id="ownership-and-the-single-threaded-model"></a>

## 所有权与单线程模型

同一时刻，恰好有一个节点为一个单元提供服务。节点通过向集群存储桶条件写入所有权记录来认领单元。每次激活都会递增一个用于隔离旧拥有者的纪元（fencing epoch），并将它放入存储前缀中；失去单元的节点只能继续写入已被取代的前缀。[celld 的保证](../guarantees.md)页面介绍了完整机制。celld 将每次代理调用转发给拥有者节点。

单元内部，同一时刻只执行一个同步片段。事件在等待时可能与其他事件交错，除非 `blockConcurrencyWhile()` 关闭了输入门控。celld 会暂扣响应，直到持久性证明覆盖该响应可能暴露的所有写入；这与 Cloudflare 的[输出门控](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)一致，因此应用不必对 `put()` 执行 `await`。

输出门控对每个 WebSocket 帧只等待该帧自己的证明，因此 `webSocketMessage()` 处理函数先发送、再等待时，该帧会在函数仍然运行期间送达。在同一连接上，celld 按到达顺序启动消息处理函数，但不会等待前一个完成才启动下一个，因此新消息可以取消之前处理函数正在等待的工作。在 WebSocket 处理函数和 RPC 方法之间，可休眠连接仍按发送顺序投递帧。

单元被逐出后不会保留内存状态，因此下次事件到来时构造函数会重新运行。节点停止、排空，或空闲重平衡迁移休眠单元时，所有权也可能转移。可休眠 WebSocket 在同一节点上的休眠期间保持连接，单元迁移时则会关闭，因此客户端必须重新连接。

<a id="durable-storage-and-alarms"></a>

## 持久化存储与闹钟

由 `new_sqlite_classes` 迁移声明的类，可以使用键值方法和 `ctx.storage.sql.exec()`。与 workerd 一样，`transactionSync()` 回调不接收参数，抛出异常会回滚事务。事务可以开启嵌套事务；嵌套事务失败只丢弃自己的写入，外层事务仍然可以提交。

同步的 `ctx.storage.kv.list()` 迭代器每步读取一项，不阻止后续写入。每步都从上次返回的键之后继续，因此它可以观察到尚未返回的项发生的变化。再次调用 `kv.list()` 会使该对象之前的迭代器失效。

celld 将每次写入捕获为 LTX 段，并复制到集群存储桶的 `cells/<cell>/ltx/e<epoch>/` 下。在包含两个或更多节点的集群中，拥有者的一个或两个跟随节点均已将写入保存到磁盘后，拥有者才会响应，随后再上传到存储桶。只有一个节点时，每次写入都必须等待对象存储。

celld 不会确认 `setAlarm()` 成功，直到存储桶中的持久化唤醒条目覆盖该闹钟。休眠单元在自己的拥有者节点上触发闹钟。一个节点承担唤醒者角色，只唤醒拥有者已经停止的单元。

<a id="differences-from-cloudflare"></a>

## 与 Cloudflare 的差异

- celld 不承诺特定的放置位置、迁移策略或司法管辖区。单元运行在你的集群节点上，`newUniqueId({ jurisdiction })` 和 `namespace.jurisdiction()` 会抛出异常。
- 命名空间的密钥包含脚本名，因此重命名脚本会改变 `idFromName()` 派生的所有 ID。
- `migrations` 配置项只接受 `tag` 和 `new_sqlite_classes`。类重命名、删除或转移都会使部署停止。
- Durable Object 事件在处理函数返回后仍保持待完成的 I/O 活跃，因此定时器或子请求不需要 `ctx.waitUntil()`。
- 只要先前注册的后台工作仍然活跃，导入的 `waitUntil()` 和 `ctx.waitUntil()` 就可以继续添加工作。
- RPC 代理不能跨越隔离实例边界，详见 [RPC](../cloudflare-compat.md#rpc)。
- 对象迁移到其他节点后，出站 WebSocket 不会继续存在。
- 接近 V8 堆上限时，`SqlStorage.Cursor.toArray()` 会给出 celld 特有的错误。
- `storage.sync()` 等待对象存储或集群复制组保存所有先前已提交的写入。该操作使用 `CELLD_LTX_DURABILITY_TIMEOUT_SECS`（默认 10 秒）与 `CELLD_OPERATION_DEADLINE_MS`（默认 15 秒）中的较短时限。
- `storage.sync()` 在事务尚未关闭或对象已中止时会拒绝执行。没有对象存储时，它会在本地提交后完成。
- 事务和 `blockConcurrencyWhile()` 的时限均为 30 秒。超时会重置对象，并回滚尚未关闭的事务。
- 失败的处理函数仍须等待其可能暴露的任何值或写入达到持久化要求。celld 生成的失败如果不暴露对象值，则立即返回。
- 在显式事务之外，SQL 写游标必须在响应、出站副作用或 `storage.sync()` 之前完成。未完成的 `RETURNING` 游标持有未提交写入，因此 celld 会报错并拒绝输出。读游标可以保持打开。

[Cloudflare 兼容性](../cloudflare-compat.md#services)页面列出了运行时 API 和不支持的服务。
