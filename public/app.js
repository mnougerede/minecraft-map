const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

// ---------- Data ----------
let points = [];

// ---------- View transform (world <-> screen) ----------
const view = {
    // world coords at the centre of the screen
    cx: 0,
    cz: 0,
    // pixels per 1 world unit (block)
    scale: 0.1,
};

function worldToScreen(x, z) {
    const sx = (x - view.cx) * view.scale + canvas.width / 2;
    const sy = (z - view.cz) * view.scale + canvas.height / 2;
    return { sx, sy };
}

function screenToWorld(sx, sy) {
    const x = (sx - canvas.width / 2) / view.scale + view.cx;
    const z = (sy - canvas.height / 2) / view.scale + view.cz;
    return { x, z };
}

// ---------- Render ----------
function render() {
    // background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // points
    ctx.fillStyle = "red";
    ctx.font = "12px sans-serif";

    const showLabels = view.scale >= 0.12; // tweak to taste

    for (const p of points) {
        const { sx, sy } = worldToScreen(p.x, p.z);

        // skip if far off-screen (small perf win)
        if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) continue;

        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();

        if (showLabels && p.name) {
            ctx.fillText(p.name, sx + 6, sy - 6);
        }
    }

    // overlay: scale
    ctx.fillStyle = "white";
    ctx.font = "12px sans-serif";
    ctx.fillText(`scale: ${view.scale.toFixed(3)} px/block`, 10, canvas.height - 10);
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
    view.cz -= dy / view.scale;

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
    points = (data.points ?? []).filter((p) => typeof p.x === "number" && typeof p.z === "number");

    statusEl.textContent = `Loaded ${points.length} points.`;
    fitToPoints();
    render();
}

main().catch((err) => {
    console.error(err);
    statusEl.textContent = `Error: ${err.message}`;
});
