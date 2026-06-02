/* =====================================================
   Temperature Monitoring Dashboard - Plant Layout view
   - Live per-room temperature labels on the plant image
   - Optional room-area polygons (drawn in Settings)
   - Hover popup with current + last-24h High/Low
===================================================== */

const LIVE_ENDPOINT = "/api/temperature/live";
const STATS_ENDPOINT = "/api/temperature/stats";
const POLL_INTERVAL_MS = 5000;
const STATS_INTERVAL_MS = 60000;
const SVG_NS = "http://www.w3.org/2000/svg";

let currentFilter = "all";
let roomElements = {};      // room_num -> { wrap, value, poly }
let lastRooms = [];
let stats24h = {};          // room_num -> { hi, lo, count }
let statsWindow = 24;
let layout = { width: 1921, height: 729 };

const viewport = document.getElementById("layout-viewport");
const scaleLayer = document.getElementById("layout-scale");
const roomLayer = document.getElementById("room-layer");
const areaSvg = document.getElementById("room-areas");
const layoutImage = document.getElementById("layout-image");
const tooltip = document.getElementById("temperature-tooltip");

/* ---------- Build label + polygon elements once ---------- */
function buildRooms(rooms) {
  roomLayer.innerHTML = "";
  areaSvg.innerHTML = "";
  areaSvg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  roomElements = {};

  rooms.forEach((room) => {
    let poly = null;
    if (Array.isArray(room.polygon) && room.polygon.length >= 3) {
      poly = document.createElementNS(SVG_NS, "polygon");
      poly.setAttribute("points", room.polygon.map((p) => p.join(",")).join(" "));
      poly.setAttribute("class", "room-area");
      poly.dataset.room = room.room;
      poly.addEventListener("mouseenter", (e) => showTooltip(e, room.room));
      poly.addEventListener("mousemove", moveTooltip);
      poly.addEventListener("mouseleave", hideTooltip);
      areaSvg.appendChild(poly);
    }

    const wrap = document.createElement("div");
    wrap.className = "room-label";
    wrap.style.left = room.x + "px";
    wrap.style.top = room.y + "px";
    wrap.dataset.room = room.room;

    const value = document.createElement("span");
    value.className = "room-temp";
    value.textContent = "-- °C";

    wrap.appendChild(value);
    roomLayer.appendChild(wrap);

    wrap.addEventListener("mouseenter", (e) => showTooltip(e, room.room));
    wrap.addEventListener("mousemove", moveTooltip);
    wrap.addEventListener("mouseleave", hideTooltip);

    roomElements[room.room] = { wrap, value, poly };
  });
}

/* ---------- Apply readings + colours ---------- */
function renderRooms(rooms) {
  let req = 0;
  let out = 0;

  rooms.forEach((room) => {
    const el = roomElements[room.room];
    if (!el) return;
    const { wrap, value, poly } = el;

    wrap.classList.remove("status-ok", "status-out", "status-nodata");
    if (poly) poly.classList.remove("status-ok", "status-out", "status-nodata");

    let statusClass = "status-nodata";
    if (room.temp === null || room.temp === undefined) {
      value.textContent = "-- °C";
    } else {
      value.textContent = `${room.temp} °C`;
      if (room.status === "OUT") {
        statusClass = "status-out";
        out += 1;
      } else {
        statusClass = "status-ok";
        req += 1;
      }
    }
    wrap.classList.add(statusClass);
    if (poly) poly.classList.add(statusClass);
  });

  document.getElementById("count-req").textContent = req;
  document.getElementById("count-out").textContent = out;

  applyFilter();
}

/* ---------- Filtering ---------- */
function filterRooms(mode) {
  currentFilter = mode;
  document.querySelectorAll(".controls .btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.filter === mode);
  });
  applyFilter();
}
window.filterRooms = filterRooms;

function applyFilter() {
  Object.values(roomElements).forEach(({ wrap, poly }) => {
    let show = true;
    if (currentFilter === "req") show = wrap.classList.contains("status-ok");
    else if (currentFilter === "out") show = wrap.classList.contains("status-out");
    wrap.classList.toggle("filtered-out", !show);
    if (poly) poly.classList.toggle("filtered-out", !show);
  });
}

/* ---------- Tooltip (current + 24h Hi/Low) ---------- */
function fmt(v) {
  return v === null || v === undefined ? "--" : `${v} °C`;
}

function showTooltip(event, roomNum) {
  const room = lastRooms.find((r) => r.room === roomNum);
  if (!room) return;
  const s = stats24h[roomNum];
  const statusText =
    room.status === "OUT" ? "Over limit" : room.status === "OK" ? "Within limit" : "No data";

  const statusCls =
    room.status === "OUT" ? "tt-out" : room.status === "OK" ? "tt-ok" : "tt-nd";

  const hiLow = s
    ? `<div class="tt-row">
         <span class="tt-hi">▲ High ${fmt(s.hi)}</span>
         <span class="tt-lo">▼ Low ${fmt(s.lo)}</span>
       </div>
       <span class="tt-meta">${statsWindow}h range · ${s.count} readings</span>`
    : `<span class="tt-meta">No ${statsWindow}h history yet</span>`;

  const areaRow = room.area_px
    ? `<span class="tt-meta">Area ${Math.round(room.area_px).toLocaleString()} px²</span>`
    : "";

  tooltip.innerHTML = `
    <div class="tt-head">
      <strong>Room ${room.room}</strong>
      <span class="tt-badge ${statusCls}">${statusText}</span>
    </div>
    <span class="tt-temp">${fmt(room.temp)}</span>
    ${hiLow}
    <span class="tt-meta">Limit ${room.max_temp} °C</span>
    ${areaRow}
    ${room.updated ? `<span class="tt-meta">Updated ${room.updated}</span>` : ""}
  `;
  tooltip.classList.add("open");
  moveTooltip(event);
}

function moveTooltip(event) {
  const pad = 16;
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight) y = event.clientY - rect.height - pad;
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
}

function hideTooltip() {
  tooltip.classList.remove("open");
}

/* ---------- Responsive scaling (pixel-accurate to layout image) ---------- */
function fitLayout() {
  if (!viewport) return;
  const availW = viewport.clientWidth;
  const availH = viewport.clientHeight;
  if (!availW || !availH) return;

  const scale = Math.min(availW / layout.width, availH / layout.height);
  scaleLayer.style.width = layout.width + "px";
  scaleLayer.style.height = layout.height + "px";
  scaleLayer.style.transform = `scale(${scale})`;

  const scaledW = layout.width * scale;
  const scaledH = layout.height * scale;
  scaleLayer.style.left = Math.max(0, (availW - scaledW) / 2) + "px";
  scaleLayer.style.top = Math.max(0, (availH - scaledH) / 2) + "px";
}
window.addEventListener("resize", fitLayout);

/* ---------- Live status pill ---------- */
function setLiveStatus(connected, hasData) {
  const pill = document.getElementById("live-status");
  if (!pill) return;
  const text = pill.querySelector(".live-text");
  pill.classList.remove("live-on", "live-off", "live-stored");
  if (connected) {
    pill.classList.add("live-on");
    text.textContent = "Live";
  } else if (hasData) {
    pill.classList.add("live-stored");
    text.textContent = "Stored data";
  } else {
    pill.classList.add("live-off");
    text.textContent = "Offline";
  }
}

/* ---------- Data ---------- */
async function refresh() {
  try {
    const res = await fetch(LIVE_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.layout) {
      layout = { width: data.layout.width, height: data.layout.height };
      if (layoutImage && data.layout.image && layoutImage.dataset.src !== data.layout.image) {
        layoutImage.src = data.layout.image;
        layoutImage.dataset.src = data.layout.image;
      }
    }

    const rooms = data.rooms || [];
    const polyKey = rooms.map((r) => `${r.room}:${(r.polygon || []).length}:${r.x},${r.y}`).join("|");
    const structureChanged = polyKey !== refresh._lastKey || Object.keys(roomElements).length !== rooms.length;

    lastRooms = rooms;
    if (structureChanged) {
      buildRooms(rooms);
      fitLayout();
      refresh._lastKey = polyKey;
    }
    renderRooms(rooms);

    const hasData = rooms.some((r) => r.temp !== null && r.temp !== undefined);
    setLiveStatus(Boolean(data.ws_connected), hasData);
  } catch (err) {
    console.error("Live temperature load failed:", err);
    setLiveStatus(false, lastRooms.length > 0);
  }
}

async function refreshStats() {
  try {
    const res = await fetch(STATS_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    stats24h = data.rooms || {};
    if (data.window_hours) statsWindow = data.window_hours;
  } catch (err) {
    console.error("24h stats load failed:", err);
  }
}

/* ---------- Init ---------- */
function init() {
  if (layoutImage.complete) fitLayout();
  layoutImage.addEventListener("load", fitLayout);
  filterRooms("all");
  refreshStats();
  refresh();
  setInterval(refresh, POLL_INTERVAL_MS);
  setInterval(refreshStats, STATS_INTERVAL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
