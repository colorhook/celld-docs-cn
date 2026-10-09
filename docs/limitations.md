<a id="limitations"></a>

# 限制

celld v0.6.2 是测试版，具有以下运行限制。支持的服务、API 和 Wrangler 配置请参阅 [Cloudflare 兼容性](cloudflare-compat.md)。

<a id="fleets"></a>

## 集群

- 一个集群运行一个应用。celld 没有账户服务、多租户调度器或托管入口。
- 集群将持久化状态存储在兼容 S3 的存储桶、Google Cloud Storage 存储桶或 Azure Blob Storage 容器中。只有 `celld dev` 可以使用本地 SQLite 对象存储。
- 所有权平衡按节点权重统计单元数量，不依据 CPU 或内存使用量。它只迁移休眠单元，因此未配置空闲逐出的集群，只会平衡自行进入休眠的单元。

<a id="networking-and-security"></a>

## 网络与安全

- celld 不终止 TLS。公共 TLS 应在入口代理处终止，内部监听器应置于私有网络或加密覆盖网络上。
- 节点间流量使用明文 HTTP。集群 HMAC 对隧道建立和控制请求进行认证，但不加密数据，因此必须由网络提供保密性。
- 集群存储桶控制整个集群。其凭据应只具有一个集群的访问权限，详见[安全](security.md)。

<a id="object-storage-credentials"></a>

## 对象存储凭据

- 各服务提供商的凭据方式不同，详见[配置对象存储](README.md#configure-object-storage)。
- Azure 身份认证仅支持 Azure 公有云。Azure App Service 或 Azure Container Apps 提供的托管身份不可用；在这些环境中应使用工作负载身份或存储账户密钥。

<a id="websockets"></a>

## WebSocket

- Durable Object 的出站 WebSocket 会使单元保持驻留。单元迁移到其他节点时，连接会关闭，因此应用必须保存连接意图并重新连接。
- 节点会限制驻留单元和出站 WebSocket 的数量。

<a id="platforms"></a>

## 平台

- 安装器提供 Linux x86-64、Linux ARM64 和 Apple Silicon 的二进制文件。不支持 Windows。
