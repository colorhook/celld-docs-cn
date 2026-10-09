<a id="webassembly"></a>

# WebAssembly

Worker 打包文件可以导入 `.wasm` 文件。与 Wrangler 一样，导入结果是已编译的模块，而不是原始字节。

```js
import addModule from "./add.wasm";

const { exports } = new WebAssembly.Instance(addModule);

export default {
  fetch() {
    return new Response(String(exports.add(2, 3)));
  },
};
```

`celld deploy` 会将每个导入的 wasm 文件上传到打包文件旁边，并为部署标记 `wasm-v1` 特性。早于该特性的节点会拒绝部署，因此混合版本集群会在部署阶段失败，而不是等到处理请求时才失败。

celld 在每个进程中只编译每个 wasm 模块一次，后续的隔离实例和单元激活都会复用它。

<a id="example"></a>

## 示例

[WebAssembly 示例](../examples/wasm) 编译一个 Rust Durable Object，并导入它的 WebAssembly 模块。

<!-- celld-example: wasm -->

<a id="prebuilt-workers"></a>

## 预构建的 Workers

设置 `no_bundle: true` 时，celld 会逐字节保留入口 JavaScript，并在 `main` 所在目录下应用 Wrangler 的默认匹配规则 `**/*.wasm` 和 `**/*.wasm?module`。例如，`main: "./dist/shim.mjs"` 可以从 `dist` 导入 `"./add.wasm"` 或 `"./lib/add.wasm"`，模块名保留这些相对路径。这种模式不需要 esbuild。

扫描也会上传 JavaScript 没有导入的 WASM 文件，因此应使用专门的构建输出目录。扫描会跳过 `.git`、`.celld`、`.wrangler` 和指向目录的符号链接。名称匹配 WASM 规则的符号链接会被拒绝，因此应将文件复制到构建输出目录中。

celld 不实现其他 [Wrangler 模块发现设置](https://developers.cloudflare.com/workers/wrangler/configuration/#find-additional-modules)。它不会发现额外的 JavaScript 模块，也不接受 `rules`、`base_dir` 或 `find_additional_modules`。JavaScript 必须已经完成打包，WASM 导入必须相对于入口目录。

<a id="rust-with-workers-rs"></a>

## 使用 workers-rs 编写 Rust

[workers-rs](https://github.com/cloudflare/workers-rs) 生成 JavaScript 适配文件（shim）和 wasm 文件，该适配文件可作为 `celld deploy` 的普通入口点。

1. 安装构建工具：`cargo install worker-build`。
2. 构建 crate：`worker-build --release`。
3. 将配置指向适配文件：

```jsonc
{
  "name": "my-app",
  "main": "./build/worker/shim.mjs",
  "compatibility_date": "2026-01-01",
}
```

4. 部署：`celld deploy`。

celld 通过适配文件的 Proxy 包装器解析入口点和 Durable Object 类。如果 workers-rs API 依赖的运行时特性不在 [Cloudflare 兼容性](cloudflare-compat.md)支持范围内，该 API 将无法使用。

<a id="dynamic-workers"></a>

## 动态 Workers

在 `modules` 映射中以 `{ wasm: bytes }` 形式将 wasm 传给动态加载的 Worker，Worker 导入时会得到已编译模块。与 workerd 一样，celld 拒绝直接传入裸字节。

```js
const worker = env.loader.load({
  compatibilityDate: "2025-01-01",
  mainModule: "main.js",
  modules: {
    "main.js": `import m from "./add.wasm"; ...`,
    "add.wasm": { wasm: wasmBytes },
  },
});
```

<a id="limits"></a>

## 限制

与 JavaScript 模块一样，wasm 字节也计入部署大小限制。模块无法编译时，导入它的模块会失败，并抛出包含文件名的 `WebAssembly.CompileError`。
