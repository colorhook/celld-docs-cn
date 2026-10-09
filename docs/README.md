<a id="celld"></a>

# celld

celld 是一个有状态的分布式系统。它在你自己的机器上运行服务端 JavaScript，并将长期状态保存在你拥有的存储桶中：兼容 S3 的对象存储、Google Cloud Storage 或 Azure Blob Storage。JavaScript API 和配置遵循 Cloudflare Workers，涵盖 Workers、Durable Objects、KV、Queues、D1、R2、Workflows、定时触发器和静态资源。

<a id="cells-and-nodes"></a>

## 单元与节点

用 Cloudflare 的术语来说，单元（cell）就是 Durable Object：一个有名称、拥有私有 SQLite 数据库的小型服务器。你可以为每个用户、文档、聊天室或 AI 智能体创建一个单元。单元提供 HTTP 服务、维持 WebSocket 连接、设置闹钟，并发起出站连接。单元之间不共享数据库。每个单元在一个线程上运行：只有第一个请求进入等待时，第二个请求才可能与它交错执行，存储操作则是同步的。

你在每台机器上运行一个 celld 进程。这个进程就是**节点**，共享同一个存储桶的节点组成**集群**（fleet）。任意节点都可以为任意单元提供服务，因此只需启动另一个连接同一存储桶的节点，就能增加容量。

<a id="cell-lifecycle"></a>

## 单元生命周期

单元与 Durable Object 具有相同状态。**驻留**单元位于内存中：执行工作时是**活跃**状态，等待时是**空闲**状态。空闲单元连续 `CELLD_IDLE_EVICT_S` 秒没有工作后，celld 会将它移出内存；遇到内存压力或驻留上限时可能更早移出。未设置 `CELLD_IDLE_EVICT_S` 时，只有内存压力或上限才会移出空闲单元。如果单元仍在原节点保留可休眠 WebSocket 客户端，它就处于**休眠**状态。没有任何节点持有的单元则处于**非活跃**状态：它只是存储桶中的对象，成本几乎为零。所有单元最初都是非活跃的。

单元不会跨这些状态转换保留内存，因此每次激活都会重新执行构造函数。休眠单元的唤醒类似冷启动，但 WebSocket 客户端仍保持连接，单元也留在原节点。

每次激活都可能在存储桶中增加一个新的纪元前缀。只有通过 `CELLD_LTX_RETENTION_SECS` 启用纪元垃圾回收时，celld 才会删除旧前缀；否则单元占用的字节数会随每次激活而增长。详见[纪元垃圾回收](guarantees.md#epoch-gc)。

一个 8 GB 节点可以容纳 1,000 个驻留单元，因此每个驻留单元每月成本约为 0.05 美元。

<a id="ownership-and-durability"></a>

## 所有权与持久性

同一时刻，恰好有一个节点为一个单元提供服务。节点通过向存储桶条件写入一条小记录来认领单元，由存储桶决定谁成功。不需要领导者选举，也没有成员列表。认领如果没有续期就会过期，因此故障机器会释放它的单元。

celld 只有在数据能够经受故障后才响应写入（RPO=0）。`CELLD_DURABILITY` 决定如何证明写入已持久化：

- `bucket`：写入到达存储桶后，节点才响应。每次写入需要一次对象存储往返。
- `fleet`（默认）：节点将每次写入发送到另外一个或两个节点；跟随节点将写入保存到磁盘，或存储桶上传完成后即可响应，以先完成者为准。

单节点没有其他节点可用，因此单节点集群即使采用 `fleet` 模式，也与 `bucket` 模式一样，每次写入都等待存储桶。两个或更多节点更快，因为跟随节点的 fsync 远快于对象存储写入。如果重视写入延迟，应运行至少两个节点。集群故障后只剩一个节点时，会以同样方式回退到存储桶，并保持正确性。如果希望即使有其他节点也让每次写入等待存储桶，请设置 `bucket`。

节点停止后，其他节点会接管它的单元，并先收集停止节点尚未上传的数据。机制与存储桶要求详见 [celld 的保证](guarantees.md)。

<a id="alarms"></a>

## 闹钟

如果事件在其响应边界之前设置闹钟，celld 会等待持久化唤醒条目覆盖该闹钟后，才发送成功响应。之后由 `waitUntil` 设置的闹钟不会延迟其他事件的响应。

休眠单元在其拥有者节点上触发闹钟。一个节点承担唤醒者角色，只唤醒拥有者节点已经停止的单元。

<a id="what-do-you-build-with-cells"></a>

## 可以用单元构建什么

- **实时应用。** 多人游戏、聊天室或协作文档各自对应一个单元。房间不需要锁，也不需要外部消息总线。
- **智能体。** 每个 AI 智能体对应一个单元，将记忆、日程和收件箱保存在自己的 SQLite 数据库中。非活跃智能体的成本几乎为零。
- **分片 Web 应用。** 为每个用户、租户或设备建立一个单元，从一开始就实现应用分片，不存在共享数据库。

<a id="contents"></a>

## 目录

- [单元与节点](#cells-and-nodes)
- [单元生命周期](#cell-lifecycle)
- [所有权与持久性](#ownership-and-durability)
- [闹钟](#alarms)
- [可以用单元构建什么](#what-do-you-build-with-cells)
- [安装](#install)
- [配置对象存储](#configure-object-storage)
- [部署应用](#deploy-an-application)
- [本地开发应用](#develop-an-application-locally)
- [操作 D1、KV 和 R2](#operate-d1-kv-and-r2)
- [启动节点](#start-a-node)
- [添加节点](#add-nodes)
- [向自动扩缩容系统提供信息](#feed-an-autoscaler)
- [关闭节点与滚动发布](#shut-down-and-roll-out-a-node)
- [升级说明](#upgrade-notes)
- [诊断集群](#diagnose-a-fleet)
- [列举 Durable Objects](#list-durable-objects)
- [热点单元过载](#hot-cell-overload)
- [环境变量](#environment-variables)
- [服务](#services)
- [Cloudflare 兼容性](cloudflare-compat.md)
- [celld 的保证](guarantees.md)
- [限制](limitations.md)
- [安全](security.md)
- [遥测](telemetry.md)
- [测试](testing.md)
- [WebAssembly](wasm.md)
- [Python Workers](services/workers.md#python-workers)

<a id="services"></a>

## 服务

每个服务页面都包含可运行示例，以及与 Cloudflare 对应服务的已知差异。

- [Workers](services/workers.md)
- [Durable Objects / 单元](services/durable-objects.md)
- [Durable Object Facets（子对象）](services/durable-object-facets.md)
- [KV](services/kv.md)
- [Queues（消息队列）](services/queues.md)
- [D1](services/d1.md)
- [R2](services/r2.md)
- [Workflows（工作流）](services/workflows.md)
- [Cron Triggers（定时触发器）](services/cron-triggers.md)
- [静态资源](services/static-assets.md)
- [Dynamic Workers（动态 Workers）](services/dynamic-workers.md)
- [Containers（容器）](services/containers.md)

<a id="install"></a>

## 安装

```sh
curl -fsSL https://celld.dev/install.sh | sh
```

安装器下载 `celld` 二进制文件。复制在进程内部运行，因此节点不需要外部复制器。如果安装器提示，请将 `~/.local/bin` 加入 `PATH`。要安装指定版本，将 `CELLD_VERSION` 设置为其标签，例如 `v0.0.1`；需要回退时，用之前的标签重新运行安装器。每个[发布版本](https://github.com/denoland/celld/releases)都有构建证明，可以通过 `gh attestation verify <asset> --repo denoland/celld` 验证文件。

<a id="configure-object-storage"></a>

## 配置对象存储

`s3://`、`gs://` 和 `az://` 协议名不区分大小写，celld 会忽略 `CELLD_BUCKET` 首尾的空白。

对于兼容 S3 的存储桶，celld 使用标准 AWS 凭据链，包括 EC2 实例角色和 Amazon EKS Pod Identity。使用 Cloudflare R2 时，创建存储桶和具有访问权限的 S3 API 令牌，然后设置：

```sh
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=auto
export S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
export CELLD_BUCKET=s3://YOUR-BUCKET
```

对于 Google Cloud Storage，celld 使用应用默认凭据（Application Default Credentials）。运行 `gcloud auth application-default login`，或将 `GOOGLE_APPLICATION_CREDENTIALS` 指向服务账户密钥，再设置 `CELLD_BUCKET=gs://YOUR-BUCKET`。在 Compute Engine 上，默认实例访问范围只允许读取存储，因此创建实例时应使用 `cloud-platform` 范围。

对于 Azure Blob Storage，存储桶名称就是容器名称：

```sh
export AZURE_STORAGE_ACCOUNT_NAME=YOUR-ACCOUNT
export AZURE_STORAGE_ACCOUNT_KEY=...
export CELLD_BUCKET=az://YOUR-CONTAINER
```

必须且只能配置一种 Azure 凭据方式：账户密钥、托管身份或工作负载身份。系统分配的托管身份只需要账户名称。用户分配的托管身份必须且只能设置 `AZURE_CLIENT_ID`、`AZURE_OBJECT_ID`、`AZURE_MSI_RESOURCE_ID` 中的一个。身份需要 [`Storage Blob Data Contributor`](https://learn.microsoft.com/azure/role-based-access-control/built-in-roles#storage-blob-data-contributor) 角色或同等权限。托管身份可以用于 Azure VM 和 AKS 节点，不能用于 App Service 或 Container Apps；后两者应使用工作负载身份或账户密钥。AKS 工作负载身份环境（`AZURE_AUTHORITY_HOST`、`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_FEDERATED_TOKEN_FILE`）必须使用公有云认证主机 `https://login.microsoftonline.com`。celld 拒绝所有其他已识别的 Azure 配置变量，例如其他凭据来源或端点覆盖。本地使用 Azurite 开发时，设置 `AZURE_STORAGE_USE_EMULATOR=true`。celld 不将 Azurite 认定为可用于集群的存储服务。

`gs://` 和 `az://` 存储桶不使用 `S3_ENDPOINT` 或 `AWS_*` 凭据，celld 也忽略存储区域设置。

存储桶凭据提供整个集群的控制权，务必妥善保管。

存储桶值可以附加键前缀，例如 `s3://YOUR-BUCKET/PREFIX`，让两个集群共享一个存储桶。不带前缀时，对象保存在桶根目录。

存储服务必须提供条件写入、精确范围读取和写后读一致性。Amazon S3、Cloudflare R2、Google Cloud Storage、Tigris 和 Azure Blob Storage 满足要求；Backblaze B2、Hetzner 和 DigitalOcean Spaces 不满足。MinIO 社区版通过存储测试，但尚未获得生产环境验证；不要使用 RELEASE.2025-09-06T17-38-46Z，因为它会拒绝首次部署（denoland/celld#162）。详见 [celld 的保证](guarantees.md)。

<a id="deploy-an-application"></a>

## 部署应用

如果项目包含 Worker 代码，需要将 `esbuild` 安装到 `PATH` 中。然后在 Wrangler 项目中运行 `celld deploy`：

```sh
git clone https://github.com/denoland/celld
cd celld/examples/counter
celld deploy . \
  --bucket "$CELLD_BUCKET" \
  --endpoint "$S3_ENDPOINT" \
  --region "$AWS_REGION"
```

`celld deploy` 接受模块式 Workers、Durable Object 绑定、服务绑定、变量、定时触发器、D1 数据库、KV 命名空间、Queues、R2 存储桶、Workflows、WebAssembly 模块和静态资源。未知的 Wrangler 配置字段会停止部署。完整支持范围详见 [Cloudflare 兼容性](cloudflare-compat.md)。节点在构建部署前会验证每个模块的 SHA-256 摘要。

运行中的节点不需要为新部署重启。每个节点每隔 `CELLD_DEPLOY_POLL_S` 秒（默认 30）读取 `deploy/current.json`，并原地采用新部署。内部监听器上的 `POST /reload` 会立即采用部署，也会重新构建未变化的部署。在旧部署上开始的请求会在旧部署上完成。如果新部署构建失败，当前部署继续提供服务，节点会在日志和 `/reload` 响应中报告错误。

非活跃 Durable Object 在下次激活时运行新部署。驻留对象在没有活跃请求、闹钟处理函数或普通 WebSocket 时切换，并保留存储和可休眠 WebSocket。切换期间到达的请求等待新代码。对象内部已经运行的请求所发起的出站调用不会等待，因此该请求可以在旧代码上完成。经过 `CELLD_DEPLOY_MAX_AGE_S` 秒（默认 60；0 表示立即强制切换）后，celld 会强制切换：取消运行中的工作，以状态码 1012 关闭普通 WebSocket，与 Cloudflare 一致。切换期间，一个部署上的请求可能调用另一个部署上的 Durable Object，因此相邻两个版本必须兼容彼此的调用。`/state` 报告每个驻留对象的部署。

<a id="develop-an-application-locally"></a>

## 本地开发应用

```sh
celld dev [PROJECT_DIR_OR_CONFIG]
```

此命令启动本地对象存储、部署应用，并运行一个节点。不需要 Docker 或云存储桶。Worker 监听器默认地址为 `http://127.0.0.1:9876`。

| 选项 | 作用 |
| --- | --- |
| `--port PORT` | Worker 监听端口 |
| `--host ADDR` | Worker 监听接口；运维监听器仍使用回环地址 |
| `--logs` | 显示节点的警告和信息日志 |
| `--clean` | 启动前删除 `.celld/dev` |
| `--watch-ignore GLOB` | 额外忽略一个相对于项目的 glob，可重复使用，不能与 `--no-watch` 同时使用 |
| `--no-watch` | 禁用自动构建和重启 |

设置 `NO_COLOR` 禁用颜色，或通过 `FORCE_COLOR` 在输出不是终端时启用颜色。`NO_COLOR` 优先。

与 `wrangler dev` 一样，命令读取 Wrangler 配置旁的 `.dev.vars`。没有 `.dev.vars` 时，依次读取 `.env` 和 `.env.local`，后者覆盖前者。每个 `NAME=value` 项成为 Worker 变量，并覆盖 `vars`。行可以以 `export` 开头，带引号的值可以跨多行，例如 PEM 密钥。不支持值后注释和变量引用。在 `.env` 文件中，名称不是合法绑定名，或与其他绑定冲突的项，会被跳过并发出警告；在 `.dev.vars` 中，这种项会停止构建。`celld deploy` 不读取这些文件。应将 `.dev.vars`、`.env`、`.env.local` 和 `.celld/` 加入 `.gitignore`。

命令将本地状态保存在 `.celld/dev` 中，重启或修改配置后仍然保留。celld 不迁移已存储状态，因此旧配置写入的值可能导致应用失败，错误看起来却与修改无关。使用 `--clean` 可以从空状态启动；它不会删除 `.celld` 下的其他内容。

命令监听项目目录，在源码、配置或 dotenv 文件变化时重新构建。构建期间当前应用继续服务，构建失败不会替换它。监听器在各层目录中忽略 `.celld`、`.git`、`.wrangler`、`node_modules` 和 `target`，也不监听项目之外的文件。

本地对象存储不能用于集群节点或运维子命令，后两者需要受支持的云存储桶。

<a id="operate-d1-kv-and-r2"></a>

## 操作 D1、KV 和 R2

这些命令使用集群存储桶。`celld d1` 和 `celld kv` 通过节点访问数据库单元。

```sh
celld d1 migrations apply ledger --bucket "$CELLD_BUCKET"
celld kv bulk put sessions wrangler-export.json --bucket "$CELLD_BUCKET"
```

`migrations_dir` 必须是项目内部的相对路径，不能包含 `..` 路径段。KV 批量命令使用 Wrangler 文件格式。`celld kv bulk get` 以流式方式输出；具名输出文件只在导出完成后更新，标准输出导出失败则会留下不完整的 JSON 数组。

`celld r2` 读写 `r2_buckets` 绑定在保留前缀 `r2/<bucket_name>/` 下的对象。不需要运行中的节点，因此发布流水线可以在部署之前上传构建产物。

```sh
celld r2 put assets app.zip --path dist/app.zip \
  --content-type application/zip \
  --metadata '{"release":"1.2.3"}' \
  --bucket "$CELLD_BUCKET"
```

第一个参数是 `bucket_name`，不是绑定名。`--metadata` 对应 `customMetadata`，内容相关选项对应 `httpMetadata`。其他工具写入此前缀的对象也可以读取，但没有 `cacheExpiry` 或校验和。`celld r2 get` 将对象体流式写入标准输出，`celld r2 head` 打印存储记录；使用 `--json` 时，`http` 和 `custom` 字段分别包含 `httpMetadata` 和 `customMetadata`。

`celld kv list` 和 `celld r2 list` 最多打印 1000 个键，并在标准错误中给出继续列举所需的 `--after KEY`。使用 `--all` 列出所有键，使用 `--json` 为每个键输出一行 JSON 对象。

所有 celld 命令都将数据写入标准输出，将消息写入标准错误。标准输出管道关闭被视为成功停止。

<a id="start-a-node"></a>

## 启动节点

本地开发使用默认监听器即可：

```sh
celld \
  --bucket "$CELLD_BUCKET" \
  --endpoint "$S3_ENDPOINT" \
  --region "$AWS_REGION"
```

集群节点应分别绑定公共和内部监听器：

```sh
celld \
  --bucket "$CELLD_BUCKET" \
  --endpoint "$S3_ENDPOINT" \
  --region "$AWS_REGION" \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise node-a.internal:8081
```

`--advertise` 要求显式设置 `--internal-listen`，非回环 `--listen` 也有同样要求。公布的地址必须路由到内部监听器，而不是公共监听器；celld 无法验证这一点。

<a id="add-nodes"></a>

## 添加节点

每个节点使用相同存储桶设置，并拥有各自可访问的 `--advertise` 地址。节点通过存储桶中的租约互相发现，不需要加入命令。

节点间流量没有 TLS，单元 fetch 和 RPC 流量也未签名，内部监听器还提供未认证的运维 API。应将公布地址置于可信私有网络或 WireGuard、Tailscale 等加密覆盖网络中，绝不可将内部监听器暴露到互联网。详见[安全](security.md)。

接收请求的节点负责激活新单元，因此负载均衡器必须将新节点纳入轮转。节点达到驻留上限或遭遇内存压力时，会将激活交给负载最低的其他节点。压力逐出会释放所有权记录（`CELLD_PRESSURE_OWNERSHIP=release`，默认），使单元能够迁移。空闲逐出则保留记录，因此单元在原节点唤醒。空闲逐出必须在 `CELLD_OPERATION_DEADLINE_MS` 内停止运行时，否则单元会保持驻留，直到下一个空闲周期。

新节点也会接收空闲单元。每个节点每隔 `CELLD_REBALANCE_INTERVAL_MS`（默认 5000；`0` 禁用平衡）读取共享集群样本 `fleet/capacity-v1.json`。各节点按 `CELLD_PLACEMENT_WEIGHT`（默认 CPU 数量）比例分配已拥有单元的份额。负载最高的节点每次最多将 32 个空闲单元交给距离目标最远、低于目标的节点，接收者只填充到比目标低 2% 的位置。只有休眠单元会迁移；其可休眠 WebSocket 以状态码 1012 关闭，让客户端重新连接。因此，没有 `CELLD_IDLE_EVICT_S` 的集群只平衡自行休眠的单元。排空中的节点，以及存在冷激活积压（`restoring`）的节点，不接收单元。如果某个节点报告的租约没有权重，迁移会暂停，确保先完成升级到此版本的滚动更新。在任意节点上执行 `POST /rebalance/pause` 可暂停整个集群的平衡，在同一节点上执行 `POST /rebalance/resume` 可恢复。

<a id="feed-an-autoscaler"></a>

## 向自动扩缩容系统提供信息

celld 不会自行扩缩容。外部系统负责启动和停止节点，celld 负责交接单元。

每个节点在存储桶的 `nodes/<node>.json` 中写入租约。租约生命周期为 `CELLD_TTL_MS`（默认 10000），在三分之一处续期。负载块以 `sampled_ms` 标记采样时间，包含 `owned_cells`、`placement_weight`、`resident_cells`、`host_websockets`、`rss_bytes`、`in_use_bytes`、`cpu_percent_x100`、`open_fds`、`pressured`、`memory_headroom`、`shed_cells` 和 `restoring`。`owned_cells` 包含休眠单元；重启节点在读取完自己的所有权记录前会省略它。`resident_cells` 只统计内存中的单元。内存和 CPU 值每秒采样一次。

内部监听器的 `GET /state` 报告实时计数，其 `node_load` 对象就是租约负载块。

| 字段 | 含义 |
| --- | --- |
| `capacity_waiting` | 因驻留上限而排队的激活数；大于零意味着应增加节点 |
| `activation_waiting`、`restoring` | 正在等待或持有许可的冷激活 |
| `owned_cells`、`occupied`、`shedding` | 所有权数量、驻留数量和压力卸载情况 |
| `handed_off`、`rebalanced`、`rebalance_failed` | 已交给其他节点的单元、其中由平衡迁移的单元，以及没有节点接收的平衡迁移 |
| `remote_route_refreshes` | 过期并开始重新查找的缓存路由数；正常租约续期也会增加该值 |
| `allocator` | Rust 分配器字节数：`allocated_bytes`、`resident_bytes`、`mapped_bytes`、`retained_bytes`，不包含 V8 堆 |
| `libc_malloc` | 仅 Linux：SQLite 和 V8 使用的 C 分配器的 `in_use_bytes` 和 `free_bytes` |
| `deployment.isolates`、`deployment.draining` | 各 Worker 脚本（`cells`、`stateless`、`services`）的 `live`、`live_empty`、`retiring`、`freed`、`heap_bytes`、`external_bytes` |

`live_empty` 持续超过 30 秒，意味着隔离实例维护没有运行。`retiring` 持续存在，意味着某个执行片段或请求仍然持有堆。

`capacity_waiting` 大于零或租约报告 `pressured`，都是增加节点的信号。只有所有剩余节点都报告 `memory_headroom`，且 `restoring` 积压较小时，才应缩容。向满载集群排空节点，会使单元在存活节点上保持休眠，之后每次激活都需要卸载一个驻留单元。

公共监听器的 `/.well-known/celld/health` 提供布尔健康状态。排空期间，以及新加入节点尚未稳定前，它会返回 503。

<a id="shut-down-and-roll-out-a-node"></a>

## 关闭节点与滚动发布

celld 收到 SIGTERM 或 SIGINT 后会平滑关闭。健康路径返回 503，新的公共请求收到 503 并关闭连接，已接受请求继续完成。节点按批次交接单元：取消运行中的闹钟（由继任者重试）、证明数据持久化、发布最终快照，再将各所有权记录释放给其他节点。接收节点让单元保持休眠，直到请求到来。如果数据库大于持久性截止时间内可上传的大小（默认 10 秒约 80 MiB），交接不会上传快照。繁忙单元优先迁移。内部监听器的 `POST /shutdown` 启动相同交接。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `CELLD_SHUTDOWN_TOTAL_MS` | 40000 | 完整停止时限。排空令牌等待为其 3/4（30000），交接无进展间隔为其 5/8（25000） |
| `CELLD_RELEASES` | 128 | 并发完整交接数 |
| `CELLD_ACTIVATIONS` | 见[参数表](#environment-variables) | 按需求进行的恢复与启动工作 |
| `CELLD_READY_FLEET_GATE_MS` | 120000 | 首次就绪门控的截止时间；`0` 禁用门控 |

编排器的停止宽限期（systemd 的 `TimeoutStopSec`、Kubernetes 的 `terminationGracePeriodSeconds`）必须大于 `CELLD_SHUTDOWN_TOTAL_MS`，否则 SIGKILL 可能中断交接。celld 在启动时拒绝已移除的 `CELLD_SHUTDOWN_DRAIN_MS` 和 `CELLD_DRAIN_TOKEN_WAIT_MS`。

并发停止不会淹没存活节点：排空节点先认领集群排空令牌，使节点依次交接。节点未能在等待时间内获得令牌时，会在没有令牌的情况下继续。

新进程只有在集群稳定后才报告健康：没有节点正在排空，每个节点都低于内存低水位，恢复积压较小，所有权已平衡。到达 `CELLD_READY_FLEET_GATE_MS` 时，celld 只记录一次 `ready_gate_expired`，但就绪仍然关闭，因此必须设置编排器的发布截止时间。首次健康响应之后，集群状态不再撤销就绪。

交接中断可能留下停止进程的日志，由替代进程恢复。如果恢复连续 30 秒没有响应，另一个进程可以接替它。

远程调用遇到正在转移所有权的单元时，会等待新拥有者，最多等待 `CELLD_OPERATION_DEADLINE_MS`（默认 15000）。celld 只重试能够证明尚未开始的尝试。应用重试结果不明确的 fetch、RPC、D1 或服务操作时，必须保持同一个稳定操作 ID。WebSocket 客户端必须重新连接。

发布新版本时，使用编排器的滚动更新：向一个节点发送 SIGTERM，等待替代节点报告健康，再处理下一个。celld 自行控制交接与就绪节奏。

`POST /shutdown?handoff=preserve` 为保留所有权记录的同节点重启做准备。它取消冷激活，并先上传每个已停止数据库。上传失败时，下一个进程使用正常恢复。内部运维 API 仍为 alpha，任何版本都可能改变，因此运维工具应与 celld 版本配套更新。

<a id="upgrade-notes"></a>

## 升级说明

- **v0.1.0 → v0.2.0：全部停止。** 停止所有 v0.1.0 节点，再启动 v0.2.0。两者使用不同的节点间地址和数据格式，集群不能混用。
- **v0.2.1 → v0.3.0：滚动升级。** 默认持久化模式从 `bucket` 改为 `fleet`。某个节点运行 v0.3.0 后，不要启动 v0.2.x 二进制，除非其关闭日志包含 `node-log close: sealed epoch`，否则降级可能丢失已确认写入。
- **v0.3.0 → v0.4.0：全部停止。** 节点间协议变化，且 v0.3.0 节点无法读取新的 KV 大值，因此混合版本集群可能导致已提交 KV 值不可用。
- **v0.4.0 → v0.4.1：滚动升级。** 最后一个 v0.4.0 节点停止一个租约生命周期后，开始启用分页恢复。此后不要再启动 v0.4.0 二进制，因为它无法恢复分页单元。
- **v0.5.1 → v0.6.0：`fleet` 持久化模式下全部停止。** v0.6.0 节点拒绝连接 v0.5.1 跟随节点启动。`bucket` 模式集群可以滚动升级。
- **v0.6.0 → v0.6.1：滚动升级。** 所有节点都运行 v0.6.1 之前，不要设置 `CELLD_LTX_RETENTION_SECS`、部署 Python Worker，或将 `CELLD_MAX_ASSET_FILE_BYTES` 提高到 25 MiB 以上。在所有节点上取消 `CELLD_LTX_RETENTION_SECS` 后，可以滚动回退到 v0.6.0。
- **v0.6.1 → v0.6.2：滚动升级。** 所有节点运行 v0.6.2 之前，转发的 Durable Object fetch 在拥有者上发生处理函数失败时，调用者可能收到 500 响应。两端均为 v0.6.2 时，则会像本地拥有者一样，拒绝调用者的 `stub.fetch()`。回退到 v0.6.1 也可以滚动进行。

<a id="diagnose-a-fleet"></a>

## 诊断集群

`celld diagnose` 读取节点租约，并探测每个存活节点。它不获取租约，也不改变所有权。可通过 `--peer NODE_ID` 只探测部分节点，此选项可重复。

```sh
celld diagnose \
  --bucket "$CELLD_BUCKET" \
  --endpoint "$S3_ENDPOINT" \
  --region "$AWS_REGION"
```

报告显示过期租约、错误公布地址、不可达节点、认证失败和协议不匹配。每个节点行显示正在进行的冷激活数 `restoring`。滚动更新时，应等待每个节点的 `restoring=0`，再重启下一个节点。

<a id="list-durable-objects"></a>

## 列举 Durable Objects

```sh
celld cell list \
  --bucket "$CELLD_BUCKET" \
  --endpoint "$S3_ENDPOINT" \
  --region "$AWS_REGION"
```

每行是一个 `Class:ID` 作用域。指定类名可以只列举该类，`--json` 则每行输出一个 JSON 对象。实例在首次事件后才出现；只派生了 ID 的实例不会出现。D1 数据库、KV 命名空间和 Workflows 是保留类中的单元，其类名以 `__` 开头。`--json` 输出用 `"reserved": true` 标记它们：

```sh
celld cell list --all --json --bucket "$CELLD_BUCKET" |
  jq -r 'select(.reserved | not) | .scope'
```

命令在 1000 个实例处停止，并在标准错误中打印继续方式：

```
1000 cells shown; more exist. Continue with --after Room:d99d9174b25e46310694dd931b47fbde70a7460bb7b210b546060651ea2ff6e0
```

使用该 `--after SCOPE` 读取下一页，`--limit N` 设置其他页大小，或 `--all` 读取全部（每 1000 个实例发起一次请求，并在标准错误中报告进度）。列表不是快照，但连续使用 `--after` 可以将每个已有实例列举一次。

`celld cell gc --dry-run` 接受相同选项，为每个单元打印纪元垃圾回收可删除的前缀、所占字节数和恢复基底。它不写入任何内容；如果无法读取某个单元，最后会报错退出。

```sh
celld cell gc --dry-run --bucket "$CELLD_BUCKET" --grace-secs 3600
```

实际删除可能稍后发生，也可能永不发生。只有 `CELLD_LTX_RETENTION_SECS` 为正值的节点才会删除，宽限期使用该值，而不是 `--grace-secs`。单元只有处于活跃状态、当前激活已经发生写入，并且分页时本地文件已完整，才会删除。在 `CELLD_LTX_COMPACTION=0` 下，集群节点上的单元会等待交接快照。每轮最多删除一个单元的 64 个纪元。

<a id="hot-cell-overload"></a>

## 热点单元过载

celld 为单个 Durable Object 最多接受 64 个并发 fetch 事件（`CELLD_MAX_CELL_REQUESTS`）。Queue 代理最多接受 256 次并发生产者调用，每个事务最多提交 64 次调用，最多重叠四个事务。

超过上限时，celld 返回 `503`，附带 `Retry-After: 1` 和 `X-Celld-Overload: cell`，且不会启动事件。Queue 响应体为 `{"error":"cell admission refused"}`，捕获的 Queue 生产者错误包含 `cell overload: admission refused`。负载生成器必须将这些响应计为被拒绝的工作。celld 记录 `cell_overload_refused`，包含单元作用域、节点、区域、正在进行的数量和上限。

<a id="environment-variables"></a>

## 环境变量

完整列表（包括高级调优开关）可通过 `celld -h` 查看。变量未设置时采用默认值，布尔变量只接受 `0` 或 `1`。无效值会使 celld 在启动时退出。

| 变量 | 用途 |
| --- | --- |
| `CELLD_BUCKET` | 集群存储桶，可附加键前缀；等同于 `--bucket` |
| `S3_ENDPOINT` | 兼容 S3 的端点；等同于 `--endpoint` |
| `AWS_REGION`、`AWS_DEFAULT_REGION` | 存储区域 |
| `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN` | 显式 AWS 凭据，也支持标准 AWS 凭据链 |
| `GOOGLE_APPLICATION_CREDENTIALS`、`GOOGLE_SERVICE_ACCOUNT_KEY` | `gs://` 存储桶的 Google 凭据，也支持应用默认凭据 |
| `AZURE_STORAGE_ACCOUNT_NAME` | `az://` 存储桶的存储账户 |
| `AZURE_STORAGE_ACCOUNT_KEY` | 存储账户密钥，不能与身份选择器同时使用 |
| `AZURE_AUTHORITY_HOST`、`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_FEDERATED_TOKEN_FILE` | AKS 工作负载身份环境，认证主机必须是 Azure 公有云主机 |
| `AZURE_STORAGE_USE_EMULATOR` | 设为 `true`，使用 Azurite 开发 |
| `CELLD_ADDR` | 公共 Worker 监听器；等同于 `--listen` |
| `CELLD_INTERNAL_ADDR` | 节点间通信及运维监听器；等同于 `--internal-listen` |
| `CELLD_ADVERTISE` | 其他节点可访问的内部地址；等同于 `--advertise` |
| `CELLD_UNSAFE_PUBLIC_ADVERTISE` | 设为 `1`，允许在 `CELLD_ADVERTISE` 中使用字面公共 IP；不会解析 DNS 名称，也不限制内部监听器 |
| `CELLD_NODE` | 显式节点会话 ID：1 至 128 个 ASCII 字母、数字、点、连字符或下划线，但不能为 `.` 或 `..` |
| `CELLD_WATCH` | SQLite 和复制使用的本地工作目录 |
| `CELLD_ESBUILD` | esbuild 可执行文件路径 |
| `CELLD_ACTIVATIONS` | 并发冷单元激活数（默认每个 CPU 8 个，至少 16，最多 128） |
| `CELLD_DEPLOY_POLL_S` | 部署指针轮询间隔，以秒为单位（默认 30） |
| `CELLD_DEPLOY_MAX_AGE_S` | 强制驻留 Durable Object 切换到新部署前等待的秒数（默认 60；0 表示立即强制切换） |
| `CELLD_OPERATION_DEADLINE_MS` | 非恢复操作的时限（默认 15000） |
| `CELLD_MAX_CELL_REQUESTS` | 单个 Durable Object 的并发 fetch 事件数（默认 64） |
| `CELLD_MAX_REQUEST_BODY_BYTES` | 公共 Worker 请求或直接 Durable Object 请求的请求体上限（默认 1 GiB） |
| `CELLD_MAX_RESIDENT_CELLS` | 在准入时执行的驻留单元硬上限 |
| `CELLD_IDLE_EVICT_S` | 空闲单元离开内存并进入休眠前的秒数（未设置时，只有压力或驻留上限才会移出空闲单元） |
| `CELLD_PLACEMENT_WEIGHT` | 本节点相对于其他节点的所有权份额（默认 CPU 数量） |
| `CELLD_REBALANCE_INTERVAL_MS` | 集群采样间隔及样本最大年龄（默认 5000；0 禁用平衡） |
| `CELLD_MAX_RSS_MB` | 压力卸载的内存阈值，依据分配器调整后 RSS 和活跃 cgroup 工作集中的较大值（默认可用内存的 80%；0 禁用阈值和绝对上限） |
| `CELLD_DURABILITY` | `fleet`（默认）：每次写入发给另外一个或两个节点，等它们保存到磁盘或存储桶上传完成后响应。单节点没有其他节点，因此每次写入等待存储桶。`bucket`：始终等待存储桶 |
| `CELLD_LOG_PIPELINE` | 同时进行的集群日志轮次（默认 4） |
| `CELLD_LOG_HEDGE_MS` | 慢日志追加发起第二份副本前的等待时间。默认自适应：近期最慢追加耗时的 4 倍，至少 250 ms。`0` 禁用第二份副本 |
| `CELLD_LTX_TRUNCATE_PAGES` | WAL 达到多少页后在下次检查点截断（默认 128 页，即 512 KiB）。数据库大于 4 MiB 时，等待 WAL 大于数据库再截断。`0` 禁用 |
| `CELLD_LTX_RETENTION_SECS` | 未设置或为 `0`（默认）时，不删除纪元前缀。正值启用[纪元垃圾回收](guarantees.md#epoch-gc)：拥有者删除恢复基底以下的前缀，但保留自身纪元、前一个纪元和年龄小于此秒数的所有纪元。每五分钟最多运行一轮。`CELLD_LTX_HYDRATE_MBPS=0` 时，分页单元永远无法满足条件。纪元垃圾回收跳过 facet 复制流，并要求[写后列举一致性](guarantees.md#what-the-bucket-must-provide) |
| `CELLD_LTX_COMPACTION` | `1`（默认）创建附加的 L1 对象，使接管只需读取数十个对象，而非数千个。混合版本集群的所有节点都能读取 v0.5.2 块对象之前，应在所有节点上设为 `0` |
| `CELLD_LTX_COMPACTION_MIN_TXIDS` | 将 L1 合并加入队列的 TXID 跨度（默认 256） |
| `CELLD_LTX_COMPACTION_MIN_MB` | 将 L1 合并加入队列的 L0 MiB 数（默认 32，最多 64） |
| `CELLD_LTX_COMPACTIONS` | 每个节点的并发 L1 合并数（默认 2） |
| `CELLD_LTX_PAGED` | `1`（默认）：接管大小至少为 `CELLD_LTX_PAGED_MIN_MB` 的恢复链时，首次使用页面才从存储桶读取，而不完整下载。后台填充完成前，缺页会阻塞单元隔离实例，因此大查询可能耗时数分钟。设为 `0` 完整下载所有链。混合集群中有早于 v0.4.1 的节点时，所有节点应设为 `0`，因为旧节点会永久拒绝分页单元。`paged_gate` 日志报告分页何时启用或关闭 |
| `CELLD_LTX_PAGED_MIN_MB` | 开始使用分页恢复的链大小，以 MiB 为单位（默认 256；`0` 对所有链分页） |
| `CELLD_LTX_HYDRATE_MBPS` | 分页单元后台填充速率，单位 MiB/秒，每个节点同时填充一个单元（默认 16；`0` 保持文件稀疏） |
| `CELLD_LTX_DURABILITY_TIMEOUT_SECS` | 单次持久性证明和交接最终快照的时间预算（默认 10）。排队写入最多等待六个预算；慢存储可能需要更长时间 |
| `CELLD_TOKIO_THREADS` | 宿主 Tokio 工作线程数（默认 CPU 数量）。启动时的 `host_runtime` 日志通过 `worker_count` 报告 |
| `RUST_LOG` | 运行时日志过滤器 |

一次 L1 合并在 64 MiB 缓冲区内合并最多 256 个源对象。较大的源对象会溢写到单元本地 LTX 目录中的临时文件，因此节点需要足够空闲磁盘来保存源文件和输出。

以下设置已移除。应从环境中删除，即使值为空或仍为旧默认值：

| 已移除设置 | 当前行为 |
| --- | --- |
| `CELLD_OUTPUT_GATE` | celld 始终等待持久性证明后才确认写入 |
| `CELLD_SHUTDOWN_DRAIN_MS`、`CELLD_DRAIN_TOKEN_WAIT_MS` | 启动时拒绝；改用 `CELLD_SHUTDOWN_TOTAL_MS` |
| `CELLD_OTEL_SINK` | 使用 `CELLD_OTEL=1` 输出到集群存储桶，或将 `CELLD_OTEL` 设为收集器基础 URL 以使用 OTLP |
| `CELLD_AI_BINDING`、`CELLD_AI_URL` | AI 适配器已移除；在应用代码中直接调用服务提供商，并删除 AI 绑定 |
| `CELLD_CLOUD_RESTART_ON_DEPLOY` | 托管部署原地采用新代码；凭据轮换仍可能重启进程 |
| `CELLD_STORAGE_PROBE` | 节点始终检查存储契约；违规阻止启动，原因不明确的传输错误产生警告 |
| `CELLD_EVICTIONS` | 每个节点最多同时进行四次逐出 |
| `CELLD_LOG_CAPTURE_WORKERS` | 每个节点最多使用八个日志捕获工作线程 |
| `CELLD_REBALANCE_BATCH_CELLS` | 每批平衡最多迁移 32 个空闲单元 |
| `CELLD_PRESENCE_SHADOW` | 托管节点发送服务状态和已拥有单元数量；使用 `celld diagnose --read-only` 检查租约 |
| `CELLD_LOG_BUNDLE` | 集群持久化始终将上传内容打包 |
| `CELLD_QUEUE_PRODUCER_GROUP_MS` | Queue 拥有者使用 4 ms 定时器将生产者调用分组 |
| `CELLD_LOG_GROUP_COMMIT_MS` | 存在待处理 Queue 写入时，节点在捕获集群日志前等待 1 ms |
| `CELLD_PACED_HANDOFF` | 节点始终在 `CELLD_SHUTDOWN_TOTAL_MS` 内尝试交接 |
