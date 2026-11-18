# TPS correction for Windows DSH Desktop 0.2.2-rc.3

The profile bundle registers the existing `tpsCorrectionV2` projection and replaces the Chat composer activity pill. Chat's usage pill continues to use the official token-usage projection. The activity reading is the weighted mean of qualifying completed requests for the current model and provider.

The estimate calibrates observed output against the completed request's recorded output tokens. It excludes the first content batch and the tail after the last content batch. Bursts, cancelled attempts, missing usage and unobserved final content display 暂无法计算 when there is no qualifying reading. This is a receive estimate affected by network buffering and proportional allocation.

The bundle also supplies the independent per-request speed in Trajectory. The existing Cordis IDs and the canonical client module name are preserved. The external module retains the official live tool-result Host service and all client code outside the speed transform. Removing the profile bundle and restarting restores the official trajectory module. The bundle targets the reviewed 0.2.2-rc.3 and leaves the official ASAR intact.
