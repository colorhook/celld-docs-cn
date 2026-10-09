<a id="cron-triggers"></a>

# Cron Triggers（定时触发器）

定时触发器按计划运行 Worker。celld 将一个脚本的调度计划保存在一个保留单元中，使集群对每个计划触发时刻执行一次。API 的详细说明请参阅 [Cloudflare Cron Triggers 文档](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

<a id="example"></a>

## 示例

[定时触发器示例](../../examples/cron) 每分钟记录一次计划触发时间。

<!-- celld-example: cron -->

<a id="api"></a>

## API

Worker 导出 `scheduled(controller, env, ctx)` 处理函数。

- `controller.cron` 保存 cron 表达式文本。
- `controller.scheduledTime` 保存本次计划触发时刻，以毫秒为单位。
- `controller.noRetry()` 停止对本次失败执行的重试。
- `ctx.waitUntil()` 延长本次调用。celld 会在下一次调用前等待这些工作全部完成。

<a id="schedules"></a>

## 调度计划

项目在 `triggers.crons` 数组中声明调度计划。表达式格式错误，或配置了 `triggers.crons` 却没有 `main` 时，`celld deploy` 会失败。celld 不限制表达式数量。

celld 使用 Cloudflare 的 cron 方言。表达式包含五个字段：分钟、小时、月内日期、月份和星期。调度精度为一分钟，时区为 UTC。[星期编号从周日开始，范围为 1 至 7](https://developers.cloudflare.com/workers/configuration/cron-triggers/)，因此 `1-5` 表示周日至周四。

每个字段支持 `*`、单个值、`a-b` 范围、`a,b` 列表以及 `/n` 步长。月份和星期字段还支持不区分大小写的三字母名称，例如 `JAN` 和 `MON`。月内日期字段支持 `L`、`L-<n>`、`LW`、`L-<n>W` 和 `<d>W`；星期字段支持 `<dow>L` 和 `<dow>#<n>`。当两个日期字段都受限制时，两者取并集，因此 `0 0 1 * MON` 会在每月第一天以及每个周一触发。只有字面值 `*` 才表示该日期字段不受限制。

celld 拒绝 `SAT-SUN` 这类降序范围，以及 `1,*` 这类包含 `*` 的列表。Cloudflare 接受两者，但结果可能不符合直觉。步长不能超过字段的取值跨度，因此分钟字段中的 `*/60` 会失败。

<a id="execution"></a>

## 执行

`controller.scheduledTime` 是计划触发时刻，而不是本次尝试的实际开始时间，因此延迟执行与重试会使用同一个计划分钟。celld 对同一个脚本的处理函数依次执行，每次都会先等待该次调用的 `waitUntil()` 工作全部完成，再进行下一次。处理函数耗时超过调度间隔时，会推迟下一次执行。耗时工作应移到[队列](queues.md)或 [Workflow](workflows.md) 中。

处理函数抛出异常后，会在 4 秒后重试；之后每次失败都会将延迟翻倍。celld 在累计六次失败或到达下一次计划触发时刻时停止重试。下一次计划执行不会等待重试，因此如果调度间隔短于退避延迟，就不会发生重试。`controller.noRetry()` 会停止重试。单元所有权转移会丢失尚待执行的重试。

停机后，celld 只补执行一次错过的触发，其余跳过。应用可以根据 `controller.scheduledTime` 计算时间间隔，自行补齐工作。

拥有该保留单元的节点执行计划任务，这个节点可能发生变化。服务绑定目标中的 `triggers.crons` 不会执行，celld 加载此类目标时会记录警告。

<a id="differences-from-cloudflare"></a>

## 与 Cloudflare 的差异

- celld 拒绝 `SAT-SUN` 这类降序范围，以及包含 `*` 的列表。
- 对每个计划触发时刻，整个集群只运行一个处理函数。停机后只补执行一次，其余跳过。
- celld 对同一脚本的处理函数串行执行。失败后会重试到下一次计划触发时刻，除非处理函数调用了 `noRetry()`。
- 服务绑定目标不能运行自己的定时触发器。

[Cloudflare 兼容性](../cloudflare-compat.md#services)页面列出了运行时 API 和不支持的服务。
