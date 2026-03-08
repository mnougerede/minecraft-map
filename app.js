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

// ---------- Edit mode state ----------
let editMode = false;
let selectedPoint = null;
let supabaseClient = null;
let currentUser = null;

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

function getNiceSpacing(scale, targetPx = 90) {
    const value = targetPx / scale;
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
    const step = getNiceSpacing(view.scale, 90);
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

function formatAxisValue(value, step) {
    const absStep = Math.abs(step);
    if (absStep >= 1) return String(Math.round(value));
    const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(absStep))));
    return value.toFixed(decimals);
}

function drawAxisNumbers() {
    const bounds = getVisibleWorldBounds();
    const gridStep = getNiceSpacing(view.scale, 90);
    const minLabelPx = 50;
    const gridPx = gridStep * view.scale;
    const multiplier = gridPx < minLabelPx ? Math.ceil(minLabelPx / gridPx) : 1;
    const labelStep = gridStep * multiplier;

    ctx.save();
    ctx.fillStyle = "#aaa";
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "middle";

    const pad = 2;
    const bgAlpha = 0.45;

    const drawLabel = (text, x, y, align) => {
        ctx.textAlign = align;
        const metrics = ctx.measureText(text);
        const w = metrics.width;
        const h = 10;
        let rx = x;
        if (align === "center") rx = x - w / 2;
        if (align === "right") rx = x - w;
        ctx.fillStyle = `rgba(0,0,0,${bgAlpha})`;
        ctx.fillRect(rx - pad, y - h / 2 - pad, w + pad * 2, h + pad * 2);
        ctx.fillStyle = "#aaa";
        ctx.fillText(text, x, y);
    };

    if (bounds.minZ <= 0 && bounds.maxZ >= 0) {
        const startX = Math.floor(bounds.minX / labelStep) * labelStep;
        const endX = Math.ceil(bounds.maxX / labelStep) * labelStep;
        for (let x = startX; x <= endX; x += labelStep) {
            if (x === 0) continue;
            const { sx, sy } = worldToScreen(x, 0);
            if (sx < 0 || sx > canvas.width || sy < 0 || sy > canvas.height) continue;
            const text = formatAxisValue(x, labelStep);
            const offsetY = 8;
            drawLabel(text, sx, sy + offsetY, "center");
        }
    }

    if (bounds.minX <= 0 && bounds.maxX >= 0) {
        const startZ = Math.floor(bounds.minZ / labelStep) * labelStep;
        const endZ = Math.ceil(bounds.maxZ / labelStep) * labelStep;
        for (let z = startZ; z <= endZ; z += labelStep) {
            if (z === 0) continue;
            const { sx, sy } = worldToScreen(0, z);
            if (sx < 0 || sx > canvas.width || sy < 0 || sy > canvas.height) continue;
            const text = formatAxisValue(z, labelStep);
            const offsetX = 8;
            drawLabel(text, sx + offsetX, sy, "left");
        }
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
    const worldLen = getNiceSpacing(view.scale, targetPx);
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
    if (showAxesEl.checked) {
        drawAxes();
        drawAxisNumbers();
    }

    // points
    ctx.save();
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const p of points) {
        if (!enabledTypes.has(p._type)) continue;
        const { sx, sy } = worldToScreen(p.x, p.z);

        // skip if far off-screen (small perf win)
        if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) continue;

        ctx.fillText("🍌", sx, sy);
    }
    ctx.restore();

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

    // selected point highlight
    if (selectedPoint) {
        const { sx, sy } = worldToScreen(selectedPoint.x, selectedPoint.z);
        ctx.save();
        ctx.strokeStyle = "orange";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // edit mode canvas border
    if (editMode) {
        ctx.save();
        ctx.strokeStyle = "orange";
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
        ctx.restore();
    }
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

// ---------- Supabase client factory ----------
function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    const url = window.SUPABASE_URL || "";
    const key = window.SUPABASE_ANON_KEY || "";
    if (!url || !key) return null;
    if (!window.supabase || !window.supabase.createClient) return null;
    supabaseClient = window.supabase.createClient(url, key);
    return supabaseClient;
}

async function saveNewPoint(data) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured. Cannot save points.");
    const { data: rows, error } = await client
        .from("points")
        .insert([data])
        .select("id,name,x,y,z,type,notes,created_at");
    if (error) throw error;
    return rows[0];
}

async function updatePoint(id, data) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured. Cannot save points.");
    const { error } = await client.from("points").update(data).eq("id", id);
    if (error) throw error;
}

async function deletePoint(id) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured. Cannot delete points.");
    const { error } = await client.from("points").delete().eq("id", id);
    if (error) throw error;
}

async function upsertPoints(rows) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured.");
    const payload = rows.map(p => ({
        name: p.name,
        x: p.x ?? null,
        z: p.z ?? null,
        y: p.y ?? null,
        type: p.type ?? null,
        notes: p.notes ?? null,
    }));
    const { error } = await client.from("points").upsert(payload, { onConflict: "name" });
    if (error) throw error;
}

function getPointAtScreen(sx, sy, radius = 8) {
    let best = null;
    let bestDist = radius;
    for (const p of points) {
        if (!enabledTypes.has(p._type)) continue;
        const s = worldToScreen(p.x, p.z);
        const d = Math.hypot(s.sx - sx, s.sy - sy);
        if (d <= bestDist) {
            bestDist = d;
            best = p;
        }
    }
    return best;
}

function setEditMode(enabled) {
    editMode = enabled;
    selectedPoint = null;
    const btn = document.getElementById("editModeBtn");
    if (enabled) {
        btn.classList.add("active");
        canvas.style.cursor = "crosshair";
    } else {
        btn.classList.remove("active");
        canvas.style.cursor = "default";
    }
    render();
    buildPlacesList();
}

// ---------- Auth ----------
function updateAuthUI(session) {
    currentUser = session?.user ?? null;
    const editingGroup = document.getElementById("editingGroup");
    const authStatus = document.getElementById("authStatus");
    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");

    if (currentUser) {
        editingGroup.classList.remove("hidden");
        authStatus.textContent = currentUser.email;
        loginBtn.classList.add("hidden");
        logoutBtn.classList.remove("hidden");
    } else {
        editingGroup.classList.add("hidden");
        authStatus.textContent = "";
        loginBtn.classList.remove("hidden");
        logoutBtn.classList.add("hidden");
        if (editMode) setEditMode(false);
    }
    buildPlacesList();
}

function openLoginModal() {
    document.getElementById("loginOverlay").classList.remove("hidden");
    document.getElementById("login-error").classList.add("hidden");
    document.getElementById("login-sent").classList.add("hidden");
    document.getElementById("login-submit").disabled = false;
    document.getElementById("login-email").value = "";
    document.getElementById("login-email").focus();
}

function closeLoginModal() {
    document.getElementById("loginOverlay").classList.add("hidden");
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const errEl = document.getElementById("login-error");
    const sentEl = document.getElementById("login-sent");
    const submitBtn = document.getElementById("login-submit");

    errEl.classList.add("hidden");
    sentEl.classList.add("hidden");
    submitBtn.disabled = true;

    const client = getSupabaseClient();
    if (!client) {
        errEl.textContent = "Supabase is not configured.";
        errEl.classList.remove("hidden");
        submitBtn.disabled = false;
        return;
    }

    const { error } = await client.auth.signInWithOtp({ email });
    if (error) {
        errEl.textContent = error.message;
        errEl.classList.remove("hidden");
        submitBtn.disabled = false;
    } else {
        sentEl.classList.remove("hidden");
    }
}

async function handleLogout() {
    const client = getSupabaseClient();
    if (client) await client.auth.signOut();
}

// ---------- Point form modal ----------
const pointFormOverlay = document.getElementById("pointFormOverlay");
const pointFormTitle = document.getElementById("pointFormTitle");
const pfName = document.getElementById("pf-name");
const pfType = document.getElementById("pf-type");
const pfTypeList = document.getElementById("pf-type-list");
const pfX = document.getElementById("pf-x");
const pfZ = document.getElementById("pf-z");
const pfY = document.getElementById("pf-y");
const pfNotes = document.getElementById("pf-notes");
const pfError = document.getElementById("pf-error");
const pfSave = document.getElementById("pf-save");
const pfDelete = document.getElementById("pf-delete");
const pfCancel = document.getElementById("pf-cancel");

let editingPoint = null; // null = add mode, object = edit mode

function openPointForm(point, prefillX, prefillZ) {
    editingPoint = point ?? null;
    pfError.textContent = "";
    pfError.classList.add("hidden");

    // Populate type datalist
    pfTypeList.innerHTML = "";
    for (const t of knownTypes) {
        if (t === "(none)") continue;
        const opt = document.createElement("option");
        opt.value = t;
        pfTypeList.appendChild(opt);
    }

    if (point) {
        pointFormTitle.textContent = "Edit Point";
        pfName.value = point.name ?? "";
        pfType.value = point.type ?? "";
        pfX.value = point.x ?? "";
        pfZ.value = point.z ?? "";
        pfY.value = point.y ?? "";
        pfNotes.value = point.notes ?? "";
        pfDelete.classList.remove("hidden");
    } else {
        pointFormTitle.textContent = "Add Point";
        pfName.value = "";
        pfType.value = "";
        pfX.value = prefillX ?? "";
        pfZ.value = prefillZ ?? "";
        pfY.value = "";
        pfNotes.value = "";
        pfDelete.classList.add("hidden");
    }

    pointFormOverlay.classList.remove("hidden");
    pfName.focus();
}

function closePointForm() {
    pointFormOverlay.classList.add("hidden");
    editingPoint = null;
    selectedPoint = null;
    render();
    buildPlacesList();
}

function showFormError(msg) {
    pfError.textContent = msg;
    pfError.classList.remove("hidden");
}

async function handleFormSave(e) {
    e.preventDefault();
    pfError.classList.add("hidden");
    pfSave.disabled = true;

    const rawType = pfType.value.trim();
    const payload = {
        name: pfName.value.trim(),
        type: rawType || null,
        x: pfX.value !== "" ? Number(pfX.value) : null,
        z: pfZ.value !== "" ? Number(pfZ.value) : null,
        y: pfY.value !== "" ? Number(pfY.value) : null,
        notes: pfNotes.value.trim() || null,
    };

    try {
        if (editingPoint) {
            await updatePoint(editingPoint.id, payload);
            Object.assign(editingPoint, payload, { _type: normalizeType(payload.type) });
        } else {
            const saved = await saveNewPoint(payload);
            const newPt = { ...saved, _type: normalizeType(saved.type) };
            points.push(newPt);
        }
        refreshTypesAfterEdit();
        closePointForm();
    } catch (err) {
        showFormError(err.message ?? String(err));
    } finally {
        pfSave.disabled = false;
    }
}

async function handleFormDelete() {
    if (!editingPoint) return;
    if (!window.confirm(`Delete "${editingPoint.name ?? "this point"}"?`)) return;
    pfDelete.disabled = true;
    try {
        await deletePoint(editingPoint.id);
        const idx = points.indexOf(editingPoint);
        if (idx !== -1) points.splice(idx, 1);
        closePointForm();
    } catch (err) {
        showFormError(err.message ?? String(err));
        pfDelete.disabled = false;
    }
}

function refreshTypesAfterEdit() {
    const typeSet = new Set(points.map((p) => p._type));
    const newTypes = [...typeSet].sort();
    const hadNewType = newTypes.some((t) => !knownTypes.includes(t));
    knownTypes = newTypes;
    if (hadNewType) {
        buildTypeControls();
    }
    render();
    buildPlacesList();
}

function centerOnPoint(point) {
    view.cx = point.x;
    view.cz = point.z;
    render();
}

function buildPlacesList() {
    const listEl = document.getElementById("placesList");
    const searchEl = document.getElementById("placesSearch");
    if (!listEl) return;

    const query = (searchEl ? searchEl.value : "").trim().toLowerCase();
    const sorted = [...points]
        .filter(p => !query || (p.name ?? "").toLowerCase().includes(query))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

    listEl.innerHTML = "";
    for (const p of sorted) {
        const li = document.createElement("li");
        if (selectedPoint === p) li.classList.add("selected");

        const nameSpan = document.createElement("span");
        nameSpan.className = "places-name";
        nameSpan.textContent = p.name ?? "(unnamed)";
        nameSpan.title = p.name ?? "";

        const typeSpan = document.createElement("span");
        typeSpan.className = "places-type";
        if (p._type && p._type !== "(none)") typeSpan.textContent = p._type;

        const coordSpan = document.createElement("span");
        coordSpan.className = "places-coords";
        coordSpan.textContent = `${p.x}, ${p.z}` + (p.y != null ? `, ${p.y}` : "");

        if (currentUser) {
            const editBtn = document.createElement("button");
            editBtn.className = "places-edit-btn";
            editBtn.type = "button";
            editBtn.textContent = "Edit";
            editBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                openPointForm(p);
            });
            li.append(nameSpan, typeSpan, coordSpan, editBtn);
        } else {
            li.append(nameSpan, typeSpan, coordSpan);
        }
        li.addEventListener("click", () => {
            selectedPoint = p;
            centerOnPoint(p);
            buildPlacesList();
        });
        listEl.appendChild(li);
    }
}

document.getElementById("pointForm").addEventListener("submit", handleFormSave);
pfDelete.addEventListener("click", handleFormDelete);
pfCancel.addEventListener("click", closePointForm);
pointFormOverlay.addEventListener("click", (e) => {
    if (e.target === pointFormOverlay) closePointForm();
});

// ---------- Interaction: pan ----------
let isDragging = false;
let dragMoved = false;
let last = { x: 0, y: 0 };

canvas.addEventListener("mousedown", (e) => {
    if (editMode) {
        last = { x: e.offsetX, y: e.offsetY };
        dragMoved = false;
        isDragging = true;
        return;
    }
    isDragging = true;
    dragMoved = false;
    last = { x: e.offsetX, y: e.offsetY };
    canvas.style.cursor = "grabbing";
});

canvas.addEventListener("mouseup", (e) => {
    if (editMode && isDragging && !dragMoved) {
        const hitPoint = getPointAtScreen(e.offsetX, e.offsetY);
        if (hitPoint) {
            selectedPoint = hitPoint;
            render();
            buildPlacesList();
            openPointForm(hitPoint);
        } else {
            selectedPoint = null;
            const w = screenToWorld(e.offsetX, e.offsetY);
            openPointForm(null, Math.round(w.x), Math.round(w.z));
        }
    }
    isDragging = false;
    dragMoved = false;
    if (!editMode) canvas.style.cursor = "default";
});

window.addEventListener("mouseup", () => {
    if (isDragging) {
        isDragging = false;
        dragMoved = false;
        if (!editMode) canvas.style.cursor = "default";
    }
});

canvas.addEventListener("mousemove", (e) => {
    // show coords under cursor
    const w = screenToWorld(e.offsetX, e.offsetY);
    statusEl.textContent = `Loaded ${points.length} points. Cursor: x=${Math.round(w.x)}, z=${Math.round(w.z)}`;

    if (!isDragging) return;
    if (editMode) {
        dragMoved = true;
        return;
    }

    dragMoved = true;
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
    // Auth setup — must happen before UI is built so edit controls start hidden
    const client = getSupabaseClient();
    if (client) {
        client.auth.onAuthStateChange((_event, session) => {
            updateAuthUI(session);
        });
        const { data: { session } } = await client.auth.getSession();
        updateAuthUI(session);
    }

    document.getElementById("loginBtn").addEventListener("click", openLoginModal);
    document.getElementById("logoutBtn").addEventListener("click", handleLogout);
    document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
    document.getElementById("login-cancel").addEventListener("click", closeLoginModal);
    document.getElementById("loginOverlay").addEventListener("click", (e) => {
        if (e.target === document.getElementById("loginOverlay")) closeLoginModal();
    });

    statusEl.textContent = "Loading data.json…";

    points = await loadPoints();

    const typeSet = new Set(points.map((p) => p._type));
    knownTypes = [...typeSet].sort();
    buildTypeControls();
    buildPlacesList();

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

    document.getElementById("editModeBtn").addEventListener("click", () => setEditMode(!editMode));

    document.getElementById("addPointBtn").addEventListener("click", () => openPointForm(null));

    const importJsonBtn = document.getElementById("importJsonBtn");
    const importFileInput = document.getElementById("importFileInput");
    importJsonBtn.addEventListener("click", () => importFileInput.click());
    importFileInput.addEventListener("change", async () => {
        const file = importFileInput.files[0];
        if (!file) return;
        importFileInput.value = "";
        let parsed;
        try { parsed = JSON.parse(await file.text()); } catch { alert("Invalid JSON file."); return; }
        if (!Array.isArray(parsed)) { alert("Expected a JSON array of points."); return; }
        try {
            await upsertPoints(parsed);
            await loadPoints();
            alert(`Imported ${parsed.length} point(s) successfully.`);
        } catch (err) {
            alert("Import failed: " + err.message);
        }
    });

    document.getElementById("placesSearch").addEventListener("input", buildPlacesList);

    statusEl.textContent = `Loaded ${points.length} points.`;
    fitToPoints();
    render();
}

async function loadFromJson() {
    const res = await fetch("data.json");
    if (!res.ok) throw new Error(`Failed to load data.json: ${res.status}`);
    const data = await res.json();
    return (data.points ?? [])
        .filter((p) => typeof p.x === "number" && typeof p.z === "number")
        .map((p) => ({ ...p, _type: normalizeType(p.type) }));
}

async function loadFromSupabase() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase client not available.");
    const { data, error } = await client
        .from("points")
        .select("id,name,x,y,z,type,notes,created_at");

    if (error) throw error;
    return (data ?? [])
        .filter((p) => typeof p.x === "number" && typeof p.z === "number")
        .map((p) => ({ ...p, _type: normalizeType(p.type) }));
}

async function loadPoints() {
    const url = window.SUPABASE_URL || "";
    const key = window.SUPABASE_ANON_KEY || "";

    if (url && key) {
        try {
            statusEl.textContent = "Loading points from Supabase…";
            const supaPoints = await loadFromSupabase();
            if (supaPoints.length > 0) return supaPoints;
            console.warn("Supabase returned 0 points; falling back to data.json.");
        } catch (err) {
            console.warn("Supabase load failed; falling back to data.json.", err);
        }
    } else {
        console.warn("Supabase config missing; loading data.json instead.");
    }

    statusEl.textContent = "Loading data.json…";
    return loadFromJson();
}

main().catch((err) => {
    console.error(err);
    statusEl.textContent = `Error: ${err.message}`;
});
