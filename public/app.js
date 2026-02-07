const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillRect(0, 0, canvas.width, canvas.height); // black background (default fillStyle)
}

function drawPoints(points, view) {
    // background
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "red";
    ctx.font = "12px sans-serif";

    for (const p of points) {
        const sx = (p.x - view.minX) * view.scale + view.pad;
        const sy = (p.z - view.minZ) * view.scale + view.pad;

        // dot
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();

        // label (only if not too crowded)
        if (view.scale > 0.05) {
            ctx.fillText(p.name ?? "", sx + 6, sy - 6);
        }
    }
}

function computeView(points) {
    // Find bounds in world coords (x,z)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
        if (typeof p.x !== "number" || typeof p.z !== "number") continue;
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
    }

    // Avoid divide-by-zero if all points coincide
    if (!isFinite(minX)) {
        return { minX: 0, minZ: 0, scale: 1, pad: 30 };
    }

    const pad = 30;
    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxZ - minZ);

    const scaleX = (canvas.width - pad * 2) / worldW;
    const scaleY = (canvas.height - pad * 2) / worldH;
    const scale = Math.min(scaleX, scaleY);

    return { minX, minZ, scale, pad };
}

async function main() {
    statusEl.textContent = "Loading data.json…";

    const res = await fetch("data.json");
    if (!res.ok) throw new Error(`Failed to load data.json: ${res.status}`);

    const data = await res.json();
    const points = (data.points ?? []).filter(p => typeof p.x === "number" && typeof p.z === "number");

    statusEl.textContent = `Loaded ${points.length} points.`;
    const view = computeView(points);
    drawPoints(points, view);
}

main().catch(err => {
    console.error(err);
    statusEl.textContent = `Error: ${err.message}`;
});
