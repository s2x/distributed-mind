// ── mind web UI ──────────────────────────────────────────────────────────────

// ── API ───────────────────────────────────────────────────────────────────────
const api = {
    async get(path) {
        const r = await fetch(path);
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
    },
    async post(path, body) {
        const r = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
    },
    async patch(path, body) {
        const r = await fetch(path, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
    },
    async del(path) {
        const r = await fetch(path, { method: 'DELETE' });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
    },
};

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
    spaces: [],
    currentSpace: null,
    memories: [], // MemorySummary[]
    currentMemory: null, // Memory (full)
    searchActive: false,
    searchResults: [],
    spaceView: 'list',
    graph: null,
    graphFocusNodeId: null,
    graphTransform: { scale: 1, tx: 0, ty: 0 },
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const elSpaceList = $('space-list');
const elEmptyState = $('empty-state');
const elSpaceDetail = $('space-detail');
const elSearchResults = $('search-results');
const elMemoryPanel = $('memory-panel');
const elGlobalSearch = $('global-search');
const elSpaceTitle = $('space-title');
const elSpaceDesc = $('space-desc');
const elSpaceTagsRow = $('space-tags-row');
const elSearchList = $('search-list');
const elSearchHeading = $('search-heading');
const elMemTitle = $('mem-title');
const elMemTierBadge = $('mem-tier-badge');
const elMemTagsRow = $('mem-tags-row');
const elMemContent = $('mem-content');
const elMemEditArea = $('mem-edit-area');
const elMemEditInput = $('mem-edit-input');
const elStatusSpaces = $('status-spaces');
const elStatusTiers = $('status-tiers');
const elTiers = $('tiers');
const elGraphView = $('graph-view');
const elGraphSvg = $('graph-svg');
const elGraphMeta = $('graph-meta');
const elBtnViewList = $('btn-view-list');
const elBtnViewMap = $('btn-view-map');
const memoryPanelInteractions = globalThis.memoryPanelInteractions;

// ── Tier helpers ──────────────────────────────────────────────────────────────
const TIER_LABEL = { 1: '🔴 T1 — Hot', 2: '🟡 T2 — Warm', 3: '🔵 T3 — Cold', 4: '💠 T4 — Frozen' };
const TIER_CLASS = { 1: 't1', 2: 't2', 3: 't3', 4: 't4' };
const TIER_LIMITS = { 1: 25, 2: 50, 3: 100, 4: null }; // null = unlimited
const GRAPH_SCALE_MIN = 0.45;
const GRAPH_SCALE_MAX = 4.5;
const GRAPH_LABEL_BASE = 11;
const GRAPH_LABEL_MIN = 8;
const GRAPH_LABEL_MAX = 16;

// ── Status panel ──────────────────────────────────────────────────────────────

function renderStatus(status) {
    const spaces = status.total_spaces ?? 0;
    const memories = status.total_memories ?? 0;
    elStatusSpaces.textContent = `${spaces} space${spaces !== 1 ? 's' : ''}, ${memories} mem`;
    elStatusTiers.innerHTML = '';
    for (const t of status.by_tier ?? []) {
        const cls = TIER_CLASS[t.tier] ?? '';
        const label = t.tier === 4 ? '💠' : (['', '🔴', '🟡', '🔵'][t.tier] ?? '');
        const limit = TIER_LIMITS[t.tier];
        const cap = limit != null ? `/${limit}` : '';
        const pill = document.createElement('span');
        pill.className = `status-tier-pill ${cls}`;
        pill.title = TIER_LABEL[t.tier] ?? `T${t.tier}`;
        pill.textContent = `${label} ${t.count}${cap}`;
        elStatusTiers.appendChild(pill);
    }
}

async function loadStatus() {
    try {
        const status = await api.get('/api/status');
        renderStatus(status);
    } catch {
        /* non-critical, ignore */
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderSpaceList() {
    elSpaceList.innerHTML = '';
    for (const sp of state.spaces) {
        const li = document.createElement('li');
        li.className = 'space-item' + (state.currentSpace?.name === sp.name ? ' active' : '');
        li.dataset.name = sp.name;
        li.innerHTML = `
            <span class="space-item-name">${esc(sp.name)}</span>
            <span class="space-item-count">${sp.memory_count}</span>
        `;
        li.addEventListener('click', () => selectSpace(sp.name));
        elSpaceList.appendChild(li);
    }
}

function renderSpaceDetail() {
    const sp = state.currentSpace;
    if (!sp) return;

    elSpaceTitle.textContent = sp.name;
    elSpaceDesc.textContent = sp.description || 'No description';

    // Tags
    renderTagRow(
        elSpaceTagsRow,
        sp.tags ?? [],
        async (tag) => {
            await api.patch(`/api/spaces/${enc(sp.name)}`, { removeTag: tag });
            await refreshSpace(sp.name);
        },
        async () => {
            const tag = prompt('Tag name:');
            if (tag) {
                await api.patch(`/api/spaces/${enc(sp.name)}`, { addTag: tag.trim().toLowerCase() });
                await refreshSpace(sp.name);
            }
        }
    );

    // Tier containers
    for (const tier of [1, 2, 3]) {
        const ul = document.querySelector(`#tiers .memory-list[data-tier="${tier}"]`);
        const mems = state.memories.filter((m) => m.tier === tier);
        ul.innerHTML = '';
        if (mems.length === 0) {
            ul.innerHTML = '<li class="tier-empty">Empty</li>';
        } else {
            for (const mem of mems) {
                ul.appendChild(renderMemoryItem(mem, sp.name));
            }
        }
    }

    renderGraph();
    setSpaceView(state.spaceView, { updateUrl: false });
}

function setSpaceView(view, options = {}) {
    const { updateUrl = true } = options;
    state.spaceView = view === 'map' ? 'map' : 'list';
    const showMap = state.spaceView === 'map';

    elTiers.classList.toggle('hidden', showMap);
    elGraphView.classList.toggle('hidden', !showMap);

    elBtnViewList.classList.toggle('is-active', !showMap);
    elBtnViewMap.classList.toggle('is-active', showMap);
    elBtnViewList.setAttribute('aria-pressed', String(!showMap));
    elBtnViewMap.setAttribute('aria-pressed', String(showMap));

    if (updateUrl && state.currentSpace) {
        syncUrl();
    }
}

function renderGraph() {
    const graph = state.graph;
    elGraphSvg.innerHTML = '';

    if (!graph || graph.nodes.length === 0) {
        elGraphMeta.textContent = 'No memories to map.';
        return;
    }

    const layout = graphMath.layoutGraph(graph.nodes);
    const focus = graphMath.buildNeighborhoodFocus(graph.nodes, state.graphFocusNodeId);
    const transformGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    transformGroup.setAttribute('id', 'graph-transform');
    const layers = new Map();

    for (const layerName of graphMath.buildGraphLayerOrder()) {
        const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('data-layer', layerName);
        layers.set(layerName, layer);
        transformGroup.appendChild(layer);
    }

    const rings = [
        { tier: 1, radius: 130, color: '#ff7b72' },
        { tier: 2, radius: 230, color: '#e3b341' },
        { tier: 3, radius: 330, color: '#79c0ff' },
        { tier: 4, radius: 430, color: '#8b949e' },
    ];

    for (const ring of rings) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '500');
        circle.setAttribute('cy', '500');
        circle.setAttribute('r', String(ring.radius));
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', ring.color);
        circle.setAttribute('stroke-opacity', '0.35');
        circle.setAttribute('stroke-width', '1');
        layers.get('rings').appendChild(circle);
    }

    const renderedEdges = new Set();
    for (const node of graph.nodes) {
        for (const targetId of node.links_to) {
            const key = `${node.id}->${targetId}`;
            if (renderedEdges.has(key)) continue;
            renderedEdges.add(key);
            const sourcePos = layout.get(node.id);
            const targetPos = layout.get(targetId);
            if (!sourcePos || !targetPos) continue;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(sourcePos.x));
            line.setAttribute('y1', String(sourcePos.y));
            line.setAttribute('x2', String(targetPos.x));
            line.setAttribute('y2', String(targetPos.y));
            line.setAttribute('stroke', '#8b949e');
            const edgeKey = `${node.id}->${targetId}`;
            const isIncident = focus.active && focus.incidentEdgeKeys.has(edgeKey);
            const edgeOpacity = !focus.active ? 0.35 : isIncident ? 0.82 : 0.1;
            const edgeWidth = isIncident ? 1.6 : 1;
            line.setAttribute('stroke-opacity', String(edgeOpacity));
            line.setAttribute('stroke-width', String(edgeWidth));
            layers.get('edges').appendChild(line);
        }
    }

    for (const node of graph.nodes) {
        const pos = layout.get(node.id);
        if (!pos) continue;

        const degree = node.links_to.length + node.linked_by.length;
        const radius = graphMath.computeNodeCircleRadius(degree);
        const tierColor = graphTierColor(node.tier);
        const isFocusedNode = focus.active && node.id === focus.centerNodeId;
        const isFocusRelated = focus.active && focus.relatedNodeIds.has(node.id);

        let fillOpacity = graphMath.computeNodeFillOpacity(degree);
        if (focus.active) {
            fillOpacity = isFocusRelated ? fillOpacity : Math.min(fillOpacity, 0.18);
            if (isFocusedNode) {
                fillOpacity = Math.max(fillOpacity, 0.95);
            }
        }

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(pos.x));
        circle.setAttribute('cy', String(pos.y));
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', tierColor);
        circle.setAttribute('fill-opacity', String(fillOpacity));
        circle.setAttribute('stroke', isFocusedNode ? '#58a6ff' : '#0f1117');
        circle.setAttribute('stroke-width', isFocusedNode ? '2.4' : '1.5');
        circle.setAttribute('tabindex', '0');
        circle.setAttribute('role', 'button');
        circle.setAttribute('aria-label', `Open memory ${node.name}. Degree ${degree}`);
        circle.style.cursor = 'pointer';

        const circleTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        circleTitle.textContent = node.name;
        circle.appendChild(circleTitle);

        circle.addEventListener('click', () => {
            state.graphFocusNodeId = node.id;
            selectMemory(state.currentSpace.name, node.name);
        });
        circle.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                state.graphFocusNodeId = node.id;
                selectMemory(state.currentSpace.name, node.name);
            }
        });
        layers.get('nodes').appendChild(circle);

        const degreeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        degreeLabel.textContent = String(degree);
        degreeLabel.setAttribute('x', String(pos.x));
        degreeLabel.setAttribute('y', String(pos.y + 0.5));
        degreeLabel.setAttribute('text-anchor', 'middle');
        degreeLabel.setAttribute('dominant-baseline', 'middle');
        degreeLabel.setAttribute('fill', '#0f1117');
        degreeLabel.setAttribute('font-size', '10');
        degreeLabel.setAttribute('font-weight', '700');
        degreeLabel.style.pointerEvents = 'none';
        degreeLabel.style.opacity = !focus.active || isFocusRelated ? '1' : '0.3';
        layers.get('nodes').appendChild(degreeLabel);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.textContent = graphMath.truncateGraphLabel(node.name, 25);
        label.setAttribute('x', String(pos.x));
        label.setAttribute('y', String(graphMath.computeLabelY(pos.y, radius)));
        label.setAttribute('fill', '#e6edf3');
        label.classList.add('graph-label');
        label.setAttribute('font-size', String(GRAPH_LABEL_BASE));
        label.setAttribute('text-anchor', 'middle');
        label.style.pointerEvents = 'none';
        label.style.opacity = !focus.active || isFocusRelated ? '1' : '0.3';

        const labelTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        labelTitle.textContent = node.name;
        label.appendChild(labelTitle);

        layers.get('labels').appendChild(label);
    }

    elGraphSvg.appendChild(transformGroup);
    applyGraphTransform();

    const m = graph.meta;
    if (m.truncated) {
        elGraphMeta.textContent = `Showing ${m.returned_nodes}/${m.total_nodes} nodes (cap ${m.applied_limit}/${m.max_limit}).`;
    } else {
        elGraphMeta.textContent = `Showing all ${m.returned_nodes} nodes.`;
    }
}

function graphTierColor(tier) {
    if (tier === 1) return '#ff7b72';
    if (tier === 2) return '#e3b341';
    if (tier === 3) return '#79c0ff';
    return '#8b949e';
}

function applyGraphTransform() {
    const transformGroup = $('graph-transform');
    if (!transformGroup) return;
    const { scale, tx, ty } = state.graphTransform;
    transformGroup.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
    updateGraphLabels(scale);
}

function updateGraphLabels(scale) {
    const labels = elGraphSvg.querySelectorAll('.graph-label');
    const clampedLabelSize = graphMath.computeLabelFontSize(scale, GRAPH_LABEL_BASE, GRAPH_LABEL_MIN, GRAPH_LABEL_MAX);
    const normalizedFontSize = clampedLabelSize / scale;
    for (const label of labels) {
        label.setAttribute('font-size', String(normalizedFontSize));
    }
}

function getSvgAnchorFromClient(clientX, clientY) {
    const point = elGraphSvg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;

    const screenMatrix = elGraphSvg.getScreenCTM();
    if (!screenMatrix) {
        return { x: 500, y: 500 };
    }

    const svgPoint = point.matrixTransform(screenMatrix.inverse());
    return { x: svgPoint.x, y: svgPoint.y };
}

function getSvgCenterAnchor() {
    const viewBox = elGraphSvg.viewBox.baseVal;
    return {
        x: viewBox.x + viewBox.width / 2,
        y: viewBox.y + viewBox.height / 2,
    };
}

function zoomGraphAtAnchor(factor, anchor) {
    state.graphTransform = graphMath.zoomTransformAtAnchor(state.graphTransform, {
        factor,
        anchorX: anchor.x,
        anchorY: anchor.y,
        minScale: GRAPH_SCALE_MIN,
        maxScale: GRAPH_SCALE_MAX,
    });
    applyGraphTransform();
}

function renderMemoryItem(mem, spaceName) {
    const li = document.createElement('li');
    li.className = 'memory-item' + (state.currentMemory?.id === mem.id ? ' active' : '');
    li.dataset.id = mem.id;
    li.dataset.name = mem.name;

    const tags = (mem.tags ?? [])
        .slice(0, 3)
        .map((t) => `<span class="memory-item-tag">${esc(t)}</span>`)
        .join('');

    li.innerHTML = `
        <span class="memory-item-pin">${mem.pinned ? '📌' : ''}</span>
        <span class="memory-item-name">${esc(mem.name)}</span>
        <span class="memory-item-tags">${tags}</span>
        <span class="memory-item-count" title="${mem.access_count} accesses">${mem.access_count > 0 ? mem.access_count + '×' : ''}</span>
    `;
    li.addEventListener('click', () => selectMemory(spaceName, mem.name));
    return li;
}

function renderTagRow(container, tags, onRemove, onAdd) {
    container.innerHTML = '';
    for (const tag of tags) {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = '#' + tag;
        span.title = 'Click to remove';
        span.style.cursor = 'pointer';
        span.addEventListener('click', () => onRemove(tag));
        container.appendChild(span);
    }
    const addBtn = document.createElement('button');
    addBtn.className = 'tag-add';
    addBtn.textContent = '+ tag';
    addBtn.addEventListener('click', onAdd);
    container.appendChild(addBtn);
}

function renderMemoryPanel(memory) {
    elMemTitle.textContent = memory.name;
    elMemTierBadge.textContent = TIER_LABEL[memory.tier];
    elMemTierBadge.className = 'tier-badge ' + TIER_CLASS[memory.tier];

    renderTagRow(
        elMemTagsRow,
        memory.tags ?? [],
        async (tag) => {
            await api.patch(`/api/spaces/${enc(memory.space_name)}/memories/${enc(memory.name)}`, { removeTag: tag });
            await refreshMemory(memory.space_name, memory.name);
        },
        async () => {
            const tag = prompt('Tag name:');
            if (tag) {
                await api.patch(`/api/spaces/${enc(memory.space_name)}/memories/${enc(memory.name)}`, {
                    addTag: tag.trim().toLowerCase(),
                });
                await refreshMemory(memory.space_name, memory.name);
            }
        }
    );

    elMemContent.innerHTML = marked.parse(memory.content || '');
    $('btn-mem-pin').textContent = memory.pinned ? '📌 Unpin' : '📌 Pin';

    // Show content, hide editor
    elMemContent.classList.remove('hidden');
    elMemEditArea.classList.add('hidden');
}

function renderSearchResults(results, query) {
    elSearchHeading.textContent = `"${query}" — ${results.length} result${results.length !== 1 ? 's' : ''}`;
    elSearchList.innerHTML = '';
    if (results.length === 0) {
        elSearchList.innerHTML = '<li class="tier-empty">No results.</li>';
        return;
    }
    for (const r of results) {
        const li = document.createElement('li');
        li.className = 'memory-item';
        const tierClass = TIER_CLASS[r.tier] ?? '';
        const tierLabel = TIER_LABEL[r.tier] ?? '';
        li.innerHTML = `
            <span class="memory-item-name">${esc(r.name)}</span>
            <span class="memory-item-tags">${(r.tags ?? [])
                .slice(0, 2)
                .map((t) => `<span class="memory-item-tag">${esc(t)}</span>`)
                .join('')}</span>
            <span class="tier-badge ${tierClass}" style="font-size:10px;padding:0 5px;">${tierLabel}</span>
            <div class="search-result-space">${esc(r.space_name)}</div>
        `;
        li.addEventListener('click', () => {
            state.searchActive = false;
            showPanel('space');
            // Navigate to the space first, then open memory
            selectSpace(r.space_name).then(() => selectMemory(r.space_name, r.name));
        });
        elSearchList.appendChild(li);
    }
}

// ── Panels ────────────────────────────────────────────────────────────────────
function showPanel(panel) {
    elEmptyState.classList.add('hidden');
    elSpaceDetail.classList.add('hidden');
    elSearchResults.classList.add('hidden');

    if (panel === 'empty') elEmptyState.classList.remove('hidden');
    else if (panel === 'space') elSpaceDetail.classList.remove('hidden');
    else if (panel === 'search') elSearchResults.classList.remove('hidden');
}

function showMemoryPanel(show) {
    if (show) elMemoryPanel.classList.remove('hidden');
    else elMemoryPanel.classList.add('hidden');
}

function closeCurrentMemoryPanel() {
    state.currentMemory = null;
    state.graphFocusNodeId = null;
    showMemoryPanel(false);
    renderSpaceDetail();
    syncUrl();
}

function isMemoryPanelOpen() {
    return !elMemoryPanel.classList.contains('hidden');
}

function isMemorySelectionTarget(target) {
    return Boolean(target.closest('.memory-item') || target.closest('#graph-svg [role="button"]'));
}

function syncUrl(options = {}) {
    const { replace = false } = options;
    const nextUrl = appRouting.buildAppUrl({
        spaceName: state.currentSpace?.name ?? null,
        view: state.spaceView,
        memoryName: state.currentMemory?.name ?? null,
    });

    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl === currentUrl) return;

    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({}, '', nextUrl);
}

function resetToHomeState() {
    state.currentSpace = null;
    state.currentMemory = null;
    state.memories = [];
    state.graph = null;
    state.graphFocusNodeId = null;
    showMemoryPanel(false);
    showPanel('empty');
    renderSpaceList();
}

async function restoreRouteFromLocation() {
    const route = appRouting.parseAppRoute(window.location.pathname, window.location.search);

    if (!route.spaceName) {
        resetToHomeState();
        syncUrl({ replace: true });
        return;
    }

    const hasSpace = state.spaces.some((space) => space.name === route.spaceName);
    if (!hasSpace) {
        resetToHomeState();
        syncUrl({ replace: true });
        return;
    }

    await selectSpace(route.spaceName, { updateUrl: false, view: route.view });

    if (route.memoryName) {
        const hasMemory = state.memories.some((memory) => memory.name === route.memoryName);
        if (hasMemory) {
            await selectMemory(route.spaceName, route.memoryName, { updateUrl: false });
        } else {
            state.currentMemory = null;
            showMemoryPanel(false);
            renderSpaceDetail();
        }
    }

    syncUrl({ replace: true });
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function loadSpaces() {
    state.spaces = await api.get('/api/spaces');
    renderSpaceList();
}

async function selectSpace(name, options = {}) {
    const { updateUrl = true, view = state.spaceView } = options;
    state.currentSpace = state.spaces.find((s) => s.name === name) ?? { name };
    state.currentMemory = null;
    state.graphFocusNodeId = null;
    showMemoryPanel(false);

    const [spaceData, memories, graph] = await Promise.all([
        api.get(`/api/spaces/${enc(name)}`),
        api.get(`/api/spaces/${enc(name)}/memories`),
        api.get(`/api/spaces/${enc(name)}/graph`),
    ]);
    state.currentSpace = spaceData;
    state.memories = memories;
    state.graph = graph;
    state.graphTransform = { scale: 1, tx: 0, ty: 0 };

    showPanel('space');
    renderSpaceList();
    renderSpaceDetail();
    setSpaceView(view, { updateUrl: false });

    if (updateUrl) {
        syncUrl();
    }
}

async function refreshSpace(name) {
    const [spaceData, memories, graph] = await Promise.all([
        api.get(`/api/spaces/${enc(name)}`),
        api.get(`/api/spaces/${enc(name)}/memories`),
        api.get(`/api/spaces/${enc(name)}/graph`),
        loadSpaces(),
        loadStatus(),
    ]);
    state.currentSpace = spaceData;
    state.memories = memories;
    state.graph = graph;
    state.graphFocusNodeId = null;
    renderSpaceDetail();
}

async function selectMemory(spaceName, memName, options = {}) {
    const { updateUrl = true } = options;
    const memory = await api.get(`/api/spaces/${enc(spaceName)}/memories/${enc(memName)}`);
    state.currentMemory = memory;
    renderMemoryPanel(memory);
    showMemoryPanel(true);
    // Re-render memory list to show active state
    renderSpaceDetail();

    if (updateUrl) {
        syncUrl();
    }
}

async function refreshMemory(spaceName, memName) {
    const memory = await api.get(`/api/spaces/${enc(spaceName)}/memories/${enc(memName)}`);
    state.currentMemory = memory;
    renderMemoryPanel(memory);
    await refreshSpace(spaceName);
}

// ── Inline editing ────────────────────────────────────────────────────────────
function makeEditable(el, onSave) {
    el.addEventListener('click', () => {
        const current = el.textContent;
        const input = document.createElement('input');
        input.value = current;
        input.className = el.className;
        input.style.background = 'var(--bg3)';
        input.style.border = '1px solid var(--accent)';
        input.style.borderRadius = '4px';
        input.style.padding = '2px 6px';
        input.style.color = 'var(--text)';
        input.style.width = '100%';
        el.replaceWith(input);
        input.focus();
        input.select();

        const done = async (save) => {
            if (save && input.value !== current) await onSave(input.value);
            input.replaceWith(el);
            if (save) el.textContent = input.value;
        };
        input.addEventListener('blur', () => done(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                done(true);
            }
            if (e.key === 'Escape') done(false);
        });
    });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

elBtnViewList.addEventListener('click', () => setSpaceView('list'));
elBtnViewMap.addEventListener('click', () => setSpaceView('map'));

window.addEventListener('popstate', () => {
    restoreRouteFromLocation().catch(() => {
        resetToHomeState();
        syncUrl({ replace: true });
    });
});

$('btn-graph-zoom-in').addEventListener('click', () => {
    zoomGraphAtAnchor(1.2, getSvgCenterAnchor());
});

$('btn-graph-zoom-out').addEventListener('click', () => {
    zoomGraphAtAnchor(1 / 1.2, getSvgCenterAnchor());
});

$('btn-graph-reset').addEventListener('click', () => {
    state.graphTransform = { scale: 1, tx: 0, ty: 0 };
    applyGraphTransform();
});

let graphDragging = false;
let dragStart = null;
let panelCloseGuardPointerStart = null;
let panelCloseGuardInteractionWasDrag = false;

document.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    panelCloseGuardPointerStart = { x: event.clientX, y: event.clientY };
    panelCloseGuardInteractionWasDrag = false;
});

document.addEventListener('mouseup', (event) => {
    if (!panelCloseGuardPointerStart) return;
    panelCloseGuardInteractionWasDrag = Boolean(memoryPanelInteractions?.interactionWasDrag?.({
        start: panelCloseGuardPointerStart,
        end: { x: event.clientX, y: event.clientY },
        thresholdPx: memoryPanelInteractions?.DRAG_CLOSE_GUARD_THRESHOLD_PX,
    }));
    panelCloseGuardPointerStart = null;
});

elGraphSvg.addEventListener('mousedown', (event) => {
    event.preventDefault();
    graphDragging = true;
    dragStart = {
        x: event.clientX,
        y: event.clientY,
        tx: state.graphTransform.tx,
        ty: state.graphTransform.ty,
    };
});

window.addEventListener('mousemove', (event) => {
    if (!graphDragging || !dragStart) return;
    event.preventDefault();
    state.graphTransform.tx = dragStart.tx + (event.clientX - dragStart.x);
    state.graphTransform.ty = dragStart.ty + (event.clientY - dragStart.y);
    applyGraphTransform();
});

window.addEventListener('mouseup', () => {
    graphDragging = false;
    dragStart = null;
});

elGraphSvg.addEventListener(
    'wheel',
    (event) => {
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1.1 : 0.9;
        const anchor = getSvgAnchorFromClient(event.clientX, event.clientY);
        zoomGraphAtAnchor(direction, anchor);
    },
    { passive: false }
);

// Space title inline edit (rename)
makeEditable(elSpaceTitle, async (newName) => {
    const oldName = state.currentSpace.name;
    await api.patch(`/api/spaces/${enc(oldName)}`, { newName });
    state.currentSpace.name = newName;
    await loadSpaces();
    syncUrl({ replace: true });
});

// Space description inline edit
makeEditable(elSpaceDesc, async (desc) => {
    await api.patch(`/api/spaces/${enc(state.currentSpace.name)}`, { description: desc });
    state.currentSpace.description = desc;
});

// New space modal
$('btn-new-space').addEventListener('click', () => $('modal-new-space').classList.remove('hidden'));
$('modal-space-cancel').addEventListener('click', () => $('modal-new-space').classList.add('hidden'));
$('modal-space-create').addEventListener('click', async () => {
    const name = $('new-space-name').value.trim();
    const desc = $('new-space-desc').value.trim();
    const tags = $('new-space-tags')
        .value.split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    if (!name) return;
    await api.post('/api/spaces', { name, description: desc, tags });
    $('modal-new-space').classList.add('hidden');
    $('new-space-name').value = '';
    $('new-space-desc').value = '';
    $('new-space-tags').value = '';
    await loadSpaces();
    await selectSpace(name);
});

// Delete space
$('btn-delete-space').addEventListener('click', async () => {
    const name = state.currentSpace?.name;
    if (!name) return;
    if (!confirm(`Delete space "${name}" and all its memories?`)) return;
    await api.del(`/api/spaces/${enc(name)}`);
    state.currentSpace = null;
    state.currentMemory = null;
    showMemoryPanel(false);
    showPanel('empty');
    syncUrl();
    await loadSpaces();
});

// New memory modal
$('btn-add-memory').addEventListener('click', () => $('modal-new-memory').classList.remove('hidden'));
$('modal-mem-cancel').addEventListener('click', () => $('modal-new-memory').classList.add('hidden'));
$('modal-mem-create').addEventListener('click', async () => {
    const name = $('new-mem-name').value.trim();
    const content = $('new-mem-content').value;
    const tags = $('new-mem-tags')
        .value.split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    const tier = Number($('new-mem-tier').value);
    if (!name || !state.currentSpace) return;
    await api.post(`/api/spaces/${enc(state.currentSpace.name)}/memories`, { name, content, tags, tier });
    $('modal-new-memory').classList.add('hidden');
    $('new-mem-name').value = '';
    $('new-mem-content').value = '';
    $('new-mem-tags').value = '';
    $('new-mem-tier').value = '2';
    await refreshSpace(state.currentSpace.name);
});

// Memory panel actions
$('btn-mem-close').addEventListener('click', () => {
    closeCurrentMemoryPanel();
});

document.addEventListener('click', (event) => {
    if (!isMemoryPanelOpen()) return;
    if (!memoryPanelInteractions?.shouldCloseMemoryPanelOnClick) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const shouldClose = memoryPanelInteractions.shouldCloseMemoryPanelOnClick({
        isPanelOpen: true,
        targetInsidePanel: Boolean(target.closest('#memory-panel')),
        targetIsMemorySelection: isMemorySelectionTarget(target),
        interactionWasDrag: panelCloseGuardInteractionWasDrag,
    });

    panelCloseGuardInteractionWasDrag = false;

    if (shouldClose) {
        closeCurrentMemoryPanel();
    }
});

$('btn-mem-edit').addEventListener('click', () => {
    elMemEditInput.value = state.currentMemory?.content ?? '';
    elMemContent.classList.add('hidden');
    elMemEditArea.classList.remove('hidden');
    elMemEditInput.focus();
});

$('btn-mem-cancel-edit').addEventListener('click', () => {
    elMemContent.classList.remove('hidden');
    elMemEditArea.classList.add('hidden');
});

$('btn-mem-save').addEventListener('click', async () => {
    const mem = state.currentMemory;
    if (!mem) return;
    const content = elMemEditInput.value;
    await api.patch(`/api/spaces/${enc(mem.space_name)}/memories/${enc(mem.name)}`, { content });
    await refreshMemory(mem.space_name, mem.name);
});

$('btn-mem-promote').addEventListener('click', async () => {
    const mem = state.currentMemory;
    if (!mem) return;
    await api.patch(`/api/spaces/${enc(mem.space_name)}/memories/${enc(mem.name)}`, { promote: true });
    await refreshMemory(mem.space_name, mem.name);
});

$('btn-mem-demote').addEventListener('click', async () => {
    const mem = state.currentMemory;
    if (!mem) return;
    await api.patch(`/api/spaces/${enc(mem.space_name)}/memories/${enc(mem.name)}`, { demote: true });
    await refreshMemory(mem.space_name, mem.name);
});

$('btn-mem-pin').addEventListener('click', async () => {
    const mem = state.currentMemory;
    if (!mem) return;
    await api.patch(`/api/spaces/${enc(mem.space_name)}/memories/${enc(mem.name)}`, { pinned: !mem.pinned });
    await refreshMemory(mem.space_name, mem.name);
});

$('btn-mem-delete').addEventListener('click', async () => {
    const mem = state.currentMemory;
    if (!mem || !confirm(`Delete memory "${mem.name}"?`)) return;
    await api.del(`/api/spaces/${enc(mem.space_name)}/memories/${enc(mem.name)}`);
    state.currentMemory = null;
    showMemoryPanel(false);
    await refreshSpace(mem.space_name);
    syncUrl();
});

// Close search
$('btn-close-search').addEventListener('click', () => {
    state.searchActive = false;
    elGlobalSearch.value = '';
    if (state.currentSpace) showPanel('space');
    else showPanel('empty');
});

// Global search (debounced)
let searchTimer = null;
elGlobalSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = elGlobalSearch.value.trim();
    if (!q) {
        state.searchActive = false;
        if (state.currentSpace) showPanel('space');
        else showPanel('empty');
        return;
    }
    searchTimer = setTimeout(async () => {
        state.searchResults = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
        state.searchActive = true;
        showPanel('search');
        renderSearchResults(state.searchResults, q);
    }, 300);
});

// Modal keyboard close
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        $('modal-new-space').classList.add('hidden');
        $('modal-new-memory').classList.add('hidden');
    }
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function enc(str) {
    return encodeURIComponent(str);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
    await loadSpaces();
    await loadStatus();
    await restoreRouteFromLocation();
}

boot().catch(() => {
    resetToHomeState();
});
