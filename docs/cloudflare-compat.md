<a id="cloudflare-compatibility"></a>

# Cloudflare 兼容性

本页只列出与所链接 Cloudflare API 的差异。没有备注的条目，其行为与 Cloudflare 一致。

- **支持**：已实现，差异仅限于列出的内容。
- **部分支持**：相当一部分功能不可用。
- **实验性**：可能随时变化。
- **不支持**：尚未实现。

celld 会在部署或首次使用时拒绝不支持的配置或 API。如果某项不支持的功能没有报错，应视为缺陷。

<a id="services"></a>

## 服务

| 服务 | 状态 |
| --- | --- |
| [Workers](services/workers.md) | **支持** |
| [Durable Objects](services/durable-objects.md) | **支持** |
| [Durable Object Facets（子对象）](services/durable-object-facets.md) | **支持** |
| [Containers（容器）](services/containers.md) | **实验性** |
| [静态资源](services/static-assets.md) | **支持** |
| [Cron Triggers（定时触发器）](services/cron-triggers.md) | **支持** |
| [Dynamic Workers（动态 Workers）](services/dynamic-workers.md) | **支持** |
| [KV](services/kv.md) | **支持** |
| [Queues（消息队列）](services/queues.md) | **支持** |
| [D1](services/d1.md) | **支持** |
| [Workflows（工作流）](services/workflows.md) | **支持** |
| [R2](services/r2.md) | **支持** |
| Workers AI | **不支持** |
| Vectorize | **不支持** |
| Hyperdrive | **不支持** |
| Browser Rendering（浏览器渲染） | **不支持** |
| Email Workers | **不支持** |
| [Python Workers](services/workers.md#python-workers) | **部分支持** — Pyodide 0.28 运行时系列上的 `fetch` 处理函数 |

<a id="runtime-apis"></a>

## 运行时 API

| API | 状态 |
| --- | --- |
| [Fetch、Request、Response 和 Headers](#fetch-request-response-and-headers) | **支持** |
| [绑定](#bindings) | **支持** |
| [上下文](#context) | **支持** |
| [处理函数](#handlers) | **支持** |
| [RPC](#rpc) | **支持** |
| [流](#streams) | **支持** |
| 编码 | **支持** |
| [WebSocket](#websockets) | **支持** |
| [Web Crypto](#web-crypto) | **支持** |
| [Web 标准](#web-standards) | **支持** |
| WebAssembly | **支持** |
| [性能与定时器](#performance-and-timers) | **支持** |
| 控制台 | **支持** |
| [Node.js 兼容性](#nodejs-compatibility) | **部分支持** |
| [缓存](#cache) | **部分支持** |
| HTMLRewriter | **支持** |
| [TCP 套接字](#tcp-sockets) | **支持** |
| EventSource | **支持** |
| MessageChannel | **支持** |
| BroadcastChannel | **不支持** |

<a id="fetch-request-response-and-headers"></a>

### [Fetch、Request、Response 和 Headers](https://developers.cloudflare.com/workers/runtime-apis/fetch/)

- 不支持请求选项 `cache`。
- 入站 `Request` 有 `cf` 对象，但不包含 Cloudflare 边缘字段。celld 无法确认地理位置、colo 或 TLS 元数据。
- celld 会移除 Worker 响应中的 `Content-Length`，但 `HEAD` 响应除外。
- 远程 Durable Object 调用一旦开始传输请求体，就不能重试，因为 celld 不保留用于重放的副本。
- 远程 Durable Object 调用等待被拒绝的拥有者代际发生变化，最多等待 `CELLD_OPERATION_DEADLINE_MS`。

<a id="bindings"></a>

### [绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/)

只支持[服务表](#services)中的绑定类型。

<a id="context"></a>

### [上下文](https://developers.cloudflare.com/workers/runtime-apis/context/)

- `passThroughOnException()` 不起作用，因为 celld 没有 CDN 回退。
- `ctx.facets` 只在 Durable Object 内可用。

<a id="handlers"></a>

### [处理函数](https://developers.cloudflare.com/workers/runtime-apis/handlers/)

不支持 `tail` 和 `email` 处理函数。

<a id="rpc"></a>

### [RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)

- RPC 代理不能跨越隔离实例边界。
- Durable Object RPC 调用中的 `AbortSignal` 不会跨越节点边界。
- 只有失败的节点间尝试尚未开始执行方法时，远程 RPC 才会重试。应用层重试应使用稳定的操作 ID。

<a id="streams"></a>

### [流](https://developers.cloudflare.com/workers/runtime-apis/streams/)

- 未被接管且没有活动的 HTTP 流会在 60 秒后过期。每次成功的流操作都会开启新的 60 秒窗口。
- 过期或未知的流会报告错误，而不是 EOF。

<a id="websockets"></a>

### [WebSocket](https://developers.cloudflare.com/workers/runtime-apis/websockets/)

- Worker 的出站连接在所属事件和 `waitUntil` 工作结束后关闭。通过响应返回的连接保持打开。
- 每个由隔离实例轮询的输入队列，为非终止帧提供 1 MiB 的预算。大于 1 MiB 的消息会占用整个预算。
- 如果隔离实例停止轮询，celld 在清理时丢弃未读帧。之后再拉取会报告异常关闭。
- WebSocket 传输不能迁移到新的单元拥有者。客户端必须使用同一应用操作 ID 重新连接。
- 隧道连接转发拥有者的 Close 帧，不额外发送 Close。如果拥有者连接在帧之间、Close 之前失败，入口发送状态码 1012；如果帧不完整，入口则直接关闭传输连接。
- V8 堆使用超过上限的 90% 时，`acceptWebSocket()` 会抛出异常。
- 与 workerd 一样，如果请求没有 `Upgrade: websocket`，却返回带 WebSocket 的响应，操作会失败。Durable Object 的 `stub.fetch()` 调用会拒绝，HTTP 客户端收到状态 500。连接的服务端端点收到状态码为 1006 的关闭事件。
- 处理函数失败时，无论调用发生在拥有者节点还是其他节点，Durable Object 的 `stub.fetch()` 都会拒绝。

<a id="web-crypto"></a>

### [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

- HMAC 接受 MD5、SHA-1、SHA-224、SHA-256、SHA-384 和 SHA-512。
- ECDSA 只支持搭配 SHA-256 的 P-256 曲线。
- AES-GCM 接受 96 至 128 位的认证标签，步长为 8 位。
- RSA-OAEP 接受 SHA-1、SHA-256、SHA-384 和 SHA-512。非空 label 必须是有效 UTF-8。
- 对称密钥不能在 `exportKey()` 或 `wrapKey()` 中使用 `jwk`。
- Ed25519 支持签名与验证，`NODE-ED25519` 是同一算法的别名。一种名称产生的签名可以用另一种名称验证。
- X25519 支持派生比特和密钥。低阶对端密钥会产生全零共享密钥，因此 `deriveBits()` 会拒绝该密钥。
- Ed25519 或 X25519 公钥在 `raw` 格式中使用其 32 字节点，因此 `importKey()` 和 `exportKey()` 都只传递该点。

<a id="web-standards"></a>

### [Web 标准](https://developers.cloudflare.com/workers/runtime-apis/web-standards/)

<a id="performance-and-timers"></a>

### [性能与定时器](https://developers.cloudflare.com/workers/runtime-apis/performance/)

`performance.timeOrigin` 为 `0`，`performance.now()` 与 `Date.now()` 一致。两个时钟都在 I/O 边界推进，在 JavaScript 执行期间保持不变。

<a id="nodejs-compatibility"></a>

### [Node.js 兼容性](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)

- celld 实现 `node:assert`、`node:async_hooks`、`node:buffer`、`node:diagnostics_channel`、`node:events`、`node:fs`、`node:os`、`node:path`、`node:stream`、`node:timers/promises` 和 `node:util`。
- `node:diagnostics_channel` 不向 Tail Worker 导出消息。
- `node:crypto` 不实现 Diffie-Hellman、流式签名、加解密 cipher、RSA-PSS，以及 DSA 签名和密钥生成。
- `KeyObject.toCryptoKey()` 将请求的算法、可导出性和用途应用到非对称密钥。
- `node:zlib` 只实现同步的 gzip 和 deflate 函数。
- `node:fs` 提供 `access`、`mkdir`、`realpath`、`stat`、`lstat` 和 `readFile`。它暴露请求内独立的空 `/tmp`，以及包含 Worker 模块的只读 `/bundle`。
- 全局 `process` 对其已定义的字段与 workerd 一致，例如 `process.execPath`、`process.argv` 和 `process.title`。其他字段，如 `process.kill` 和 `process.features`，未定义。
- celld 打包器支持通过同步 CommonJS `require()` 导入 Node.js 内置模块。原始 ESM Worker 没有全局 `require()`。
- Node.js 内置模块对象可写，因此 `graceful-fs` 等依赖可以在加载时修改它。修改只保留在所在隔离实例中。
- 导入其他 Node.js 模块会成功，但首次调用会抛出错误。

<a id="cache"></a>

### [缓存](https://developers.cloudflare.com/workers/runtime-apis/cache/)

celld 没有共享边缘缓存，因此提供始终未命中的缓存。`put()` 校验并消费响应但不存储，`match()` 返回 `undefined`，`delete()` 返回 `false`。

<a id="tcp-sockets"></a>

### [TCP 套接字](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

- 套接字不能比所属事件存活更久。Durable Object 必须在后续事件中重新连接。
- celld 使用随程序附带的 Mozilla 根证书库验证 TLS 服务器。
- celld 不阻止 Cloudflare 所禁止的目标端口。出站策略由集群网络控制。

<a id="broadcastchannel"></a>

### BroadcastChannel

该类存在，以便打包文件可以加载，但其构造函数会抛出异常。

<a id="compatibility-flags"></a>

## 兼容性标志

celld 实际遵循以下兼容性标志：

- `delete_all_deletes_alarm`
- `js_rpc`
- `fetcher_no_get_put_delete`
- `sqlite_vec`
- `websocket_standard_binary_type`
- 静态资源导航相关标志

celld 接受其他所有标志，但它们不起作用。`Cloudflare.compatibilityFlags` 只报告实际生效的标志。

<a id="wrangler-configuration"></a>

## Wrangler 配置

`celld deploy` 接受 `wrangler.jsonc` 或 `wrangler.json`，不接受 `wrangler.toml`。

`name` 必须由 1 至 63 个小写 ASCII 字母、数字或内部连字符组成，不能以连字符开头或结尾。

接受的顶层字段为：

- `$schema`、`name`、`main` 和 `no_bundle`
- `compatibility_date` 和 `compatibility_flags`
- `durable_objects` 和 `migrations`
- `assets`、`services`、`triggers` 和 `vars`
- `d1_databases`、`kv_namespaces`、`queues`、`workflows` 和 `r2_buckets`
- `worker_loaders` 和 `containers`
- `define` 和 `rules`

其他顶层字段，包括 `routes`，都会停止部署。

`define` 和 `rules` 传递给 esbuild。与 Wrangler 一样，每个 `define` 值都是 JavaScript 表达式。规则的 `type` 必须是 `Text`、`Data` 或 `CompiledWasm`，每个 glob 必须为 `**/*.ext` 或 `*.ext`，因为 esbuild 按扩展名选择加载器。两条规则为同一扩展名指定不同类型时，部署会停止。celld 已对 `**/*.wasm` 应用 `CompiledWasm`，因此 `.wasm` 只接受该类型。`no_bundle` 跳过 esbuild，所以同时配置 `no_bundle` 与 `define` 或 `rules` 会停止部署。

仅包含静态资源的项目可以省略 `main`。`celld deploy` 拒绝不安全的资源路径，使用 `.assetsignore` 则需要 Wrangler。

运行限制请参阅[限制](limitations.md)。
