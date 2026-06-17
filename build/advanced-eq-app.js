const eqChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");
function WindowControlsAef() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return /* @__PURE__ */ React.createElement("div", { style: { width: 84 } });
  const act = (e, name) => {
    e.currentTarget.blur();
    window.electronAPI.winAction(name);
  };
  const suppressFocus = (e) => e.preventDefault();
  return /* @__PURE__ */ React.createElement("div", { className: "window-controls", "aria-label": "Window controls" }, /* @__PURE__ */ React.createElement("button", { className: "window-control", onMouseDown: suppressFocus, onClick: (e) => act(e, "minimize"), title: "Minimize", "aria-label": "Minimize" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "-")), /* @__PURE__ */ React.createElement("button", { className: "window-control", onMouseDown: suppressFocus, onClick: (e) => act(e, "maximize"), title: "Maximize", "aria-label": "Maximize" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\u25A1")), /* @__PURE__ */ React.createElement("button", { className: "window-control close", onMouseDown: suppressFocus, onClick: (e) => act(e, "close"), title: "Close", "aria-label": "Close" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\xD7")));
}
function AdvancedEqApp() {
  const [theme, setTheme] = useState("default");
  useEffect(() => {
    eqChannel.postMessage({ type: "ADVANCED_READY" });
    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if ((msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") && msg.theme) {
        setTheme(msg.theme);
      }
    };
    eqChannel.addEventListener("message", handleMessage);
    return () => eqChannel.removeEventListener("message", handleMessage);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  return /* @__PURE__ */ React.createElement("div", { className: "aef-backdrop" }, /* @__PURE__ */ React.createElement("div", { className: "aef-shell" }, /* @__PURE__ */ React.createElement("div", { className: "aef-window" }, /* @__PURE__ */ React.createElement("div", { className: "aef-titlebar" }, /* @__PURE__ */ React.createElement("span", { className: "aef-brand" }, /* @__PURE__ */ React.createElement("svg", { className: "aef-brand-icon", width: "17", height: "17", viewBox: "0 0 24 24", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("g", { stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }, /* @__PURE__ */ React.createElement("line", { x1: "6", y1: "4", x2: "6", y2: "20" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "4", x2: "12", y2: "20" }), /* @__PURE__ */ React.createElement("line", { x1: "18", y1: "4", x2: "18", y2: "20" })), /* @__PURE__ */ React.createElement("g", { fill: "var(--bg2, #1a1a1a)", stroke: "currentColor", strokeWidth: "1.6" }, /* @__PURE__ */ React.createElement("circle", { cx: "6", cy: "9", r: "2.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "14.5", r: "2.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "18", cy: "8", r: "2.3" }))), /* @__PURE__ */ React.createElement("span", { className: "aef-toolbar-label" }, "EQUALIZER")), /* @__PURE__ */ React.createElement(AdvancedViewMenu, { current: "eq" }), /* @__PURE__ */ React.createElement("div", { className: "title-c", style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", flex: "none" } }, "FocusDAW Studio ", /* @__PURE__ */ React.createElement("b", null, "Equalizer")), /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto" } }), /* @__PURE__ */ React.createElement(WindowControlsAef, null)), /* @__PURE__ */ React.createElement("div", { className: "aef-room", style: { display: "grid", placeItems: "center" } }, /* @__PURE__ */ React.createElement("div", { className: "aef-empty" }, "Equalizer module - coming soon.")), /* @__PURE__ */ React.createElement("div", { className: "aef-footer" }, /* @__PURE__ */ React.createElement("span", null, "Equalizer"), /* @__PURE__ */ React.createElement("span", { className: "mono" }, "FocusDAW Studio")))));
}
ReactDOM.render(/* @__PURE__ */ React.createElement(AdvancedEqApp, null), document.getElementById("root"));

