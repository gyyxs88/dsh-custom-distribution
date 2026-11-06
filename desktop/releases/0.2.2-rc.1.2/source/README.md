# 本版源码与来源

新 compat 的完整七文件输入在 `../build-inputs/dsh-desktop-compat`，版本 `0.2.2-rc.1.2`。`compat.patch` 是相对旧冻结 `sources/dsh-desktop-0.2.2-rc.1.1/build-inputs/packages/dsh-desktop-compat` 的四文件最小差异；未修改旧输入。

其余五包沿用 `../../0.2.2-rc.1.1/manifest.json` 的相同版本、文件名和 SHA256；相关上游来源、许可和旧重现方法见该目录 `source/README.md`。不把旧源码树复制到本版。两项精确许可与原 manifest 完全一致。

在仓库根运行：

```text
node desktop/releases/0.2.2-rc.1.2/Reproduce.mjs <原始官方app.asar> <全新输出目录>
node desktop/releases/0.2.2-rc.1.2/test/run.cjs <官方Electron.exe> <原始官方app.asar> <全新隔离输出目录>
node --test desktop/releases/0.2.2-rc.1.2/test/contract.test.mjs
```

重现入口只重建 compat，并校对/复用旧五包的固定 hash，不安装依赖或请求 provider。目标测试使用独立环境、内存 mock credentials，传输仅允许 `127.0.0.1`。可加 `--baseline` 离线复现旧冻结 compat 的诊断丢失；基线结果不是新版通过标准。

候选 API 回归与新 bundle 消费者验收分别记录。根因、已证缺陷及历史推断限度见 [ROOTCAUSE](../ROOTCAUSE.md)。
