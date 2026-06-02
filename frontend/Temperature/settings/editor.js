/* =====================================================
   Temperature Layout Settings editor
   - Password gate
   - Move labels (drag) to align with real rooms
   - Draw room-area polygons (click to add vertices, drag to adjust)
   - Save to /api/temperature/config
===================================================== */

const SVG_NS = "http://www.w3.org/2000/svg";
const BUILD = "2026-06-02c (drag-fix)";

const state = {
  layout: { width: 1921, height: 729 },
  rooms: {},          // room_num -> { x, y, max_temp, polygon: [[x,y],...] }
  order: [],          // room numbers in display order
  mode: "move",       // "move" | "draw"
  selected: null,
  scale: 1,
  dirty: false,
};

const els = {};

/* ---------------- Auth ---------------- */
async function checkAuth() {
  try {
    const res = await fetch("/api/settings/status", { cache: "no-store" });
    const data = await res.json();
    return Boolean(data.authed);
  } catch {
    return false;
  }
}

async function login() {
  const pw = els.loginPassword.value;
  els.loginError.textContent = "";
  try {
    const res = await fetch("/api/settings/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      enterEditor();
    } else {
      const data = await res.json().catch(() => ({}));
      els.loginError.textContent = data.error || "Incorrect password";
    }
  } catch {
    els.loginError.textContent = "Could not reach the server";
  }
}

async function logout() {
  await fetch("/api/settings/logout", { method: "POST" }).catch(() => {});
  location.href = "/Temperature/index.html";
}

/* ---------------- Load config ---------------- */
async function loadConfig() {
  const res = await fetch("/api/temperature/config", { cache: "no-store" });
  const data = await res.json();
  state.layout = { width: data.layout.width, height: data.layout.height };
  state.rooms = {};
  state.order = [];
  (data.rooms || []).forEach((r) => {
    state.rooms[r.room] = {
      x: r.x,
      y: r.y,
      max_temp: r.max_temp,
      polygon: Array.isArray(r.polygon) ? r.polygon.map((p) => [p[0], p[1]]) : [],
    };
    state.order.push(r.room);
  });
}

/* ---------------- Rendering ---------------- */
function renderRoomSelect() {
  els.roomSelect.innerHTML = "";
  state.order.forEach((num) => {
    const opt = document.createElement("option");
    opt.value = num;
    const hasArea = state.rooms[num].polygon.length >= 3;
    opt.textContent = `Room ${num}${hasArea ? "  ▱" : ""}`;
    els.roomSelect.appendChild(opt);
  });
  if (state.selected) els.roomSelect.value = state.selected;
}

function renderMarkers() {
  els.markers.innerHTML = "";
  state.order.forEach((num) => {
    const room = state.rooms[num];
    const m = document.createElement("div");
    m.className = "edit-marker";
    if (num === state.selected) m.classList.add("selected");
    m.style.left = room.x + "px";
    m.style.top = room.y + "px";
    m.dataset.room = num;
    m.textContent = num;
    m.addEventListener("pointerdown", (e) => onMarkerDown(e, num));
    els.markers.appendChild(m);
  });
}

function renderAreas() {
  els.areas.innerHTML = "";
  els.areas.setAttribute("viewBox", `0 0 ${state.layout.width} ${state.layout.height}`);

  state.order.forEach((num) => {
    const poly = state.rooms[num].polygon;
    if (poly.length < 2) return;
    const isSel = num === state.selected;
    const shape = document.createElementNS(SVG_NS, poly.length >= 3 ? "polygon" : "polyline");
    shape.setAttribute("points", poly.map((p) => p.join(",")).join(" "));
    shape.setAttribute("class", "edit-area" + (isSel ? " selected" : ""));
    shape.dataset.room = num;
    if (!isSel) shape.addEventListener("pointerdown", () => selectRoom(num));
    els.areas.appendChild(shape);
  });

  // Vertex handles for the selected room (draw mode)
  if (state.mode === "draw" && state.selected) {
    const poly = state.rooms[state.selected].polygon;
    poly.forEach((pt, idx) => {
      const h = document.createElementNS(SVG_NS, "circle");
      h.setAttribute("cx", pt[0]);
      h.setAttribute("cy", pt[1]);
      h.setAttribute("r", 6);
      h.setAttribute("class", "vertex-handle");
      h.dataset.idx = idx;
      h.addEventListener("pointerdown", (e) => onVertexDown(e, idx));
      els.areas.appendChild(h);
    });
  }
}

function renderAll() {
  renderRoomSelect();
  renderMarkers();
  renderAreas();
  els.roomLimit.value = state.selected ? state.rooms[state.selected].max_temp : "";
  updateHint();
  markDirty(state.dirty);
}

function updateHint() {
  if (state.mode === "move") {
    els.modeHint.textContent = "Drag a numbered label to where the room actually is.";
  } else {
    els.modeHint.textContent =
      "Click on the map to add corner points for the selected room. Drag points to adjust.";
  }
  els.drawTools.style.display = state.mode === "draw" ? "" : "none";
}

/* ---------------- Selection / modes ---------------- */
function applySelectionHighlight() {
  els.markers.querySelectorAll(".edit-marker").forEach((m) => {
    m.classList.toggle("selected", m.dataset.room === state.selected);
  });
  els.areas.querySelectorAll(".edit-area").forEach((a) => {
    a.classList.toggle("selected", a.dataset.room === state.selected);
  });
  if (state.selected) {
    els.roomSelect.value = state.selected;
    els.roomLimit.value = state.rooms[state.selected].max_temp;
  }
}

function selectRoom(num) {
  state.selected = num;
  renderAll();
}

function onMarkerDown(event, num) {
  event.preventDefault();
  state.selected = num;

  // In draw mode a marker click just (re)selects the room + shows its handles.
  if (state.mode !== "move") {
    renderAll();
    return;
  }

  // Move mode: update the highlight WITHOUT rebuilding the DOM, otherwise the
  // very element we grabbed gets destroyed and the drag never starts.
  applySelectionHighlight();

  const marker = event.currentTarget;
  let moved = false;

  const move = (e) => {
    moved = true;
    const [x, y] = toImageCoords(e.clientX, e.clientY);
    state.rooms[num].x = x;
    state.rooms[num].y = y;
    marker.style.left = x + "px";
    marker.style.top = y + "px";
    markDirty(true);
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  // Listen on the document (not the marker) so the drag keeps tracking even
  // when the cursor leaves the small marker. Bind both pointer and mouse for
  // maximum browser compatibility.
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

function setMode(mode) {
  state.mode = mode;
  els.modeMove.classList.toggle("is-active", mode === "move");
  els.modeDraw.classList.toggle("is-active", mode === "draw");
  els.canvas.classList.toggle("draw-mode", mode === "draw");
  renderAreas();
  updateHint();
}

function markDirty(dirty) {
  state.dirty = dirty;
  els.saveStatus.textContent = dirty ? "Unsaved changes" : "";
  els.saveStatus.className = "save-status" + (dirty ? " unsaved" : "");
}

/* ---------------- Coordinate helpers ---------------- */
function toImageCoords(clientX, clientY) {
  const rect = els.scaleLayer.getBoundingClientRect();
  let x = (clientX - rect.left) / state.scale;
  let y = (clientY - rect.top) / state.scale;
  x = Math.max(0, Math.min(state.layout.width, x));
  y = Math.max(0, Math.min(state.layout.height, y));
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

/* ---------------- Drawing polygons ---------------- */
function onCanvasClick(event) {
  if (state.mode !== "draw" || !state.selected) return;
  // Ignore clicks that originate on a handle or a marker (handled separately)
  if (event.target.classList && event.target.classList.contains("vertex-handle")) return;
  if (event.target.closest && event.target.closest(".edit-marker")) return;
  const [x, y] = toImageCoords(event.clientX, event.clientY);
  state.rooms[state.selected].polygon.push([x, y]);
  markDirty(true);
  renderAreas();
  renderRoomSelect();
}

function onVertexDown(event, idx) {
  event.preventDefault();
  event.stopPropagation();
  const handle = event.target;
  const poly = state.rooms[state.selected].polygon;

  const move = (e) => {
    const [x, y] = toImageCoords(e.clientX, e.clientY);
    poly[idx] = [x, y];
    handle.setAttribute("cx", x);
    handle.setAttribute("cy", y);
    const shape = els.areas.querySelector(`.edit-area.selected`);
    if (shape) shape.setAttribute("points", poly.map((p) => p.join(",")).join(" "));
    markDirty(true);
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

function undoPoint() {
  if (!state.selected) return;
  state.rooms[state.selected].polygon.pop();
  markDirty(true);
  renderAreas();
  renderRoomSelect();
}

function clearArea() {
  if (!state.selected) return;
  state.rooms[state.selected].polygon = [];
  markDirty(true);
  renderAreas();
  renderRoomSelect();
}

/* ---------------- Save / reset ---------------- */
async function save() {
  const payload = { rooms: {} };
  state.order.forEach((num) => {
    const r = state.rooms[num];
    payload.rooms[num] = {
      x: r.x,
      y: r.y,
      max_temp: r.max_temp,
      polygon: r.polygon,
    };
  });
  try {
    const res = await fetch("/api/temperature/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      alert("Session expired. Please log in again.");
      location.reload();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    markDirty(false);
    els.saveStatus.textContent = "Saved ✓";
    els.saveStatus.className = "save-status saved";
    setTimeout(() => { if (!state.dirty) els.saveStatus.textContent = ""; }, 2500);
  } catch (err) {
    alert("Save failed: " + err.message);
  }
}

async function resetAll() {
  if (!confirm("Reset ALL positions and areas back to defaults? This clears your saved layout.")) return;
  try {
    const res = await fetch("/api/temperature/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rooms: {} }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadConfig();
    state.selected = state.order[0] || null;
    fitLayout();
    renderAll();
    markDirty(false);
  } catch (err) {
    alert("Reset failed: " + err.message);
  }
}

/* ---------------- Scaling ---------------- */
function fitLayout() {
  const vp = els.viewport;
  if (!vp) return;
  const availW = vp.clientWidth;
  const availH = vp.clientHeight;
  if (!availW || !availH) return;
  const scale = Math.min(availW / state.layout.width, availH / state.layout.height);
  state.scale = scale;
  els.scaleLayer.style.width = state.layout.width + "px";
  els.scaleLayer.style.height = state.layout.height + "px";
  els.scaleLayer.style.transform = `scale(${scale})`;
  const sW = state.layout.width * scale;
  const sH = state.layout.height * scale;
  els.scaleLayer.style.left = Math.max(0, (availW - sW) / 2) + "px";
  els.scaleLayer.style.top = Math.max(0, (availH - sH) / 2) + "px";
}

/* ---------------- Wiring ---------------- */
async function enterEditor() {
  els.loginOverlay.classList.add("hidden");
  els.editor.classList.remove("hidden");
  await loadConfig();
  state.selected = state.order[0] || null;
  if (els.layoutImage.complete) fitLayout();
  els.layoutImage.addEventListener("load", fitLayout);
  fitLayout();
  renderAll();
}

function cache() {
  els.loginOverlay = document.getElementById("login-overlay");
  els.loginPassword = document.getElementById("login-password");
  els.loginBtn = document.getElementById("login-btn");
  els.loginError = document.getElementById("login-error");
  els.editor = document.getElementById("editor");
  els.viewport = document.getElementById("layout-viewport");
  els.scaleLayer = document.getElementById("layout-scale");
  els.layoutImage = document.getElementById("layout-image");
  els.areas = document.getElementById("edit-areas");
  els.markers = document.getElementById("edit-markers");
  els.canvas = document.querySelector(".editor-canvas");
  els.roomSelect = document.getElementById("room-select");
  els.roomLimit = document.getElementById("room-limit");
  els.modeMove = document.getElementById("mode-move");
  els.modeDraw = document.getElementById("mode-draw");
  els.modeHint = document.getElementById("mode-hint");
  els.drawTools = document.getElementById("draw-tools");
  els.saveBtn = document.getElementById("save-btn");
  els.resetBtn = document.getElementById("reset-btn");
  els.logoutBtn = document.getElementById("logout-btn");
  els.saveStatus = document.getElementById("save-status");
  els.undoPoint = document.getElementById("undo-point");
  els.clearArea = document.getElementById("clear-area");
}

function bind() {
  els.loginBtn.addEventListener("click", login);
  els.loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  els.modeMove.addEventListener("click", () => setMode("move"));
  els.modeDraw.addEventListener("click", () => setMode("draw"));
  els.roomSelect.addEventListener("change", (e) => selectRoom(e.target.value));
  els.roomLimit.addEventListener("change", (e) => {
    if (!state.selected) return;
    const v = parseFloat(e.target.value);
    if (!Number.isNaN(v)) { state.rooms[state.selected].max_temp = v; markDirty(true); }
  });
  els.undoPoint.addEventListener("click", undoPoint);
  els.clearArea.addEventListener("click", clearArea);
  els.saveBtn.addEventListener("click", save);
  els.resetBtn.addEventListener("click", resetAll);
  els.logoutBtn.addEventListener("click", logout);
  els.scaleLayer.addEventListener("click", onCanvasClick);
  window.addEventListener("resize", fitLayout);
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
}

async function init() {
  cache();
  bind();
  console.log("[Temperature editor] build " + BUILD + " loaded");
  const title = document.querySelector(".editor-header h1");
  if (title && !title.querySelector(".build-badge")) {
    const badge = document.createElement("span");
    badge.className = "build-badge";
    badge.textContent = "build " + BUILD;
    title.appendChild(badge);
  }
  if (await checkAuth()) {
    enterEditor();
  } else {
    els.loginOverlay.classList.remove("hidden");
    els.loginPassword.focus();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
