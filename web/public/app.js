// ── mind web UI ──────────────────────────────────────────────────────────────

// ── API ───────────────────────────────────────────────────────────────────────
const api = {
    async get(path) {
        const r = await fetch(path);
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
    },
    async post(path, body) {
        const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
    },
    async patch(path, body) {
        const r = await fetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
    memories: [],      // MemorySummary[]
    currentMemory: null, // Memory (full)
    searchActive: false,
    searchResults: [],
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const elSpaceList       = $('space-list');
const elEmptyState      = $('empty-state');
const elSpaceDetail     = $('space-detail');
const elSearchResults   = $('search-results');
const elMemoryPanel     = $('memory-panel');
const elGlobalSearch    = $('global-search');
const elSpaceTitle      = $('space-title');
const elSpaceDesc       = $('space-desc');
const elSpaceTagsRow    = $('space-tags-row');
const elSearchList      = $('search-list');
const elSearchHeading   = $('search-heading');
const elMemTitle        = $('mem-title');
const elMemTierBadge    = $('mem-tier-badge');
const elMemTagsRow      = $('mem-tags-row');
const elMemContent      = $('mem-content');
const elMemEditArea     = $('mem-edit-area');
const elMemEditInput    = $('mem-edit-input');

// ── Tier helpers ──────────────────────────────────────────────────────────────
const TIER_LABEL = { 1: '🔴 T1 — Hot', 2: '🟡 T2 — Warm', 3: '🔵 T3 — Cold' };
const TIER_CLASS = { 1: 't1', 2: 't2', 3: 't3' };

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
    renderTagRow(elSpaceTagsRow, sp.tags ?? [], async (tag) => {
        await api.patch(`/api/spaces/${enc(sp.name)}`, { removeTag: tag });
        await refreshSpace(sp.name);
    }, async () => {
        const tag = prompt('Tag name:');
        if (tag) {
            await api.patch(`/api/spaces/${enc(sp.name)}`, { addTag: tag.trim().toLowerCase() });
            await refreshSpace(sp.name);
        }
    });

    // Tier containers
    for (const tier of [1, 2, 3]) {
        const ul = document.querySelector(`#tiers .memory-list[data-tier="${tier}"]`);
        const mems = state.memories.filter(m => m.tier === tier);
        ul.innerHTML = '';
        if (mems.length === 0) {
            ul.innerHTML = '<li class="tier-empty">Empty</li>';
        } else {
            for (const mem of mems) {
                ul.appendChild(renderMemoryItem(mem, sp.name));
            }
        }
    }
}

function renderMemoryItem(mem, spaceName) {
    const li = document.createElement('li');
    li.className = 'memory-item' + (state.currentMemory?.id === mem.id ? ' active' : '');
    li.dataset.id = mem.id;
    li.dataset.name = mem.name;

    const tags = (mem.tags ?? []).slice(0, 3).map(t => `<span class="memory-item-tag">${esc(t)}</span>`).join('');

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

    renderTagRow(elMemTagsRow, memory.tags ?? [], async (tag) => {
        await api.patch(`/api/spaces/${enc(memory.space_name)}/memories/${enc(memory.name)}`, { removeTag: tag });
        await refreshMemory(memory.space_name, memory.name);
    }, async () => {
        const tag = prompt('Tag name:');
        if (tag) {
            await api.patch(`/api/spaces/${enc(memory.space_name)}/memories/${enc(memory.name)}`, { addTag: tag.trim().toLowerCase() });
            await refreshMemory(memory.space_name, memory.name);
        }
    });

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
        li.innerHTML = `
            <span class="memory-item-name">${esc(r.name)}</span>
            <span class="memory-item-tags">${(r.tags ?? []).slice(0, 2).map(t => `<span class="memory-item-tag">${esc(t)}</span>`).join('')}</span>
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

// ── Actions ───────────────────────────────────────────────────────────────────

async function loadSpaces() {
    state.spaces = await api.get('/api/spaces');
    renderSpaceList();
}

async function selectSpace(name) {
    state.currentSpace = state.spaces.find(s => s.name === name) ?? { name };
    state.currentMemory = null;
    showMemoryPanel(false);

    const [spaceData, memories] = await Promise.all([
        api.get(`/api/spaces/${enc(name)}`),
        api.get(`/api/spaces/${enc(name)}/memories`),
    ]);
    state.currentSpace = spaceData;
    state.memories = memories;

    showPanel('space');
    renderSpaceList();
    renderSpaceDetail();
}

async function refreshSpace(name) {
    const [spaceData, memories] = await Promise.all([
        api.get(`/api/spaces/${enc(name)}`),
        api.get(`/api/spaces/${enc(name)}/memories`),
        loadSpaces(),
    ]);
    state.currentSpace = spaceData;
    state.memories = memories;
    renderSpaceDetail();
}

async function selectMemory(spaceName, memName) {
    const memory = await api.get(`/api/spaces/${enc(spaceName)}/memories/${enc(memName)}`);
    state.currentMemory = memory;
    renderMemoryPanel(memory);
    showMemoryPanel(true);
    // Re-render memory list to show active state
    renderSpaceDetail();
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
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); done(true); }
            if (e.key === 'Escape') done(false);
        });
    });
}

// ── Event wiring ──────────────────────────────────────────────────────────────

// Space title inline edit (rename)
makeEditable(elSpaceTitle, async (newName) => {
    const oldName = state.currentSpace.name;
    await api.patch(`/api/spaces/${enc(oldName)}`, { newName });
    state.currentSpace.name = newName;
    await loadSpaces();
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
    const tags = $('new-space-tags').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
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
    await loadSpaces();
});

// New memory modal
$('btn-add-memory').addEventListener('click', () => $('modal-new-memory').classList.remove('hidden'));
$('modal-mem-cancel').addEventListener('click', () => $('modal-new-memory').classList.add('hidden'));
$('modal-mem-create').addEventListener('click', async () => {
    const name = $('new-mem-name').value.trim();
    const content = $('new-mem-content').value;
    const tags = $('new-mem-tags').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
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
    state.currentMemory = null;
    showMemoryPanel(false);
    renderSpaceDetail();
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
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        $('modal-new-space').classList.add('hidden');
        $('modal-new-memory').classList.add('hidden');
    }
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function enc(str) {
    return encodeURIComponent(str);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadSpaces();
