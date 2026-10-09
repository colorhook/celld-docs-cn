<a id="dynamic-workers"></a>

# Dynamic Workers（动态 Workers）

Dynamic Worker 是由运行中的 Worker 在运行时提供、通过 Worker Loader 绑定加载的 Worker 代码，例如客户上传的代码或模型生成的代码。celld 在加载器所在节点上，将代码编译到独立的 V8 隔离实例中。Cloudflare 的此功能处于[公开测试阶段](https://developers.cloudflare.com/changelog/post/2026-03-24-dynamic-workers-open-beta/)，API 可能变化。标准 API 请参阅 [Cloudflare Dynamic Workers 文档](https://developers.cloudflare.com/dynamic-workers/)和 [API 参考](https://developers.cloudflare.com/dynamic-workers/api-reference/)。

<a id="example"></a>

## 示例

[Dynamic Workers 示例](../../examples/dynamic-worker-tails) 加载一个 Worker，并将其调用记录发送给 Tail Worker。

<!-- celld-example: dynamic-worker-tails -->

<a id="api"></a>

## API

- `env.LOADER.get(id, getCode)` 按字符串 ID 加载 Worker，`env.LOADER.load(code)` 加载匿名 Worker。
- `getCode` 返回 `WorkerCode` 对象，包含 `mainModule`、`modules`、`compatibilityDate`、`compatibilityFlags`、`env`、`globalOutbound`、`limits` 和 `tails`。
- `stub.getEntrypoint(name, options)` 返回默认导出或具名 `WorkerEntrypoint` 对应的 Fetcher。
- `stub.getDurableObjectClass(name, options)` 返回 Durable Object 类，例如用于创建 [facet](durable-object-facets.md)。
- `stub.dispose()` 释放加载的 Worker。

<a id="loading-a-worker"></a>

## 加载 Worker

与 Wrangler 一样，`worker_loaders` 配置项只接受 `binding` 名称。如果该配置项设置了 `tails` 或 `limits`，celld 会停止部署。应将它们放在 `WorkerCode` 对象中，或在 `getEntrypoint()` 调用中设置 `limits`。

只有需要编译时，celld 才会调用 `env.LOADER.get(id, getCode)` 的 `getCode` 回调，因此 `getCode` 抛出的异常会在首次使用 Worker 时出现，而不是在 `get()` 时出现。

- `modules` 的值可以是 `{ wasm: bytes }` 这类模块对象，[WebAssembly 页面](../wasm.md#dynamic-workers)展示了这种写法。与 workerd 一样，celld 拒绝裸字节。
- 相对导入以导入方的模块名称为基准，因此映射中包含 `dir/b.js` 时，`dir/a.js` 可以导入 `./b.js`。
- 与 workerd 一样，必须提供 `compatibilityDate`。
- 与 workerd 一样，模块源码总大小默认最多 64 MiB。运维者可以在每个节点上将 `CELLD_MAX_DYNAMIC_WORKER_CODE_BYTES` 设置为更大的字节数。加载的代码不能提高该上限，堆、执行和准入限制仍然适用。
- `WorkerCode.limits` 与 `getEntrypoint()` 同时设置某项限制时，celld 采用较小值。

<a id="the-isolation-boundary"></a>

## 隔离边界

加载后的隔离实例拥有独立上下文和堆，但运行在加载器进程中。它不是另一个进程或虚拟机，因此该边界限制的是代码可访问的范围，不保证防范 V8 逃逸。需要内核级边界时，应通过具名运行时在容器内执行代码，详见 Containers 页面的[隔离边界](containers.md#the-isolation-boundary)。

加载的 Worker 不会获得部署中的任何绑定或 `vars` 项，也不会获得 Worker Loader 绑定，因此不能再加载其他 Worker。它只能访问其 `WorkerCode` 中的 `env`。能力调用通过 RPC 进入加载器的隔离实例。celld 通过函数参数向内部脚本传递宿主操作，从不将它们放入全局变量，因此 `globalThis` 不会暴露这些操作。

`WorkerCode` 省略 `globalOutbound` 时，加载的 Worker 继承加载器的出站策略。设为 `null` 时，`fetch()` 和 `connect()` 会抛出异常。设为 Fetcher 时，每次 `fetch()` 都通过加载器代理。经由 Fetcher 调用 `connect()` 或使用 WebSocket 会抛出异常，因为 celld 服务协议不承载双向隧道。

<a id="lifetime-and-caching"></a>

## 生命周期与缓存

`get(id, getCode)` 在同一个宿主隔离实例的同一个加载器绑定内，按 ID 缓存已编译 Worker，因此模块作用域可以在这些调用之间保留。每个隔离实例、每个节点和每个 `worker_loaders` 配置项都有独立映射，都会重新承担编译开销。Cloudflare 将这种复用描述为可能行为，而非保证。`load(code)` 每次调用都会编译。

代理、入口点、Durable Object 类或运行中的 facet 都会使加载的 Worker 保持存活。ID 映射持有弱引用，因此最后一个引用消失后，垃圾回收器可以释放 Worker，但不保证何时发生；之后的 `get()` 会再次执行 `getCode`。

代理的 `dispose()` 方法释放其加载的 Worker，并从映射中移除 ID。同次加载对应的其他代理不能再发起新调用，正在进行的调用则会完成。

宿主隔离实例退役时，celld 会在进行中的调用结束后丢弃所有加载的 Worker。加载的 Worker 不会比加载器活得更久，重新部署时会再次编译代码。

<a id="differences-from-cloudflare"></a>

## 与 Cloudflare 的差异

- 每个进程最多同时存在 256 个 Dynamic Worker，每个脚本代际最多使用 255 个名额，因此单个加载器无法占满整个进程。所有加载器和脚本共享进程上限，超过任一上限的加载都会抛出异常。
- 进程拒绝已移除的环境变量 `CELLD_MAX_LOADED_WORKERS`。
- `getEntrypoint()` 支持 `props` 和 `limits` 选项，`getDurableObjectClass()` 只支持 `props`。结构化克隆编码后的 `props` 值最多为 1 MiB。
- 作为 `globalOutbound` 的 Fetcher 不能使用 `connect()` 或 WebSocket。
- `WorkerCode.tails` 数组接受服务绑定 Fetcher。Dynamic Worker 的 fetch 调用完成后，每个 Fetcher 收到一个事件。
- 事件包含请求元数据、响应状态、控制台日志、未捕获异常和调用结果。
- celld 为每次调用记录最多 256 KiB 的序列化控制台日志。如果下一条完整记录会超出上限，就停止记录。
- 响应可用后才开始投递 Tail 事件。Tail Worker 失败不会改变响应，celld 会将失败信息写入控制台。
- celld 执行 `WorkerCode.limits` 和 `getEntrypoint()` 调用中的 `cpuMs` 与 `subRequests` 限制，并拒绝 `allowExperimental`。
- `WorkerCode.env` 接受结构化克隆值和服务绑定能力。编码后的值与能力属性总计最多 1 MiB。
- 加载的 Worker 入口点不能转移到其他 Worker，也不支持可等待属性和流水线属性。

[Cloudflare 兼容性](../cloudflare-compat.md#services)页面列出了运行时 API 和不支持的服务。
