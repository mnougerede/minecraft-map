const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const typeFiltersEl = document.getElementById("typeFilters");
const selectAllBtn = document.getElementById("selectAll");
const selectNoneBtn = document.getElementById("selectNone");
const invertZEl = document.getElementById("invertZ");
const showGridEl = document.getElementById("showGrid");
const showAxesEl = document.getElementById("showAxes");
const showScaleBarEl = document.getElementById("showScaleBar");

// ---------- Data ----------
let points = [];
let enabledTypes = new Set();
let knownTypes = [];

const STORAGE_TYPES_KEY = "enabledTypes";
const STORAGE_INVERT_KEY = "invertZ";
const STORAGE_SHOW_GRID_KEY = "showGrid";
const STORAGE_SHOW_AXES_KEY = "showAxes";
const STORAGE_SHOW_SCALE_BAR_KEY = "showScaleBar";
const NONE_TYPE = "(none)";

function normalizeType(raw) {
    if (typeof raw !== "string") return NONE_TYPE;
    const t = raw.trim().toLowerCase();
    return t.length ? t : NONE_TYPE;
}

function loadEnabledTypes() {
    try {
        const raw = localStorage.getItem(STORAGE_TYPES_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed);
    } catch {
        // ignore
    }
    return null;
}

function saveEnabledTypes() {
    localStorage.setItem(STORAGE_TYPES_KEY, JSON.stringify([...enabledTypes]));
}

function loadInvertZ() {
    return localStorage.getItem(STORAGE_INVERT_KEY) === "true";
}

function saveInvertZ() {
    localStorage.setItem(STORAGE_INVERT_KEY, String(invertZEl.checked));
}

function loadToggle(key, defaultValue) {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === "true";
}

function saveToggle(key, value) {
    localStorage.setItem(key, String(value));
}

// ---------- View transform (world <-> screen) ----------
const view = {
    // world coords at the centre of the screen
    cx: 0,
    cz: 0,
    // pixels per 1 world unit (block)
    scale: 0.1,
};

function worldToScreen(x, z) {
    const invert = invertZEl.checked;
    const sx = (x - view.cx) * view.scale + canvas.width / 2;
    const sy = (invert ? view.cz - z : z - view.cz) * view.scale + canvas.height / 2;
    return { sx, sy };
}

function screenToWorld(sx, sy) {
    const invert = invertZEl.checked;
    const x = (sx - canvas.width / 2) / view.scale + view.cx;
    const z = invert
        ? view.cz - (sy - canvas.height / 2) / view.scale
        : (sy - canvas.height / 2) / view.scale + view.cz;
    return { x, z };
}

function getVisibleWorldBounds() {
    const a = screenToWorld(0, 0);
    const b = screenToWorld(canvas.width, canvas.height);
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minZ = Math.min(a.z, b.z);
    const maxZ = Math.max(a.z, b.z);
    return { minX, maxX, minZ, maxZ };
}

function niceStep(value) {
    if (value <= 0) return 1;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const f = value / base;
    let nice;
    if (f <= 1) nice = 1;
    else if (f <= 2) nice = 2;
    else if (f <= 5) nice = 5;
    else nice = 10;
    return nice * base;
}

function drawGrid() {
    const bounds = getVisibleWorldBounds();
    const targetPx = 90;
    const step = niceStep(targetPx / view.scale);
    const startX = Math.floor(bounds.minX / step) * step;
    const endX = Math.ceil(bounds.maxX / step) * step;
    const startZ = Math.floor(bounds.minZ / step) * step;
    const endZ = Math.ceil(bounds.maxZ / step) * step;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;

    for (let x = startX; x <= endX; x += step) {
        const { sx } = worldToScreen(x, view.cz);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, canvas.height);
        ctx.stroke();
    }
    for (let z = startZ; z <= endZ; z += step) {
        const { sy } = worldToScreen(view.cx, z);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(canvas.width, sy);
        ctx.stroke();
    }
    ctx.restore();
}

function drawAxes() {
    const bounds = getVisibleWorldBounds();
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;

    if (bounds.minX <= 0 && bounds.maxX >= 0) {
        const { sx } = worldToScreen(0, view.cz);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, canvas.height);
        ctx.stroke();
    }
    if (bounds.minZ <= 0 && bounds.maxZ >= 0) {
        const { sy } = worldToScreen(view.cx, 0);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(canvas.width, sy);
        ctx.stroke();
    }
    ctx.restore();
}

function drawScaleBar() {
    const pad = 12;
    const targetPx = 140;
    const worldLen = niceStep(targetPx / view.scale);
    const pxLen = worldLen * view.scale;
    const x = pad;
    const y = canvas.height - pad - 14;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 6, y - 18, pxLen + 12, 24);
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + pxLen, y);
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = "12px sans-serif";
    ctx.fillText(`${worldLen} blocks`, x, y - 4);
    ctx.restore();
}

function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function getLabelCandidates(sourcePoints, viewState, enabledSet) {
    const visible = [];
    for (const p of sourcePoints) {
        if (!enabledSet.has(p._type)) continue;
        const { sx, sy } = worldToScreen(p.x, p.z);
        if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) continue;
        const key = `${p.name ?? ""}|${p.x}|${p.z}`;
        visible.push({ p, hash: hashString(key), sx, sy });
    }

    visible.sort((a, b) => a.hash - b.hash);

    const zoomAllThreshold = 0.2;
    if (viewState.scale >= zoomAllThreshold) return visible;

    const minLabels = 10;
    const maxLabels = 60;
    const t = Math.max(0, Math.min(1, (viewState.scale - 0.02) / (zoomAllThreshold - 0.02)));
    const n = Math.round(minLabels + t * (maxLabels - minLabels));
    return visible.slice(0, Math.min(n, visible.length));
}

// ---------- Render ----------
function render() {
    // background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (showGridEl.checked) drawGrid();
    if (showAxesEl.checked) drawAxes();

    // points
    ctx.fillStyle = "red";
    ctx.font = "12px sans-serif";

    for (const p of points) {
        if (!enabledTypes.has(p._type)) continue;
        const { sx, sy } = worldToScreen(p.x, p.z);

        // skip if far off-screen (small perf win)
        if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) continue;

        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // labels
    ctx.fillStyle = "white";
    ctx.font = "12px sans-serif";
    const labels = getLabelCandidates(points, view, enabledTypes);
    const boxes = [];
    for (const item of labels) {
        const p = item.p;
        if (!p.name) continue;
        const text = p.name;
        const metrics = ctx.measureText(text);
        const w = metrics.width;
        const h = 12;
        const x = item.sx + 6;
        const y = item.sy - 6 - h;
        const box = { x, y, w, h };

        let overlaps = false;
        for (const b of boxes) {
            if (
                box.x < b.x + b.w &&
                box.x + box.w > b.x &&
                box.y < b.y + b.h &&
                box.y + box.h > b.y
            ) {
                overlaps = true;
                break;
            }
        }
        if (overlaps) continue;
        boxes.push(box);
        ctx.fillText(text, x, y + h);
    }

    if (showScaleBarEl.checked) drawScaleBar();

    // overlay: scale
    ctx.fillStyle = "white";
    ctx.font = "12px sans-serif";
    ctx.fillText(`scale: ${view.scale.toFixed(3)} px/block`, 10, canvas.height - 10);
}

function buildTypeControls() {
    typeFiltersEl.innerHTML = "";

    const stored = loadEnabledTypes();
    enabledTypes = new Set();

    for (const type of knownTypes) {
        const enabled = stored === null ? true : stored.has(type);
        if (enabled) enabledTypes.add(type);

        const label = document.createElement("label");
        label.className = "toggle";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = enabled;
        input.dataset.type = type;

        const span = document.createElement("span");
        span.textContent = type;

        label.appendChild(input);
        label.appendChild(span);
        typeFiltersEl.appendChild(label);
    }

    typeFiltersEl.addEventListener("change", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement)) return;
        const type = target.dataset.type;
        if (!type) return;
        if (target.checked) enabledTypes.add(type);
        else enabledTypes.delete(type);
        saveEnabledTypes();
        render();
    });
}

function setAllTypes(enabled) {
    const inputs = typeFiltersEl.querySelectorAll("input[type='checkbox']");
    inputs.forEach((input) => {
        input.checked = enabled;
        const type = input.dataset.type;
        if (!type) return;
        if (enabled) enabledTypes.add(type);
        else enabledTypes.delete(type);
    });
    saveEnabledTypes();
    render();
}

// ---------- Fit initial view ----------
function fitToPoints() {
    if (points.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
    }

    view.cx = (minX + maxX) / 2;
    view.cz = (minZ + maxZ) / 2;

    const pad = 60;
    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxZ - minZ);

    const scaleX = (canvas.width - pad * 2) / worldW;
    const scaleY = (canvas.height - pad * 2) / worldH;
    view.scale = Math.min(scaleX, scaleY);

    // Keep it sane if your points are extremely close/far
    view.scale = Math.max(0.02, Math.min(view.scale, 5));
}

// ---------- Interaction: pan ----------
let isDragging = false;
let last = { x: 0, y: 0 };

canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    last = { x: e.offsetX, y: e.offsetY };
    canvas.style.cursor = "grabbing";
});

window.addEventListener("mouseup", () => {
    isDragging = false;
    canvas.style.cursor = "default";
});

canvas.addEventListener("mousemove", (e) => {
    // optional: show coords under cursor
    const w = screenToWorld(e.offsetX, e.offsetY);
    statusEl.textContent = `Loaded ${points.length} points. Cursor: x=${Math.round(w.x)}, z=${Math.round(w.z)}`;

    if (!isDragging) return;

    const dx = e.offsetX - last.x;
    const dy = e.offsetY - last.y;
    last = { x: e.offsetX, y: e.offsetY };

    // dragging the view right should move the "camera" left in world coords
    view.cx -= dx / view.scale;
    view.cz += (invertZEl.checked ? dy : -dy) / view.scale;

    render();
});

// ---------- Interaction: zoom (wheel, towards cursor) ----------
canvas.addEventListener(
    "wheel",
    (e) => {
        e.preventDefault();

        // World point under cursor BEFORE zoom
        const before = screenToWorld(e.offsetX, e.offsetY);

        // Zoom factor: trackpads give small deltas, wheels larger
        const zoomIntensity = 0.0015; // tweak feel
        const factor = Math.exp(-e.deltaY * zoomIntensity);

        const newScale = view.scale * factor;
        view.scale = Math.max(0.01, Math.min(newScale, 20));

        // World point under cursor AFTER zoom
        const after = screenToWorld(e.offsetX, e.offsetY);

        // Adjust centre so the point under cursor stays fixed
        view.cx += before.x - after.x;
        view.cz += before.z - after.z;

        render();
    },
    { passive: false }
);

// ---------- Load ----------
async function main() {
    statusEl.textContent = "Loading data.json…";

    const res = await fetch("data.json");
    if (!res.ok) throw new Error(`Failed to load data.json: ${res.status}`);

    const data = await res.json();
    points = (data.points ?? [])
        .filter((p) => typeof p.x === "number" && typeof p.z === "number")
        .map((p) => ({ ...p, _type: normalizeType(p.type) }));

    const typeSet = new Set(points.map((p) => p._type));
    knownTypes = [...typeSet].sort();
    buildTypeControls();

    invertZEl.checked = loadInvertZ();
    invertZEl.addEventListener("change", () => {
        saveInvertZ();
        render();
    });
    showGridEl.checked = loadToggle(STORAGE_SHOW_GRID_KEY, false);
    showAxesEl.checked = loadToggle(STORAGE_SHOW_AXES_KEY, true);
    showScaleBarEl.checked = loadToggle(STORAGE_SHOW_SCALE_BAR_KEY, true);
    showGridEl.addEventListener("change", () => {
        saveToggle(STORAGE_SHOW_GRID_KEY, showGridEl.checked);
        render();
    });
    showAxesEl.addEventListener("change", () => {
        saveToggle(STORAGE_SHOW_AXES_KEY, showAxesEl.checked);
        render();
    });
    showScaleBarEl.addEventListener("change", () => {
        saveToggle(STORAGE_SHOW_SCALE_BAR_KEY, showScaleBarEl.checked);
        render();
    });
    selectAllBtn.addEventListener("click", () => setAllTypes(true));
    selectNoneBtn.addEventListener("click", () => setAllTypes(false));

    statusEl.textContent = `Loaded ${points.length} points.`;
    fitToPoints();
    render();
}

main().catch((err) => {
    console.error(err);
    statusEl.textContent = `Error: ${err.message}`;
});
