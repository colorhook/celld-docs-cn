<a id="security"></a>

# 安全

celld v0.6.2 是测试版，不适合存在恶意租户的多租户场景。只有最新版本会获得安全修复。

<a id="security-boundary"></a>

## 安全边界

一个集群运行一个应用。celld 信任应用代码、集群节点和运维者。应用代码可以使用已配置的绑定，并消耗节点共享资源。不要在同一集群中运行来自彼此不信任租户的代码。

应用代码无法访问引擎的宿主函数。内部脚本通过函数参数接收这些函数，`globalThis` 不包含以 `__` 开头的属性。因此，设置 `globalOutbound: null` 的 Worker Loader 所加载的 Worker，只能通过其 `env` 中的能力访问宿主。

celld 依赖两个外部边界：可信私有网络保护内部监听器，对象存储凭据控制集群。

<a id="separate-the-listeners"></a>

## 分离监听器

celld 打开两个 HTTP 监听器，两者都不终止 TLS。

| 监听器 | 提供的服务 | 必须采取的保护措施 |
| --- | --- | --- |
| `--listen`（公共） | 已部署的 Worker | 在代理或应用中终止 TLS，并对用户进行认证。 |
| `--internal-listen`（默认 `127.0.0.1:0`，自动选择空闲回环端口） | 节点间协议和运维 API | 只允许可信运维者和集群节点访问，绝不可暴露到公共互联网。网络不提供保密性时，使用 WireGuard 或 Tailscale 等加密覆盖网络。 |

`--advertise` 向其他节点提供内部地址。显式设置 `--advertise` 或非回环 `--listen`，却未显式设置 `--internal-listen` 时，celld 会拒绝启动。celld 无法验证主机名或转换后的端口，因此必须由你确保公布的地址路由到内部监听器。

公共监听器只保留 `/.well-known/celld/health`：健康时返回 200 和 `{"ok":true}`，否则返回 503。其他公共路径都由 Worker 管理，包括 `/health`。内部监听器对未知路径返回 404，因此运维请求不会转为应用请求。

内部监听器有三组请求，三组都需要可信私有网络：

- 大多数运维路由没有请求认证。
- `/peer/tunnel` 为单元 fetch、RPC 和 WebSocket 调用建立隧道。建立请求包含集群 HMAC、时钟时限和重放保护。隧道内调用则是未签名的明文 HTTP。
- 节点控制路由和保留单元路由使用集群 HMAC、时钟时限和重放保护，为每个请求签名。

因此，访问运行时类的每条路径都需要集群密钥。HMAC 不认证隧道建立后的字节，也不加密流量，不能替代私有网络。

<a id="use-the-internal-operator-api"></a>

## 使用内部运维 API

运维 API 是 alpha 接口，版本发布时可能改变路径或响应格式。以下路由不认证调用者：

- `/state` 报告节点状态。
- `/cell/<SCOPE>` 解析或激活单元。
- `/evict/<SCOPE>` 尝试逐出驻留单元，并报告结果。
- `/do/<ID>` 向普通 Durable Object 发送直接请求。
- `POST /shutdown` 开始平滑的所有权交接。`handoff=preserve` 为同节点重新加载做准备。

`/do/<ID>` 拒绝所有保留运行时类，例如 D1、Workflows、KV 和 Queues，因为其协议能够访问应用数据。访问这些类应使用经过 HMAC 认证的 `/runtime/<SCOPE>` 路由。

`/peer/probe` 返回签名的诊断响应。不要直接调用其他保留的节点间路径。

<a id="read-an-eviction-result"></a>

### 解读逐出结果

被接受的逐出请求会等待操作完成，被拒绝的请求则立即返回。多个并发调用者可以加入同一次逐出，因此成功次数不等于运行时停止次数。

Rust 方法 `AppHandle::evict` 返回 `Result<EvictSuccess, EvictError>`。`Evicted` 确认运行时已经停止，`AlreadyAbsent` 确认本地已稳定处于缺席状态。需要确认逐出已完成的调用者必须检查 `Evicted`。在 HTTP 中，两者都返回 200 和 `{"ok":true}`。错误上的 `kind()` 和 `reason()` 与 HTTP 错误体对应。响应送达前，后续请求可能已经重新激活单元。

不存在的单元，或已稳定处于 `Inactive`、`Dormant`、`Remote` 状态的单元，在本地都视为缺席。待完成的激活、停止或所有权转移会阻止返回该结果。此请求不会逐出远程运行时。休眠单元保留所有权和休眠的宿主连接。节点在保留状态、重新加载、确认本地清单期间，或缺乏权限时，会拒绝请求。

错误体格式如下：

```json
{"ok":false,"error":{"kind":"refused","reason":"cell_active"}}
```

| 状态码 | 类型 | 原因 | 含义 |
| --- | --- | --- | --- |
| 409 | `refused` | `cell_active` | 单元仍有活跃工作，或有需要运行时的连接。 |
| 409 | `refused` | `cell_transitioning` | 单元正在进行其他生命周期转换。 |
| 409 | `refused` | `alarm_imminent` | 闹钟驻留策略要求保留单元。 |
| 409 | `refused` | `alarm_uncovered` | 闹钟覆盖尚未确认，或内存压力卸载期间正在触发的闹钟阻止逐出。 |
| 503 | `refused` | `node_unavailable` | 节点无法接受此次逐出。 |
| 503 | `refused` | `eviction_limit` | 节点已达到并发逐出上限。 |
| 409 | `cancelled` | `new_activity` | 新请求取消了已接受的逐出。 |
| 409 | `cancelled` | `alarm_activity` | 闹钟观察或触发取消了已接受的逐出。 |
| 409 | `cancelled` | `node_fenced` | 节点在逐出期间失去权限。 |
| 503 | `failed` | `actor_unavailable` | 请求无法到达 Actor。 |
| 500 | `failed` | `reply_lost` | 请求已送达，但回复丢失，结果未知。 |
| 500 | `failed` | `durability_failed` | 持久性验证失败。 |
| 500 | `failed` | `durability_timeout` | 持久性验证超过操作截止时间。 |
| 500 | `failed` | `runtime_stop_failed` | 运行时停止操作报告失败。 |

作用域格式错误时返回 400。错误不能证明运行时仍然驻留。运行时停止没有整体超时，因此如果停止操作始终不返回，请求就会持续等待。

<a id="set-the-forwarded-header-policy"></a>

## 设置转发头策略

celld 默认忽略 `X-Forwarded-Host` 和 `X-Forwarded-Proto`。只有可信代理会替换这两个头时，才应设置 `--trust-forwarded-headers` 或 `CELLD_TRUST_FORWARDED_HEADERS=1`。celld 使用每个头中的最后一个值，因此客户端提前插入的值无法覆盖代理的值。

celld 从请求目标读取路径和查询字符串，并忽略绝对形式请求目标中的协议和 authority。没有可信代理时，`Host` 头决定 `request.url` 中的主机名。celld 接受主机名、IPv4 地址或带方括号的 IPv6 地址，可附带端口；它拒绝格式错误和非规范值，并回退到 `celld.local`。

主机名仍由客户端控制。不要用未经检查的主机名作授权判断。应使用可信代理，或在 Worker 中依据允许列表检查主机名。

<a id="limit-request-bodies"></a>

## 限制请求体

公共监听器和 `/do/<ID>` 默认将请求体限制为 1 GiB。将 `CELLD_MAX_REQUEST_BODY_BYTES` 设置为更小的正值即可降低上限。声明的请求体过大，或 Worker 读取超过上限时，celld 返回 413。

对于 `GET` 和 `HEAD` 之外的方法，`/do/<ID>` 会流式传输长度未知或至少 1 MiB 的请求体；更小的请求体则在分发前完整收集。

<a id="protect-the-fleet-bucket"></a>

## 保护集群存储桶

集群存储桶是权限根源，保存部署、单元状态、所有权和节点租约，以及共享的节点认证密钥。持有存储桶凭据就能控制集群。每份凭据应只具有一个集群存储桶的访问权限，怀疑泄露后应轮换凭据。

<a id="cell-ownership"></a>

## 单元所有权

每个单元都是只有一个写入者的 SQLite 数据库。所有权纪元为每个单元提供隔离保护，因此失去租约的节点无法修改当前状态。这种保护保证存储一致性，并不能隔离恶意应用。详见 [celld 的保证](guarantees.md)和[限制](limitations.md)。
