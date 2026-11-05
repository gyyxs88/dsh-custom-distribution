// MIT-derived official ActivityPill only; no usage or trajectory replacement.
window.__ModuleLoader__.load({id:"dsh-tps-correction",factory:(require)=>{
const react=require("react"),react_dom=require("react-dom"),react_jsx_runtime=require("react/jsx-runtime");
const _deepseek_ai_dsh_client_ui_primitives=require("@deepseek-ai/dsh-client-ui-primitives");
const PANEL_MARGIN=12,PANEL_GAP=8,MEASURE_STYLE={visibility:"hidden",left:0,top:0};
const FULL_READING_TOOLTIP={side:'top',portal:true,delayMs:200,onlyWhenClipped:true};
		var StatsPills_module_css_default = {
			"anchor": "hNGZaa_anchor",
			"label": "hNGZaa_label",
			"pill": "hNGZaa_pill",
			"sep": "hNGZaa_sep"
		};
		var stat_dialog_module_css_default = {
			"details": "xXe6ja_details",
			"panel": "xXe6ja_panel",
			"reasoning": "xXe6ja_reasoning",
			"route": "xXe6ja_route",
			"title": "xXe6ja_title",
			"titleLabel": "xXe6ja_titleLabel",
			"titleRule": "xXe6ja_titleRule",
			"titleValue": "xXe6ja_titleValue"
		};
		function reading(first, second) {
			if (second === null) return {
				label: first,
				text: first
			};
			return {
				label: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					first,
					(0, react_jsx_runtime.jsx)("span", {
						className: StatsPills_module_css_default.sep,
						"aria-hidden": true,
						children: "·"
					}),
					second
				] }),
				text: `${first} · ${second}`
			};
		}
		function usageOutputTokens(usage) {
			if (typeof usage !== "object" || usage === null) return null;
			const value = usage.outputTokens;
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
		}
		function assistantStepReading(node) {
			const timing = node.timing;
			return {
				ttftMs: timing !== void 0 && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
				decodeMs: timing !== void 0 && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
				outputTokens: usageOutputTokens(node.usage)
			};
		}
		function deriveStats(nodes) {
			const turns = /* @__PURE__ */ new Set();
			let steps = 0;
			let llmMs = 0;
			let toolMs = 0;
			let ttftMs = 0;
			let ttftSteps = 0;
			let decodeMs = 0;
			let decodeTokens = 0;
			for (const node of nodes) {
				if (node.kind === "tool-result") {
					if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
					continue;
				}
				if (node.kind !== "assistant") continue;
				turns.add(node.turn);
				steps += 1;
				if (node.timing !== void 0 && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
				const reading = assistantStepReading(node);
				if (reading.ttftMs !== null) {
					ttftMs += reading.ttftMs;
					ttftSteps += 1;
				}
				if (reading.decodeMs !== null && reading.outputTokens !== null) {
					decodeMs += reading.decodeMs;
					decodeTokens += reading.outputTokens;
				}
			}
			return {
				turns: turns.size,
				steps,
				llmMs,
				toolMs,
				ttftMs,
				ttftSteps,
				decodeMs,
				decodeTokens
			};
		}
		function formatDuration(ms, t) {
			const s = ms / 1e3;
			if (s < 60) return t("duration.compactSeconds", { seconds: Math.round(s * 10) / 10 });
			const whole = Math.round(s);
			return t("duration.compactMinutes", {
				minutes: Math.floor(whole / 60),
				seconds: whole % 60
			});
		}
		function useSessionStats(useChat, useProjection) {
			const settledNodes = useChat((s) => s.legacy.nodes);
			const projected = useProjection("sessionStats");
			return (0, react.useMemo)(() => projected ?? deriveStats(settledNodes), [projected, settledNodes]);
		}
		function PlainPill({ stat, icon, label, text }) {
			return (0, react_jsx_runtime.jsx)("span", {
				className: StatsPills_module_css_default.anchor,
				"data-composer-stat": stat,
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: text,
					...FULL_READING_TOOLTIP,
					openOnClick: true,
					children: (0, react_jsx_runtime.jsxs)("span", {
						className: StatsPills_module_css_default.pill,
						children: [icon, (0, react_jsx_runtime.jsx)("span", {
							className: StatsPills_module_css_default.label,
							children: label
						})]
					})
				})
			});
		}
		function DialogPill({ stat, icon, label, text, title, titleValue, children }) {
			const { open, setOpen, rootRef, panelRef, pos } = useStatDialog();
			return (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: StatsPills_module_css_default.anchor,
				"data-composer-stat": stat,
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: text,
					...FULL_READING_TOOLTIP,
					disabled: open,
					children: (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: StatsPills_module_css_default.pill,
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						"aria-label": text,
						onClick: () => {
							setOpen(!open);
						},
						children: [icon, (0, react_jsx_runtime.jsx)("span", {
							className: StatsPills_module_css_default.label,
							children: label
						})]
					})
				}), open && (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					className: stat_dialog_module_css_default.panel,
					role: "dialog",
					"aria-label": title,
					style: pos ?? MEASURE_STYLE,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: stat_dialog_module_css_default.title,
							children: [(0, react_jsx_runtime.jsxs)("span", {
								className: stat_dialog_module_css_default.titleLabel,
								children: [icon, title]
							}), titleValue !== void 0 && (0, react_jsx_runtime.jsx)("span", {
								className: stat_dialog_module_css_default.titleValue,
								children: titleValue
							})]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: stat_dialog_module_css_default.titleRule,
							"aria-hidden": true
						}),
						children
					]
				}), document.body)]
			});
		}
		function useStatDialog() {
			const [open, setOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const pos = (0, _deepseek_ai_dsh_client_ui_primitives.useAnchoredPosition)({
				open,
				anchorRef: rootRef,
				panelRef,
				side: "top",
				gap: PANEL_GAP,
				margin: PANEL_MARGIN
			});
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, open, setOpen, panelRef);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKeyDown = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				const onClick = (e) => {
					if (e.target instanceof Node && rootRef.current?.contains(e.target) !== true && panelRef.current?.contains(e.target) !== true) setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				document.addEventListener("click", onClick, true);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
					document.removeEventListener("click", onClick, true);
				};
			}, [open, setOpen]);
			return {
				open,
				setOpen,
				rootRef,
				panelRef,
				pos
			};
		}
		const ActivityPill = (0, react.memo)(function ActivityPill({ useChat, useProjection, usePerformanceUsage, t }) {
			const mode = usePerformanceUsage((value) => value);
			const stats = useSessionStats(useChat, useProjection);
			const tpsReading = useProjection("tpsCorrectionV2");
const estimate = tpsReading?.estimate;
const speed = "输出速度（估算）: " + (estimate?.version === 2 && estimate.status === "estimated" && Number.isFinite(estimate.tps) && estimate.tps > 0 ? estimate.tps.toFixed(1) + " tok/s" : "暂无法计算");
			const icon = (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGaugeOutlineRegular, {});
			if (mode === "compact") return speed === null ? null : (0, react_jsx_runtime.jsx)(PlainPill, {
				stat: "activity",
				icon,
				...reading(speed, null)
			});
			if (stats.steps === 0) return null;
			const counts = t("stats.counts", {
				turns: stats.turns,
				steps: stats.steps
			});
			const content = {
				stat: "activity",
				icon,
				...reading(counts, speed)
			};
			if (stats.llmMs <= 0 && stats.toolMs <= 0 && stats.ttftSteps <= 0 && speed === null) return (0, react_jsx_runtime.jsx)(PlainPill, { ...content });
			return (0, react_jsx_runtime.jsx)(DialogPill, {
				...content,
				title: t("stats.dialog.title"),
				titleValue: "当前模型合格完成请求加权均值；按接收内容估算，非实时速度",
				children: (0, react_jsx_runtime.jsxs)("dl", {
					className: stat_dialog_module_css_default.details,
					"data-session-stats-details": true,
					children: [
						stats.llmMs > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("stats.dialog.llmTime") }), (0, react_jsx_runtime.jsx)("dd", { children: formatDuration(stats.llmMs, t) })] }),
						stats.toolMs > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("stats.dialog.toolTime") }), (0, react_jsx_runtime.jsx)("dd", { children: formatDuration(stats.toolMs, t) })] }),
						stats.ttftSteps > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: t("stats.dialog.ttft") }), (0, react_jsx_runtime.jsx)("dd", { children: formatDuration(stats.ttftMs / stats.ttftSteps, t) })] }),
						speed !== null && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("dt", { children: "输出速度（估算）" }), (0, react_jsx_runtime.jsx)("dd", { children: speed })] })
					]
				})
			});
		});
return {inject:["slots","configForms"],apply(ctx){
const host=ctx.configForms.get("ui-chat");
const performanceUsage={getSnapshot:()=>host.getSnapshot().value?.performanceUsage??"detailed",subscribe:listener=>host.subscribe(listener)};
ctx.slots.inject("conversation.composer.dock",()=>ctx.slots.register({name:"conversation.composer.dock",id:"activity",priority:-100,order:0,locale:"chat",inject:()=>({hooks:{performanceUsage}})},ActivityPill));
}};
}});
