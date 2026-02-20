(function () {
    const API = '/api/brain';

    /** @type {Record<string, { description: string, memories: { name: string, description: string }[] }>} */
    let brain = {};
    /** @type {string | null} */
    let selectedSpaceName = null;
    /** @type {CodeMirror.EditorFromTextArea | null} */
    let memoryEditor = null;
    /** @type {number | null} index of memory being edited, or null for new */
    let editingMemoryIndex = null;

    const $ = (id) => document.getElementById(id);
    const $spaceList = $('space-list');
    const $emptyState = $('empty-state');
    const $spaceDetail = $('space-detail');
    const $spaceName = $('space-name');
    const $spaceDescription = $('space-description');
    const $memoryList = $('memory-list');
    const $modalNewSpace = $('modal-new-space');
    const $newSpaceName = $('new-space-name');
    const $newSpaceDescription = $('new-space-description');

    async function loadBrain() {
        const res = await fetch(API);
        if (!res.ok) throw new Error('Failed to load brain');
        brain = await res.json();
        render();
    }

    async function saveBrain() {
        const res = await fetch(API, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(brain),
        });
        if (!res.ok) throw new Error('Failed to save brain');
        brain = await res.json();
        render();
    }

    function render() {
        const spaceNames = Object.keys(brain);
        $spaceList.innerHTML = spaceNames
            .map(
                (name) =>
                    `<li><button type="button" data-space="${escapeAttr(name)}" class="${selectedSpaceName === name ? 'active' : ''}">${escapeHtml(name)}</button></li>`
            )
            .join('');

        $emptyState.classList.toggle('hidden', selectedSpaceName !== null);
        $spaceDetail.classList.toggle('hidden', selectedSpaceName === null);

        if (selectedSpaceName && brain[selectedSpaceName]) {
            const space = brain[selectedSpaceName];
            $spaceName.value = selectedSpaceName;
            $spaceDescription.value = space.description;
            $spaceName.dataset.current = selectedSpaceName;

            $memoryList.innerHTML = space.memories
                .map(
                    (m, i) =>
                        `<li class="memory-item" data-index="${i}">
          <div class="memory-toolbar">
            <button type="button" class="btn btn-sm btn-secondary memory-move-up">↑</button>
            <button type="button" class="btn btn-sm btn-secondary memory-move-down">↓</button>
            <button type="button" class="btn btn-sm btn-secondary memory-edit">Edit</button>
            <button type="button" class="btn btn-sm btn-danger memory-delete">Delete</button>
          </div>
          <div class="memory-title">${escapeHtml((m && m.name) || '(no name)')}</div>
          <div class="memory-content markdown-body">${renderMarkdown((m && m.description) || '')}</div>
        </li>`
                )
                .join('');

            $memoryList.querySelectorAll('.memory-move-up').forEach((btn) => btn.addEventListener('click', onMoveUp));
            $memoryList.querySelectorAll('.memory-move-down').forEach((btn) => btn.addEventListener('click', onMoveDown));
            $memoryList.querySelectorAll('.memory-edit').forEach((btn) => btn.addEventListener('click', onEditMemory));
            $memoryList.querySelectorAll('.memory-delete').forEach((btn) => btn.addEventListener('click', onDeleteMemory));
        }
    }

    function escapeAttr(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML.replace(/"/g, '&quot;');
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function renderMarkdown(text) {
        if (typeof marked !== 'undefined') return marked.parse(text || '');
        return escapeHtml(text || '');
    }

    $spaceList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-space]');
        if (!btn) return;
        selectedSpaceName = btn.dataset.space;
        render();
    });

    $('btn-new-space').addEventListener('click', () => {
        $newSpaceName.value = '';
        $newSpaceDescription.value = '';
        $modalNewSpace.classList.remove('hidden');
        $newSpaceName.focus();
    });

    $('modal-cancel').addEventListener('click', () => {
        $modalNewSpace.classList.add('hidden');
    });

    $('modal-create').addEventListener('click', () => {
        const name = $newSpaceName.value.trim();
        const description = $newSpaceDescription.value.trim();
        if (!name) return;
        if (brain[name]) {
            alert('A space with that name already exists.');
            return;
        }
        brain[name] = { description, memories: [] };
        $modalNewSpace.classList.add('hidden');
        saveBrain().then(() => {
            selectedSpaceName = name;
            render();
        });
    });

    function applySpaceNameChange() {
        if (!selectedSpaceName || !brain[selectedSpaceName]) return;
        const newName = $spaceName.value.trim();
        if (!newName || newName === selectedSpaceName) return;
        if (brain[newName]) {
            alert('A space with that name already exists.');
            $spaceName.value = selectedSpaceName;
            return;
        }
        brain[newName] = brain[selectedSpaceName];
        delete brain[selectedSpaceName];
        selectedSpaceName = newName;
        saveBrain();
    }

    $spaceName.addEventListener('blur', applySpaceNameChange);

    $('btn-delete-space').addEventListener('click', () => {
        if (!selectedSpaceName) return;
        if (!confirm(`Delete space "${selectedSpaceName}" and all its memories?`)) return;
        delete brain[selectedSpaceName];
        selectedSpaceName = null;
        saveBrain();
    });

    $spaceDescription.addEventListener('change', () => {
        if (!selectedSpaceName || !brain[selectedSpaceName]) return;
        brain[selectedSpaceName].description = $spaceDescription.value;
        saveBrain();
    });

    $('btn-add-memory').addEventListener('click', () => {
        openMemoryModal(null);
    });

    function openMemoryModal(index) {
        editingMemoryIndex = index;
        const container = document.getElementById('memory-editor-modal');
        if (!container) {
            const div = document.createElement('div');
            div.id = 'memory-editor-modal';
            div.className = 'modal';
            div.innerHTML = `
        <div class="modal-content modal-content-wide modal-content-editor">
          <h2>${index !== null ? 'Edit memory' : 'Add memory'}</h2>
          <label for="memory-editor-name">Name</label>
          <input type="text" id="memory-editor-name" class="memory-name-input" placeholder="Memory name" />
          <label for="memory-editor-ta">Description (Markdown)</label>
          <div class="memory-editor-area">
            <textarea id="memory-editor-ta"></textarea>
          </div>
          <div class="modal-actions">
            <button type="button" id="memory-editor-cancel" class="btn btn-secondary">Cancel</button>
            <button type="button" id="memory-editor-save" class="btn btn-primary">Save</button>
          </div>
        </div>`;
            document.body.appendChild(div);
            div.querySelector('#memory-editor-cancel').addEventListener('click', () => closeMemoryModal());
            div.querySelector('#memory-editor-save').addEventListener('click', saveMemoryFromModal);
        }
        const modal = document.getElementById('memory-editor-modal');
        const nameInput = document.getElementById('memory-editor-name');
        const ta = document.getElementById('memory-editor-ta');
        const memory =
            selectedSpaceName && brain[selectedSpaceName] && editingMemoryIndex !== null
                ? brain[selectedSpaceName].memories[editingMemoryIndex]
                : null;
        nameInput.value = memory ? (memory.name || '') : '';
        ta.value = memory ? (memory.description || '') : '';
        if (memoryEditor) {
            memoryEditor.toTextArea();
            memoryEditor = null;
        }
        memoryEditor = CodeMirror.fromTextArea(ta, {
            mode: 'markdown',
            theme: 'base16-dark',
            lineWrapping: true,
            lineNumbers: false,
            indentUnit: 2,
        });
        modal.classList.remove('hidden');
        const editorHeight = () => {
            const area = modal.querySelector('.memory-editor-area');
            if (area) memoryEditor?.setSize(null, area.clientHeight);
        };
        editorHeight();
        setTimeout(() => { editorHeight(); memoryEditor?.refresh(); }, 50);
        window.addEventListener('resize', editorHeight);
        modal._resizeCleanup = () => window.removeEventListener('resize', editorHeight);
    }

    function closeMemoryModal() {
        const modal = document.getElementById('memory-editor-modal');
        if (modal && typeof modal._resizeCleanup === 'function') modal._resizeCleanup();
        if (memoryEditor) {
            memoryEditor.toTextArea();
            memoryEditor = null;
        }
        if (modal) modal.classList.add('hidden');
    }

    function saveMemoryFromModal() {
        const nameInput = document.getElementById('memory-editor-name');
        if (!memoryEditor || !nameInput || !selectedSpaceName || !brain[selectedSpaceName]) {
            closeMemoryModal();
            return;
        }
        const name = nameInput.value.trim();
        const description = memoryEditor.getValue();
        const value = { name, description };
        if (editingMemoryIndex !== null) {
            brain[selectedSpaceName].memories[editingMemoryIndex] = value;
        } else {
            brain[selectedSpaceName].memories.push(value);
        }
        closeMemoryModal();
        saveBrain();
    }

    function onEditMemory(e) {
        const item = e.target.closest('.memory-item');
        if (!item) return;
        const index = parseInt(item.dataset.index, 10);
        openMemoryModal(index);
    }

    function onDeleteMemory(e) {
        const item = e.target.closest('.memory-item');
        if (!item) return;
        const index = parseInt(item.dataset.index, 10);
        if (!selectedSpaceName || !brain[selectedSpaceName]) return;
        const memory = brain[selectedSpaceName].memories[index];
        const name = memory ? (memory.name || '(no name)') : '(no name)';
        if (!confirm(`Delete memory "${name}"? This cannot be undone.`)) return;
        brain[selectedSpaceName].memories.splice(index, 1);
        saveBrain();
    }

    function onMoveUp(e) {
        const item = e.target.closest('.memory-item');
        if (!item) return;
        const index = parseInt(item.dataset.index, 10);
        if (index <= 0 || !selectedSpaceName || !brain[selectedSpaceName]) return;
        const arr = brain[selectedSpaceName].memories;
        [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
        saveBrain();
    }

    function onMoveDown(e) {
        const item = e.target.closest('.memory-item');
        if (!item) return;
        const index = parseInt(item.dataset.index, 10);
        if (!selectedSpaceName || !brain[selectedSpaceName]) return;
        const arr = brain[selectedSpaceName].memories;
        if (index >= arr.length - 1) return;
        [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
        saveBrain();
    }

    loadBrain().catch((err) => {
        console.error(err);
        document.body.innerHTML = '<p style="padding: 2rem; color: #dc2626;">Failed to load brain. Is the server running?</p>';
    });
})();
