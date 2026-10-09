<a id="telemetry"></a>

# 遥测

celld 可以为其处理的请求记录追踪和日志。遥测默认关闭，关闭时没有开销。`CELLD_OTEL=1` 会在集群存储桶的 `telemetry/` 前缀下写入 Parquet 文件，DuckDB 可以直接查询。`CELLD_OTEL=http://collector:4318` 将同样的数据发送到 OpenTelemetry 收集器。

数据模式版本为 `v0-unstable`，因此稳定版发布前列名可能变化。每个文件通过对象元数据 `celld-schema` 保存版本；`az://` 存储桶使用 `celld_schema`。

<a id="configuration"></a>

## 配置

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `CELLD_OTEL` | `0` | `0` 关闭遥测；`1` 将 Parquet 写入集群存储桶；HTTP(S) 收集器基础 URL 选择 OTLP/HTTP protobuf。 |
| `CELLD_OTEL_BUCKET` | 集群存储桶 | 为 Parquet 文件指定其他存储桶，使用相同端点和凭据。 |
| `CELLD_OTEL_RETENTION` | `30d` | celld 删除早于该时长的遥测文件。`none` 禁止删除，便于用自己的生命周期规则管理数据。 |
| `CELLD_OTEL_FLUSH_MS` | `300000` | 缓冲事件达到该毫秒数后，celld 写入 Parquet 文件。 |
| `CELLD_OTEL_FLUSH_BYTES` | `5242880` | 缓冲数据的估算字节数达到该值时，在间隔结束前提前刷新。 |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | 标准采样器名称。`traceidratio` 配合 `OTEL_TRACES_SAMPLER_ARG` 可以按比例记录追踪。 |
| `OTEL_EXPORTER_OTLP_HEADERS` | 未设置 | 发给收集器的 `name=value` 头部列表，用逗号分隔。 |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | `10000` | 收集器请求超时，以毫秒为单位。 |
| `OTEL_SERVICE_NAME` | `celld` | 导出资源中的服务名称。 |

存储桶输出需要 `CELLD_BUCKET`，OTLP 输出不需要。

收集器 URL 不能包含查询字符串或片段。celld 在其路径后附加 `/v1/traces` 和 `/v1/logs`，并忽略 `OTEL_EXPORTER_OTLP_ENDPOINT`。

`CELLD_OTEL_SINK` 已移除，设置该变量的节点不会启动。应将收集器基础 URL 放入 `CELLD_OTEL`，或继续使用 `CELLD_OTEL=1` 输出到存储桶。

<a id="what-celld-records"></a>

## 记录的内容

celld 为每个无状态 Worker 请求、每个单元事件（fetch、闹钟、RPC、WebSocket 消息）、每个出站 `fetch()` 和每次单元启动记录一个 span（追踪片段）。span 包含请求 ID、单元、隔离实例、队列等待时间、出站 URL 与状态，以及已知的持久化信息。

每条 `console.log` 输出都会成为日志记录，并关联处理函数的 trace ID 和 span ID，这种关联在 `await` 之后仍然保留。记录通过 `severity_number` 和 `severity_text` 保存控制台方法对应的严重级别（同时用于 OTLP 字段和 Parquet 列），正文只包含消息。

| 方法 | 严重级别编号 | 严重级别文本 |
| --- | --- | --- |
| `console.debug` | `5` | `DEBUG` |
| `console.log`、`console.info` | `9` | `INFO` |
| `console.warn` | `13` | `WARN` |
| `console.error` | `17` | `ERROR` |

较早版本 celld 的日志文件没有严重级别列。混合读取多个版本时，应使用 `union_by_name = true`。

celld 读取入站请求中的 W3C `traceparent` 头，并在出站 `fetch()` 中发送它。格式错误的头会开启新的追踪。Worker 调用 Durable Object 时保持在同一追踪内。

采样器在请求开始时决定是否采样，未采样请求不会记录任何内容。比例 `0` 不记录追踪，`1` 记录全部追踪。中间比例会在每个节点上根据 trace ID 作出相同决定。对于有效但被采样器拒绝的入站上下文，celld 仍会保留：出站 `fetch()` 或 Durable Object 调用沿用 trace ID，生成新的 span ID，并保持采样标志关闭。

负载过高时，celld 会先丢弃遥测，而不是拒绝请求，并统计丢弃量。celld 尚未记录指标。

<a id="query-the-bucket-with-duckdb"></a>

## 使用 DuckDB 查询存储桶

```sql
INSTALL httpfs; LOAD httpfs;
CREATE SECRET celld_telemetry (
  TYPE s3, KEY_ID '...', SECRET '...',
  ENDPOINT 's3.example.com', URL_STYLE 'path'
);
CREATE VIEW traces AS SELECT * FROM
  read_parquet('s3://YOUR-BUCKET/telemetry/traces/*/*/*/*/*/*.parquet');
CREATE VIEW logs AS SELECT * FROM
  read_parquet('s3://YOUR-BUCKET/telemetry/logs/*/*/*/*/*/*.parquet');

-- 耗时最长的请求。
SELECT name, duration_us, trace_id FROM traces
  ORDER BY duration_us DESC LIMIT 20;

-- 错误日志。
SELECT time_unix_us, body FROM logs WHERE severity_number >= 17;

-- 每条日志及写出它的追踪片段。
SELECT l.body, t.name, t.duration_us FROM logs l
  JOIN traces t ON l.trace_id = t.trace_id AND l.span_id = t.span_id;
```

非 AWS 的 S3 兼容端点需要 `URL_STYLE 'path'`。明文 HTTP 端点还需要 `USE_SSL false`。

文件按节点和小时分区：`telemetry/traces/<node>/<yyyy>/<mm>/<dd>/<hh>/<id>.parquet`。

<a id="flushing-and-delivery"></a>

## 刷新与投递

celld 每次刷新写入一个 Parquet 文件，默认在 5 分钟（`CELLD_OTEL_FLUSH_MS=300000`）或缓冲事件估算达到 5 MiB（`CELLD_OTEL_FLUSH_BYTES=5242880`）时触发，以先达到者为准。触发阈值的那条事件可能使批次略微超过目标大小。

如果没有运行合并任务，应保留默认值。默认设置生成较大的文件，但数据最多可能延迟 5 分钟。`CELLD_OTEL_FLUSH_MS=5000` 设置五秒间隔，另加上传或收集器延迟。短间隔会产生大量小文件，数小时内便可能拖慢查询，因此应先启动合并任务。需要接近实时的视图时，可以使用 OTLP 输出，并采用相同的短间隔。

发生临时失败（HTTP 408、429、502、503 或 504）时，OTLP 输出对每个批次最多尝试五次，采用带随机抖动的指数退避，并遵循 `Retry-After`，每次延迟最多 30 秒。永久拒绝会丢弃批次。

导出器保留一个正在重试的批次，输入通道最多容纳 8192 个新事件。通道满时，celld 丢弃并统计新增遥测，使请求处理继续进行。

保留期清理在启动时运行，并在每次清理完成六小时后再次运行。

<a id="compaction"></a>

## 文件合并

celld 不会合并自己的遥测文件。应在维护节点上每小时运行一次合并任务，处理刚刚结束的那个小时。不要合并当前小时，因为节点仍在写入。

```sql
COPY (
  SELECT * FROM
    read_parquet('s3://YOUR-BUCKET/telemetry/traces/<node>/2026/08/09/22/*.parquet')
  ORDER BY start_unix_us
) TO 's3://YOUR-BUCKET/telemetry/traces/<node>/2026/08/09/22/compacted.parquet'
  (FORMAT parquet, COMPRESSION zstd);
```

DuckDB 写出合并文件后，再删除源文件。
