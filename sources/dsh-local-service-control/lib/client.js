window.__ModuleLoader__.load({
  id: "dsh-local-service-control",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const jsx = require("react/jsx-runtime");
    const react = require("react");

    const css = ".dshSvc_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:18px}.dshSvc_intro{display:flex;align-items:flex-start;gap:12px}.dshSvc_mark{width:10px;height:10px;margin-top:6px;border-radius:999px;background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 5px color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);flex:none}.dshSvc_intro h2,.dshSvc_intro p,.dshSvc_card h3,.dshSvc_card p{margin:0}.dshSvc_intro h2{font-size:17px;line-height:24px;font-weight:650}.dshSvc_intro p{margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.dshSvc_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:18px;box-shadow:var(--dsw-shadow-lv1)}.dshSvc_cardTop{display:flex;align-items:center;justify-content:space-between;gap:12px}.dshSvc_card h3{font-size:14px;line-height:20px;font-weight:650}.dshSvc_badge{border-radius:999px;padding:3px 9px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);font-size:11px;line-height:17px;font-weight:600}.dshSvc_card p{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dshSvc_actions{display:flex;align-items:center;gap:10px;margin-top:18px}.dshSvc_button{min-height:36px;border-radius:8px;padding:7px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .14s ease,border-color .14s ease,transform .14s ease}.dshSvc_button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.dshSvc_button:active:not(:disabled){transform:translateY(1px)}.dshSvc_button:disabled{cursor:wait;opacity:.55}.dshSvc_restart{border:1px solid var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-reverse)}.dshSvc_restart:hover:not(:disabled){filter:brightness(1.05)}.dshSvc_shutdown{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,var(--dsw-alias-border-l2));background:transparent;color:var(--dsw-alias-state-error-primary)}.dshSvc_shutdown:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}.dshSvc_notice{min-height:20px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dshSvc_notice[data-tone=error]{color:var(--dsw-alias-state-error-primary)}.dshSvc_notice[data-tone=success]{color:var(--dsw-alias-state-success-primary)}@media (width<=560px){.dshSvc_actions{align-items:stretch;flex-direction:column}.dshSvc_button{width:100%}}";
    const tagId = "dsh-local-service-control/service-control.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-local-service-control";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    const ENDPOINT = "/api/local-service-control";
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function readStatus() {
      const response = await fetch(`${ENDPOINT}/status`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return response.json();
    }

    async function waitForRestart(previousPid) {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await wait(750);
        try {
          const current = await readStatus();
          if (current.pid !== previousPid) {
            window.location.reload();
            return;
          }
        } catch {}
      }
      throw new Error("restart timeout");
    }

    async function waitForShutdown() {
      const deadline = Date.now() + 30_000;
      let failures = 0;
      while (Date.now() < deadline) {
        await wait(500);
        try {
          await readStatus();
          failures = 0;
        } catch {
          failures += 1;
          if (failures >= 2) return;
        }
      }
      throw new Error("shutdown timeout");
    }

    const zh = {
      nav: "服务",
      title: "DSH 服务",
      intro: "在此管理本机 DSH 后台进程。操作不会删除会话、设置或凭据。",
      local: "本机 DSH",
      running: "运行中",
      warning: "重启或关闭会中断当前正在运行的任务，请先保存重要结果。",
      restart: "重启 DSH",
      shutdown: "关闭 DSH",
      restartConfirm: "确认重启 DSH？所有当前正在运行的任务会被中断，页面将在服务恢复后自动刷新。",
      shutdownConfirm: "确认关闭 DSH？所有当前正在运行的任务会被中断，关闭后需要从项目启动脚本重新启动。",
      restarting: "正在重启 DSH，连接恢复后页面会自动刷新…",
      stopping: "正在关闭 DSH…",
      stopped: "DSH 已关闭，现在可以关闭此页面。",
      failed: "操作未完成，请检查服务日志后重试。"
    };
    const en = {
      nav: "Service",
      title: "DSH service",
      intro: "Manage the local DSH background process. Sessions, settings, and credentials are preserved.",
      local: "Local DSH",
      running: "Running",
      warning: "Restarting or shutting down interrupts active tasks. Save important results first.",
      restart: "Restart DSH",
      shutdown: "Shut down DSH",
      restartConfirm: "Restart DSH? Active tasks will be interrupted and this page will refresh after the service returns.",
      shutdownConfirm: "Shut down DSH? Active tasks will be interrupted. Use the project start script to start it again.",
      restarting: "Restarting DSH. This page will refresh when the service returns…",
      stopping: "Shutting down DSH…",
      stopped: "DSH is shut down. You can close this page.",
      failed: "The action did not complete. Check the service log and try again."
    };

    function ServiceControlSection({ t }) {
      const [state, setState] = react.useState({ status: "idle", action: null });
      const busy = state.status === "working";

      const run = async (action) => {
        const confirmation = action === "restart" ? t("restartConfirm") : t("shutdownConfirm");
        if (!window.confirm(confirmation)) return;
        setState({ status: "working", action });
        try {
          const response = await fetch(`${ENDPOINT}/${action}`, {
            method: "POST",
            headers: { "x-dsh-service-control": "1" },
            credentials: "same-origin",
            cache: "no-store"
          });
          const result = await response.json();
          if (!response.ok || result.accepted !== true) throw new Error(`action ${response.status}`);
          if (action === "restart") await waitForRestart(result.pid);
          else {
            await waitForShutdown();
            setState({ status: "stopped", action });
          }
        } catch {
          setState({ status: "error", action });
        }
      };

      const message = state.status === "working"
        ? t(state.action === "restart" ? "restarting" : "stopping")
        : state.status === "stopped"
          ? t("stopped")
          : state.status === "error"
            ? t("failed")
            : "";
      const tone = state.status === "error" ? "error" : state.status === "stopped" ? "success" : "neutral";

      return jsx.jsxs("section", {
        className: "dshSvc_section",
        "data-service-control": true,
        children: [
          jsx.jsxs("header", {
            className: "dshSvc_intro",
            children: [
              jsx.jsx("span", { className: "dshSvc_mark", "aria-hidden": "true" }),
              jsx.jsxs("div", { children: [
                jsx.jsx("h2", { children: t("title") }),
                jsx.jsx("p", { children: t("intro") })
              ] })
            ]
          }),
          jsx.jsxs("div", {
            className: "dshSvc_card",
            children: [
              jsx.jsxs("div", { className: "dshSvc_cardTop", children: [
                jsx.jsx("h3", { children: t("local") }),
                jsx.jsx("span", { className: "dshSvc_badge", children: t("running") })
              ] }),
              jsx.jsx("p", { children: t("warning") }),
              jsx.jsxs("div", { className: "dshSvc_actions", children: [
                jsx.jsx("button", {
                  type: "button",
                  className: "dshSvc_button dshSvc_restart",
                  disabled: busy || state.status === "stopped",
                  onClick: () => run("restart"),
                  children: t("restart")
                }),
                jsx.jsx("button", {
                  type: "button",
                  className: "dshSvc_button dshSvc_shutdown",
                  disabled: busy || state.status === "stopped",
                  onClick: () => run("shutdown"),
                  children: t("shutdown")
                })
              ] })
            ]
          }),
          jsx.jsx("p", {
            className: "dshSvc_notice",
            "data-tone": tone,
            role: state.status === "error" ? "alert" : "status",
            "aria-live": "polite",
            children: message
          })
        ]
      });
    }

    const NS = "settings.serviceControl";
    const inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "local-service-control: dictionaries");
      const t = ctx.locale.bind(NS);
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "service-control",
        order: 20,
        label: () => t("nav"),
        locale: NS
      }, ServiceControlSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
