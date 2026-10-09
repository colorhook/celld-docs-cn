<a id="kv"></a>

# KV

KV 是通过绑定供 Worker 访问的键值存储。每个命名空间对应一个 celld 单元，大于 1 MiB 的值存放在集群存储桶中。API 的详细说明请参阅 [Cloudflare KV 文档](https://developers.cloudflare.com/kv/api/)。

<a id="example"></a>

## 示例

[KV 示例](../../examples/kv) 演示如何在 KV 命名空间中读取、写入和删除值。

<!-- celld-example: kv -->

<a id="api"></a>

## API

- `get(key, type)` 以 `"text"`、`"json"`、`"arrayBuffer"` 或 `"stream"` 格式返回值。键不存在时返回 `null`。
- `getWithMetadata(key, type)` 还会返回写入时附带的元数据。
- `put(key, value, options)` 接受字符串、`ArrayBuffer`、类型化数组或 `ReadableStream`。可用选项包括 `expiration`（以秒为单位的绝对时间）、`expirationTtl`（从现在开始计算的秒数）和 `metadata`。
- `delete(key)` 删除一个键。
- `list({ prefix, cursor })` 返回一页键名，以及用于读取下一页的游标。

<a id="configuration-and-limits"></a>

## 配置与限制

`kv_namespaces` 配置项包含 `binding` 和 `id`。`id` 是命名空间的标识，可以是任意字符串，例如 Cloudflare 的十六进制 ID 或 `sessions`。两个 Worker 使用同一个 `id` 时，会访问同一个命名空间。celld 忽略 `preview_id`。

`put()` 会先完整读取 `ReadableStream`，再执行写入，因此可以使用 `put(key, request.body)`。`list()` 按字节顺序返回最多 1000 个键，并发写入不会导致游标漏掉某个键。

celld 执行 [Cloudflare KV 的限制](https://developers.cloudflare.com/kv/platform/limits/)：键最多 512 字节，值最多 25 MiB，元数据最多 1024 字节，批量 `get()` 每次最多读取 100 个键。超过限制的调用会失败，celld 绝不会截断数据。过期时间最少为 60 秒，键在过期的那一刻起便不可见。

每次调用都会发送到拥有该命名空间单元的节点，因此每次读取需要一次单元分发。如果一个请求要多次读取同一个值，应将它保存在局部变量中。一个命名空间中的写入会依次执行，因此对于计数器等写入频繁的值，应使用 Durable Object。

未配置集群存储桶时，写入大于 1 MiB 的值会失败，错误为 `KV large values need a fleet bucket`（KV 的大值需要集群存储桶）。

<a id="differences-from-cloudflare"></a>

## 与 Cloudflare 的差异

- celld 的读取总会访问拥有该命名空间的单元，因此不会返回旧值。Cloudflare KV 则提供最终一致性。
- celld 没有边缘缓存。`cacheTtl` 不起作用，`cacheStatus` 为 `null`。
- 大于 1 MiB 的值需要集群存储桶。
- 每个命名空间只有一个写入者。增加命名空间数量可以提高写入容量。

[Cloudflare 兼容性](../cloudflare-compat.md#services)页面列出了运行时 API 和不支持的服务。
