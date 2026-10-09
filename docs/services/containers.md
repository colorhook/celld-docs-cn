<a id="containers"></a>

# Containers（容器）

容器在需要它的 Worker 旁运行非 JavaScript 程序。Durable Object 启动容器，通过 TCP 端口访问它，并负责停止它。容器磁盘是临时的，因此持久化状态应保存在对象存储或其他绑定中。celld 中的容器功能仍处于实验阶段，配置字段、`ctx.container` API、节点默认设置和安全边界都可能随时变化。标准 API 请参阅 [Cloudflare Containers 文档](https://developers.cloudflare.com/containers/)。

<a id="example"></a>

## 示例

[Containers 示例](../../examples/container) 启动 Python HTTP 服务器，并通过容器端口访问它。

<!-- celld-example: container -->

<a id="the-object-and-its-container"></a>

## 对象与容器

`containers` 配置项指定同一脚本中一个使用 SQLite 存储的 Durable Object 类。该类的每个对象都会获得 `ctx.container` 句柄，最多控制一个容器。

celld 实现了以下 `ctx.container` 功能：

- `start()` 启动容器，接受 `entrypoint`、`env`、`enableInternet` 和 `labels`。
- `running` 报告容器引擎中的状态，因此即使对象失去了 `monitor()`，也能在下一次事件时发现容器已经退出。
- `monitor()` 返回在容器退出时完成的 Promise。
- `destroy()` 停止容器，`signal()` 向容器发送信号。
- `getTcpPort(port).fetch()` 向端口发送 HTTP 请求，`getTcpPort(port).connect()` 打开原始套接字。
- `exec()` 在容器中运行进程。
- `setInactivityTimeout()` 设置空闲窗口。

在 Linux 上，`getTcpPort(port)` 通过容器的网桥地址访问所有端口。与 Cloudflare 一样，带 `Upgrade: websocket` 请求头的 fetch 会得到包含 `webSocket` 的 101 响应。节点将失败的 `start()` 记录为 `container_start_failed`。

`@cloudflare/containers` 可以直接使用其发布版本，包括 `sleepAfter` 闹钟、`getContainer()`、`getRandom()` 和 `switchPort()`。`@cloudflare/sandbox` 的发布版本也可在 `cloudflare/sandbox` 镜像上通过 HTTP 和 RPC 传输运行。预览 URL 需要负载均衡器上的通配主机名；隧道在容器内部运行 cloudflared；存储桶挂载使用应用传入的凭据。详见 [sandbox 示例](../../examples/sandbox)。

<a id="the-image-and-the-node"></a>

## 镜像与节点

`celld deploy` 使用 `PATH` 中的 `docker` CLI 或 `CELLD_DOCKER` 指定的 CLI，构建项目中的 Dockerfile，或拉取镜像引用。也可以使用 Podman CLI。镜像保存在集群存储桶中的 `deploy/images/<key>.tar` 下，键由镜像层和配置的哈希生成，因此重新部署未变化的镜像不会上传任何内容。节点在该类的单元首次启动时，将镜像加载到自己的引擎中，之后不会访问镜像仓库。每个包含容器的部署都会附带 `celld-fence` 镜像。

与 Wrangler 一样，`celld deploy` 为 `linux/amd64` 构建和拉取镜像。`CELLD_CONTAINER_PLATFORM` 可选择其他平台。`celld dev` 为本机平台构建，并将镜像保存在本地引擎中。

容器运行在拥有单元的节点上。每个承载容器类的节点都需要 Docker 或 Podman 守护进程。celld 使用 `DOCKER_HOST` 指定的 Unix 套接字，或 Docker、Docker Desktop、OrbStack、Podman 的默认套接字。如果 `DOCKER_HOST` 不是 `unix://` URL，celld 就没有可用的套接字。没有容器引擎的节点不能激活容器类的单元，但仍可承载其他类。

<a id="the-isolation-boundary"></a>

## 隔离边界

默认运行时下，容器共享节点内核，并非虚拟机。celld 移除所有 Linux capabilities，设置 `no-new-privileges`，保留守护进程默认的 seccomp 策略，将容器限制为最多 1024 个进程，并让 PID 1 运行负责回收孤儿进程的 init。同一节点上的两个容器不能互相连接。

首次启动容器前，节点通过 `celld-fence` 镜像的一次性特权容器，在容器网桥上安装 nftables 规则。设置 `enableInternet: true` 的容器可以访问互联网，但不能访问本节点、其他节点、私有地址段 `10/8`、`172.16/12`、`192.168/16`、`100.64/10`，以及链路本地地址段。无法安装规则的节点不会启动任何容器；如果部署由不包含 fence 镜像的 celld 生成，也无法在启用 fence 的节点上启动容器。

`enableInternet: false` 会将容器连接到没有外部路由的内部网桥。在 macOS 上，内部网络无法发布端口，因此 macOS 的 `celld dev` 会保持出站网络启用并记录警告。fence 规则仍然生效。

`CELLD_CONTAINER_RUNTIME` 指定节点上所有容器使用的 OCI 运行时，例如 gVisor 的 `runsc` 或虚拟机运行时 `kata`。`containers` 配置项中的 `runtime` 可为某个类覆盖该设置；Cloudflare 没有这个字段。如果守护进程缺少指定运行时，每次 `start()` 都会返回守护进程错误。运行非自己编写的代码时，应指定为每个容器提供独立内核的运行时，并将密钥保留在 Worker 中。

使用具名运行时的容器会写入 `/etc/resolv.conf`，默认使用 `1.1.1.1` 和 `1.0.0.1`，也可使用 `CELLD_CONTAINER_DNS` 指定的解析器，因为 gVisor 无法访问引擎内置解析器。fence 允许访问公共解析器。默认运行时的容器会继续使用引擎解析器，除非运维者设置 `CELLD_CONTAINER_DNS`。

<a id="sleep-wake-and-the-nodes-resources"></a>

## 休眠、唤醒与节点资源

`setInactivityTimeout()` 设置空闲窗口，默认与 Cloudflare 一样为 10 分钟。单元因空闲被逐出后，容器会在该窗口内继续运行；单元在同一节点上再次激活时会重新连接它。迁移到其他节点、节点重启、重置和节点停止都会销毁容器。在 `celld dev` 中按 Ctrl-C 会销毁容器，同时保留本地状态。

`instance_type` 接受 `lite` 及其旧名 `dev`、`basic`、`standard-1` 及其别名 `standard`、`standard-2`、`standard-3` 和 `standard-4`，CPU 与内存限制遵循 [Cloudflare 限制页面](https://developers.cloudflare.com/containers/platform/limits/)。默认值与 Cloudflare 一样为 `dev`：1/16 个 CPU 和 256 MiB 内存。如果镜像启动解释器，应选择更大的规格。

节点会将每个运行中容器的内存上限计入已承诺内存，因为容器 cgroup 位于节点进程之外。因此，容器较多的节点可能报告没有剩余容量，并开始卸载单元。节点内存上限应至少覆盖当前最大的实例规格，并留有余量。

每个节点在共享容量样本中公布各类正在运行的容器数量。启动前，节点将集群统计数量与自身实时数量汇总，与 `max_instances` 比较。超过上限的启动会失败，节点记录包含限制值的 `container_start_failed`。

<a id="differences-from-cloudflare"></a>

## 与 Cloudflare 的差异

- `containers` 配置项接受 `class_name`、`image`、`name`、`instance_type`、`max_instances` 和 `runtime`。其他字段会停止部署。celld 增加了 `runtime`，接受 `name` 但不使用它。
- celld 将容器放置在单元拥有者节点上。Cloudflare 可以将容器放在与对象不同的位置。
- 承载容器类的节点需要 Docker 或 Podman 守护进程。
- celld 不执行实例规格的磁盘大小限制。
- `max_instances` 通过集群间收敛实现，而不是集中控制，因此集群可能在一次刷新周期内超出上限。`celld dev` 不执行此上限。
- `inspect()`、`snapshotDirectory()`、`snapshotContainer()` 和出站拦截方法会报错。`start()` 校验 `hardTimeout` 后将其忽略，因此小于等于 0 的值会抛出异常，合法值则不起作用。
- `getTcpPort(port).connect()` 返回的套接字，其生命周期与打开它的事件相同，详见 [TCP 套接字](../cloudflare-compat.md#tcp-sockets)。
- 处理函数响应后，`monitor()` Promise 和 `exec()` 进程不会使对象保持活跃。
- 在 macOS 上，节点通过已发布端口访问容器，因此镜像必须用 `EXPOSE` 声明端口。`enableInternet: false` 在 macOS 上不起作用。
- 容器网桥没有 IPv6 地址，fence 也会拒绝 IPv6 链路本地和唯一本地地址段。
- 对象迁移到其他节点会停止容器，因此迁移后的首次 `@cloudflare/sandbox` 调用可能抛出 SDK 的 `OperationInterruptedError`，与 Cloudflare 上容器重启后的情况一样。下一次调用会启动新容器。

[Cloudflare 兼容性](../cloudflare-compat.md#services)页面列出了运行时 API 和不支持的服务。
