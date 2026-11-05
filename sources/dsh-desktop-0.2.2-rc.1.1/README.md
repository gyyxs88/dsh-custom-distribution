# Desktop 0.2.2-rc.1.1 最终构建源

本轮公开构建源来自主控已接受的 CANDIDATE_READY 库存 39d93feab0a85c048cf3d01863cabcf50892d1f46bb8c953753a69e9642635a5。
build-inputs/packages 保留四个改动包源，build-inputs/work/scripts 和 sources 提供 TPS 的精确生成输入。
其原始字节由 .gitattributes 的本目录 -text 规则保留，并经实际 Git index 导出重建验收。

公开重现入口位于 ../../desktop/releases/0.2.2-rc.1.1/Reproduce.mjs；接受原始官方 ASAR 与全新输出目录。
它使用本目录真实源，配合发行目录中可移植 TPS 输出 guard，重建四包并核对两个原包的完整源码载荷及固定字节。
准确目标、版本、官方身份、许可及来源以 ../../desktop/releases/0.2.2-rc.1.1/manifest.json 与 source/README.md 为准。
旧包内历史 README/示例保持原样；compat 的复制 ID 和 snapshot 请求头补丁已退出，使用官方菜单和 headers hook。
原始本机交接清单、暂存 Reproduce/guard 与过程报告不在公开白名单中，也不作为消费者入口。
