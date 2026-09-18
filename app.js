const STORAGE_KEY = 'storyboard-studio-workspace-v2';
const LEGACY_KEY = 'storyboard-studio-project-v1';

let currentPageIndex = 0;
let selectedItemId = null;
let activeInspector = 'page';
let draggedAssetId = null;
let transform = null;
let zoom = 1;
let toastTimer;
let saveTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const createId = (prefix = 'id') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
let project = loadProject();

function blankPage(title = 'Página 1') { return { id: createId('page'), title, items: [] }; }
function defaultProject() { return { title: 'Mi nuevo video', author: 'Tu nombre', date: new Date().toISOString().slice(0, 10), ratio: 'landscape', background: '#f4f4ef', gap: 16, padding: 4, defaultFit: 'cover', showLabels: false, photosPerPage: 4, layoutDirection: 'grid', assets: [], pages: [blankPage()] }; }

function normalizeProject(data) {
  const base = defaultProject();
  const normalized = { ...base, ...data };
  normalized.assets = Array.isArray(data.assets) ? data.assets : [];
  normalized.pages = Array.isArray(data.pages) && data.pages.length ? data.pages.map((page, index) => ({ ...blankPage(`Página ${index + 1}`), ...page, items: Array.isArray(page.items) ? page.items : [] })) : [blankPage()];
  return normalized;
}

function migrateLegacy() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (!legacy || !Array.isArray(legacy.shots) || !legacy.shots.length) return null;
    const migrated = defaultProject();
    migrated.title = legacy.title || migrated.title;
    migrated.author = legacy.author || migrated.author;
    migrated.date = legacy.date || migrated.date;
    migrated.assets = legacy.shots.filter(shot => shot.image).map((shot, index) => ({ id: `asset-migrated-${index}-${Date.now()}`, name: shot.title || `Foto ${index + 1}`, image: shot.image, width: 1600, height: 900 }));
    return migrated;
  } catch { return null; }
}

function loadProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.assets)) return normalizeProject(saved);
  } catch { /* Use a fresh project below. */ }
  return migrateLegacy() || defaultProject();
}

function currentPage() { return project.pages[currentPageIndex] || project.pages[0]; }
function findItem(id) { return currentPage()?.items.find(item => item.id === id); }
function findAsset(id) { return project.assets.find(asset => asset.id === id); }
function placedAssetIds() { return new Set(project.pages.flatMap(page => page.items.map(item => item.assetId))); }

function saveProject() {
  clearTimeout(saveTimer);
  $('#saveState').innerHTML = '<span class="status-dot is-saving"></span>Guardando…';
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      $('#saveState').innerHTML = '<span class="status-dot"></span>Guardado local';
    } catch {
      $('#saveState').innerHTML = '<span class="status-dot"></span>En memoria';
      showToast('El proyecto es muy pesado para guardarlo completo en este navegador');
    }
  }, 320);
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function pageFormatClass() { return project.ratio === 'portrait' ? 'format-portrait' : project.ratio === 'square' ? 'format-square' : ''; }
function getPageAspect() { return project.ratio === 'portrait' ? 9 / 16 : project.ratio === 'square' ? 1 : 16 / 9; }

function itemMarkup(item) {
  const asset = findAsset(item.assetId); if (!asset) return '';
  const label = item.title || asset.name || 'Foto';
  return `<div class="design-item ${item.fit === 'contain' ? 'fit-contain' : 'fit-cover'} ${item.id === selectedItemId ? 'is-selected' : ''}" data-item-id="${item.id}" style="left:${item.x}%;top:${item.y}%;width:${item.width}%;height:${item.height}%" draggable="false">
    <img src="${asset.image}" alt="${escapeHtml(label)}" style="object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" />
    ${project.showLabels ? `<span class="item-label">${escapeHtml(label)}</span>` : ''}<button class="resize-handle" data-resize="${item.id}" type="button" aria-label="Cambiar tamaño"></button>
  </div>`;
}

function renderLibrary() {
  const placed = placedAssetIds();
  $('#assetCount').textContent = project.assets.length;
  $('#clearLibraryBtn').hidden = !project.assets.length;
  $('#libraryEmpty').hidden = !!project.assets.length;
  $('#assetGrid').innerHTML = project.assets.map((asset, index) => `<div class="asset-thumb ${placed.has(asset.id) ? 'is-placed' : ''}" draggable="true" data-asset-id="${asset.id}" title="${escapeHtml(asset.name)}"><img src="${asset.image}" alt="${escapeHtml(asset.name)}" /><span class="asset-thumb-index">${String(index + 1).padStart(2, '0')}</span><button class="asset-thumb-action" data-add-asset="${asset.id}" type="button" title="Agregar al artboard">＋</button></div>`).join('');
  $$('.asset-thumb').forEach(thumb => {
    thumb.addEventListener('dragstart', event => { draggedAssetId = thumb.dataset.assetId; thumb.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', draggedAssetId); });
    thumb.addEventListener('dragend', () => { draggedAssetId = null; thumb.classList.remove('is-dragging'); });
    thumb.addEventListener('dblclick', () => addAssetToPage(thumb.dataset.assetId));
    thumb.querySelector('[data-add-asset]')?.addEventListener('click', event => { event.stopPropagation(); addAssetToPage(thumb.dataset.assetId); });
  });
}

function renderPage() {
  const page = currentPage();
  $('#canvasPage').className = `canvas-page ${pageFormatClass()}`;
  $('#canvasPage').style.background = page ? project.background : '#f4f4ef';
  $('#canvasPage').innerHTML = page?.items.length ? page.items.map(itemMarkup).join('') : '<div class="empty-page"><div><span>▱</span><strong>Tu artboard está vacío</strong><small>Arrastrá una foto desde la biblioteca</small></div></div>';
  $$('.design-item').forEach(item => bindDesignItem(item));
  $('#pageNumber').textContent = currentPageIndex + 1;
  $('#pageTotal').textContent = project.pages.length;
  $('#prevPageBtn').disabled = currentPageIndex === 0;
  $('#nextPageBtn').disabled = currentPageIndex >= project.pages.length - 1;
  $('#selectionStatus').textContent = selectedItemId ? 'Foto seleccionada · arrastrá para moverla' : 'Seleccioná una foto para editarla';
  $('#selectionStatus').classList.toggle('photo-selected', !!selectedItemId);
}

function renderControls() {
  $('#projectTitle').value = project.title;
  $('#projectAuthor').value = project.author;
  $('#projectDate').value = project.date;
  $('#breadcrumbTitle').textContent = project.title || 'Sin título';
  $('#photosPerPage').value = project.photosPerPage;
  $('#layoutDirection').value = project.layoutDirection;
  $('#backgroundColor').value = project.background;
  $('#backgroundValue').textContent = project.background.toUpperCase();
  $('#pageGap').value = project.gap;
  $('#pageGapValue').textContent = `${project.gap} px`;
  $('#pagePadding').value = project.padding;
  $('#pagePaddingValue').textContent = `${project.padding}%`;
  $('#showLabels').checked = project.showLabels;
  $$('.format-btn').forEach(button => button.classList.toggle('is-active', button.dataset.format === project.ratio));
  $$('.fit-default-btn').forEach(button => button.classList.toggle('is-active', button.dataset.fit === project.defaultFit));
  document.documentElement.style.setProperty('--zoom', zoom);
}

function renderInspector() {
  $('#pageInspector').hidden = activeInspector !== 'page';
  $('#photoInspector').hidden = activeInspector !== 'photo';
  $$('.inspector-tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.inspector === activeInspector));
  const item = findItem(selectedItemId);
  $('#noSelection').hidden = !!item;
  $('#selectedPhotoForm').hidden = !item;
  if (!item) return;
  const asset = findAsset(item.assetId);
  $('#selectedPreview').innerHTML = asset ? `<img src="${asset.image}" alt="" />` : '';
  $('#selectedPhotoName').textContent = item.title || asset?.name || 'Foto';
  $('#selectedPhotoSize').textContent = asset ? `${asset.width} × ${asset.height} px` : '—';
  $('#photoWidth').value = Math.round(item.width); $('#photoHeight').value = Math.round(item.height);
  $('#photoWidthValue').textContent = `${Math.round(item.width)}%`; $('#photoHeightValue').textContent = `${Math.round(item.height)}%`;
  $('#photoFocusX').value = item.focusX ?? 50; $('#photoFocusY').value = item.focusY ?? 50;
  $('#focusValue').textContent = `${Math.round(item.focusX ?? 50)}% / ${Math.round(item.focusY ?? 50)}%`;
  $('#photoTitle').value = item.title || '';
  $$('.fit-btn').forEach(button => button.classList.toggle('is-active', button.dataset.fit === item.fit));
}

function render() { renderControls(); renderLibrary(); renderPage(); renderInspector(); }

function selectItem(id) { selectedItemId = id; activeInspector = 'photo'; renderPage(); renderInspector(); }

function bindDesignItem(element) {
  const id = element.dataset.itemId;
  element.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-resize]')) return startTransform(event, id, 'resize');
    startTransform(event, id, 'move');
  });
  element.addEventListener('click', event => { event.stopPropagation(); selectItem(id); });
}

function startTransform(event, id, mode) {
  const item = findItem(id); if (!item) return;
  event.preventDefault(); selectItem(id);
  const rect = $('#canvasPage').getBoundingClientRect();
  transform = { id, mode, rect, startX: event.clientX, startY: event.clientY, original: { x: item.x, y: item.y, width: item.width, height: item.height } };
  const target = event.currentTarget; target.classList.add('is-dragging');
  const onMove = moveEvent => updateTransform(moveEvent);
  const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); target.classList.remove('is-dragging'); transform = null; saveProject(); renderInspector(); };
  document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp, { once: true });
}

function updateTransform(event) {
  if (!transform) return;
  const item = findItem(transform.id); if (!item) return;
  const dx = ((event.clientX - transform.startX) / transform.rect.width) * 100;
  const dy = ((event.clientY - transform.startY) / transform.rect.height) * 100;
  if (transform.mode === 'move') { item.x = clamp(transform.original.x + dx, 0, 100 - item.width); item.y = clamp(transform.original.y + dy, 0, 100 - item.height); }
  else {
    let width = clamp(transform.original.width + dx, 8, 100 - transform.original.x);
    let height = clamp(transform.original.height + dy, 8, 100 - transform.original.y);
    if ($('#lockRatio').checked) { const ratio = transform.original.width / transform.original.height; if (Math.abs(dx) >= Math.abs(dy)) height = clamp(width / ratio, 8, 100 - transform.original.y); else width = clamp(height * ratio, 8, 100 - transform.original.x); }
    item.width = width; item.height = height;
  }
  renderPage(); renderInspector();
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function addAssetToPage(assetId, position = null) {
  const asset = findAsset(assetId); const page = currentPage(); if (!asset || !page) return;
  const item = { id: createId('item'), assetId, x: position ? clamp(position.x - 14, 0, 70) : 8 + (page.items.length % 3) * 4, y: position ? clamp(position.y - 14, 0, 70) : 8 + (page.items.length % 3) * 4, width: 30, height: 30, fit: project.defaultFit, focusX: 50, focusY: 50, title: '' };
  page.items.push(item); selectedItemId = item.id; activeInspector = 'photo'; render(); saveProject(); showToast('Foto agregada al artboard');
}

function layoutDimensions(count) {
  if (project.layoutDirection === 'columns') return { cols: count, rows: 1 };
  if (project.layoutDirection === 'rows') return { cols: 1, rows: count };
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  return { cols, rows: Math.ceil(count / cols) };
}

function createAutoItems(assets) {
  const { cols, rows } = layoutDimensions(assets.length); const pad = project.padding; const gap = project.gap / 10; const usableW = 100 - pad * 2; const usableH = 100 - pad * 2; const cellW = (usableW - gap * (cols - 1)) / cols; const cellH = (usableH - gap * (rows - 1)) / rows;
  return assets.map((asset, index) => { const col = index % cols; const row = Math.floor(index / cols); return { id: createId('item'), assetId: asset.id, x: pad + col * (cellW + gap), y: pad + row * (cellH + gap), width: cellW, height: cellH, fit: project.defaultFit, focusX: 50, focusY: 50, title: '' }; });
}

function autoArrange() {
  const perPage = Number(project.photosPerPage) || 4; const chunks = [];
  for (let index = 0; index < project.assets.length; index += perPage) chunks.push(project.assets.slice(index, index + perPage));
  project.pages = chunks.length ? chunks.map((assets, index) => ({ ...blankPage(`Página ${index + 1}`), items: createAutoItems(assets) })) : [blankPage()];
  currentPageIndex = 0; selectedItemId = null; activeInspector = 'page'; render(); saveProject(); showToast(project.pages.length > 1 ? `${project.pages.length} páginas creadas automáticamente` : 'Fotos ordenadas en el artboard');
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const image = new Image();
    image.onload = () => { const max = 1800; const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url); resolve({ image: canvas.toDataURL('image/jpeg', .86), width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); }; image.src = url;
  });
}

async function handleFiles(fileList) {
  const files = [...fileList].filter(file => file.type.startsWith('image/')); if (!files.length) { showToast('Elegí archivos de imagen JPG, PNG o WEBP'); return; }
  try {
    const incoming = await Promise.all(files.map(async file => { const compressed = await compressImage(file); return { id: createId('asset'), name: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '), ...compressed }; }));
    project.assets.push(...incoming); render(); saveProject(); showToast(`${incoming.length} foto${incoming.length === 1 ? '' : 's'} cargada${incoming.length === 1 ? '' : 's'} en la biblioteca`);
  } catch { showToast('No se pudo leer alguna de las fotos'); }
}

function deleteSelected() { if (!selectedItemId) return; const page = currentPage(); page.items = page.items.filter(item => item.id !== selectedItemId); selectedItemId = null; activeInspector = 'page'; render(); saveProject(); showToast('Foto quitada del artboard'); }
function duplicateSelected() { const item = findItem(selectedItemId); if (!item) return; const copy = { ...item, id: createId('item'), x: clamp(item.x + 4, 0, 100 - item.width), y: clamp(item.y + 4, 0, 100 - item.height) }; currentPage().items.push(copy); selectedItemId = copy.id; render(); saveProject(); showToast('Foto duplicada'); }

function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function downloadProject() { downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${project.title || 'storyboard'}.json`); showToast('Proyecto editable exportado'); }

function drawImageInBox(ctx, image, x, y, width, height, fit, focusX = 50, focusY = 50) {
  if (fit === 'contain') { const scale = Math.min(width / image.width, height / image.height); const drawW = image.width * scale; const drawH = image.height * scale; ctx.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH); return; }
  const scale = Math.max(width / image.width, height / image.height); const drawW = image.width * scale; const drawH = image.height * scale; const freeX = width - drawW; const freeY = height - drawH; ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); ctx.drawImage(image, x + freeX * (focusX / 100), y + freeY * (focusY / 100), drawW, drawH); ctx.restore();
}

async function renderPageCanvas(page) {
  const width = project.ratio === 'portrait' ? 900 : 1600; const height = Math.round(width / getPageAspect()); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.fillStyle = project.background; ctx.fillRect(0, 0, width, height);
  await Promise.all(page.items.map(item => new Promise(resolve => { const asset = findAsset(item.assetId); if (!asset) return resolve(); const image = new Image(); image.onload = () => { drawImageInBox(ctx, image, item.x / 100 * width, item.y / 100 * height, item.width / 100 * width, item.height / 100 * height, item.fit, item.focusX, item.focusY); if (project.showLabels && item.title) { const x = item.x / 100 * width, y = (item.y + item.height) / 100 * height - 35; ctx.fillStyle = 'rgba(23,35,39,.78)'; ctx.fillRect(x + 10, y, Math.min(item.width / 100 * width - 20, 450), 25); ctx.fillStyle = '#fff'; ctx.font = '14px Arial'; ctx.fillText(item.title.slice(0, 42), x + 18, y + 17); } resolve(); }; image.onerror = resolve; image.src = asset.image; })));
  return canvas;
}

async function exportImage(type) { const canvas = await renderPageCanvas(currentPage()); canvas.toBlob(blob => { downloadBlob(blob, `${project.title || 'storyboard'}-pagina-${currentPageIndex + 1}.${type}`); showToast(`Página exportada como ${type.toUpperCase()}`); }, type === 'jpg' ? 'image/jpeg' : 'image/png', .92); }

function printAllPages() {
  const layer = document.createElement('div'); layer.className = 'print-layer';
  project.pages.forEach(page => { const sheet = document.createElement('div'); sheet.className = `canvas-page print-page ${pageFormatClass()}`; sheet.style.background = project.background; page.items.forEach(item => { const asset = findAsset(item.assetId); if (!asset) return; const node = document.createElement('div'); node.className = `design-item ${item.fit === 'contain' ? 'fit-contain' : 'fit-cover'}`; node.style.cssText = `left:${item.x}%;top:${item.y}%;width:${item.width}%;height:${item.height}%`; node.innerHTML = `<img src="${asset.image}" alt="" style="object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" />${project.showLabels && item.title ? `<span class="item-label">${escapeHtml(item.title)}</span>` : ''}`; sheet.appendChild(node); }); layer.appendChild(sheet); });
  document.body.appendChild(layer); const cleanup = () => layer.remove(); window.addEventListener('afterprint', cleanup, { once: true }); window.print(); setTimeout(cleanup, 2500);
}

function openExport() { $('#exportModal').hidden = false; }
function closeExport() { $('#exportModal').hidden = true; }
function resetProject() { if ((project.assets.length || project.pages.some(page => page.items.length)) && !window.confirm('¿Crear un proyecto nuevo? El proyecto actual se conserva solo si lo exportaste.')) return; project = defaultProject(); currentPageIndex = 0; selectedItemId = null; activeInspector = 'page'; render(); saveProject(); showToast('Nuevo proyecto listo'); }

function prepareMigratedProject() {
  if (localStorage.getItem(STORAGE_KEY) || !project.assets.length || project.pages.some(page => page.items.length)) return;
  const perPage = Number(project.photosPerPage) || 4; const chunks = [];
  for (let index = 0; index < project.assets.length; index += perPage) chunks.push(project.assets.slice(index, index + perPage));
  project.pages = chunks.map((assets, index) => ({ ...blankPage(`Página ${index + 1}`), items: createAutoItems(assets) }));
}

$('#uploadZone').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', event => { handleFiles(event.target.files); event.target.value = ''; });
$('#uploadZone').addEventListener('dragover', event => { event.preventDefault(); $('#uploadZone').classList.add('is-over'); });
$('#uploadZone').addEventListener('dragleave', () => $('#uploadZone').classList.remove('is-over'));
$('#uploadZone').addEventListener('drop', event => { event.preventDefault(); $('#uploadZone').classList.remove('is-over'); handleFiles(event.dataTransfer.files); });

$('#importBtn').addEventListener('click', () => $('#projectInput').click());
$('#projectInput').addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader(); reader.onload = () => { try { const imported = JSON.parse(reader.result); if (!Array.isArray(imported.assets) || !Array.isArray(imported.pages)) throw new Error(); project = normalizeProject(imported); currentPageIndex = 0; selectedItemId = null; activeInspector = 'page'; render(); saveProject(); showToast('Proyecto importado correctamente'); } catch { showToast('Ese archivo no parece un proyecto válido'); } }; reader.readAsText(file); event.target.value = '';
});

$('#canvasPage').addEventListener('click', event => { if (event.target === $('#canvasPage')) { selectedItemId = null; activeInspector = 'page'; render(); } });
$('#canvasPage').addEventListener('dragover', event => { event.preventDefault(); $('#canvasPage').classList.add('is-drop-target'); });
$('#canvasPage').addEventListener('dragleave', event => { if (!$('#canvasPage').contains(event.relatedTarget)) $('#canvasPage').classList.remove('is-drop-target'); });
$('#canvasPage').addEventListener('drop', event => { event.preventDefault(); $('#canvasPage').classList.remove('is-drop-target'); const rect = $('#canvasPage').getBoundingClientRect(); const position = { x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 }; if (draggedAssetId) { addAssetToPage(draggedAssetId, position); draggedAssetId = null; } else if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files); });

$('#autoArrangeBtn').addEventListener('click', autoArrange);
$('#photosPerPage').addEventListener('change', event => { project.photosPerPage = Number(event.target.value); saveProject(); });
$('#layoutDirection').addEventListener('change', event => { project.layoutDirection = event.target.value; saveProject(); });
$$('.format-btn').forEach(button => button.addEventListener('click', () => { project.ratio = button.dataset.format; render(); saveProject(); }));
$('#zoomOutBtn').addEventListener('click', () => { zoom = clamp(zoom - .1, .6, 1.4); renderControls(); }); $('#zoomInBtn').addEventListener('click', () => { zoom = clamp(zoom + .1, .6, 1.4); renderControls(); });
$('#prevPageBtn').addEventListener('click', () => { if (currentPageIndex > 0) { currentPageIndex--; selectedItemId = null; render(); } }); $('#nextPageBtn').addEventListener('click', () => { if (currentPageIndex < project.pages.length - 1) { currentPageIndex++; selectedItemId = null; render(); } });
$('#addPageBtn').addEventListener('click', () => { project.pages.push(blankPage(`Página ${project.pages.length + 1}`)); currentPageIndex = project.pages.length - 1; selectedItemId = null; render(); saveProject(); showToast('Página nueva agregada'); });

['projectTitle', 'projectAuthor', 'projectDate'].forEach(id => $('#' + id).addEventListener('input', event => { const key = { projectTitle: 'title', projectAuthor: 'author', projectDate: 'date' }[id]; project[key] = event.target.value; $('#breadcrumbTitle').textContent = project.title || 'Sin título'; saveProject(); }));
$('#backgroundColor').addEventListener('input', event => { project.background = event.target.value; render(); saveProject(); });
$('#pageGap').addEventListener('input', event => { project.gap = Number(event.target.value); renderControls(); saveProject(); }); $('#pagePadding').addEventListener('input', event => { project.padding = Number(event.target.value); renderControls(); saveProject(); }); $('#showLabels').addEventListener('change', event => { project.showLabels = event.target.checked; render(); saveProject(); });
$$('.fit-default-btn').forEach(button => button.addEventListener('click', () => { project.defaultFit = button.dataset.fit; renderControls(); saveProject(); }));
$('#clearPageBtn').addEventListener('click', () => { if (!currentPage().items.length || window.confirm('¿Limpiar todas las fotos de esta página?')) { currentPage().items = []; selectedItemId = null; render(); saveProject(); } });

$$('.inspector-tab').forEach(tab => tab.addEventListener('click', () => { activeInspector = tab.dataset.inspector; renderInspector(); }));
$$('.fit-btn').forEach(button => button.addEventListener('click', () => { const item = findItem(selectedItemId); if (!item) return; item.fit = button.dataset.fit; renderPage(); renderInspector(); saveProject(); }));
$('#photoWidth').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; const nextWidth = clamp(Number(event.target.value) || 8, 8, 100 - item.x); if ($('#lockRatio').checked) { const ratio = item.width / item.height; item.width = nextWidth; item.height = clamp(nextWidth / ratio, 8, 100 - item.y); } else item.width = nextWidth; renderPage(); renderInspector(); saveProject(); });
$('#photoHeight').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; const nextHeight = clamp(Number(event.target.value) || 8, 8, 100 - item.y); if ($('#lockRatio').checked) { const ratio = item.width / item.height; item.height = nextHeight; item.width = clamp(nextHeight * ratio, 8, 100 - item.x); } else item.height = nextHeight; renderPage(); renderInspector(); saveProject(); });
$('#photoFocusX').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.focusX = Number(event.target.value); renderPage(); renderInspector(); saveProject(); }); $('#photoFocusY').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.focusY = Number(event.target.value); renderPage(); renderInspector(); saveProject(); }); $('#photoTitle').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.title = event.target.value; renderPage(); saveProject(); });
$('#deletePhotoBtn').addEventListener('click', deleteSelected); $('#duplicatePhotoBtn').addEventListener('click', duplicateSelected); $('#clearLibraryBtn').addEventListener('click', () => { if (window.confirm('¿Quitar todas las fotos de la biblioteca?')) { project.assets = []; project.pages.forEach(page => { page.items = []; }); selectedItemId = null; render(); saveProject(); } });

$('#newProjectBtn').addEventListener('click', resetProject); $('#exportBtn').addEventListener('click', openExport); $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeExport)); $('#exportModal').addEventListener('click', event => { if (event.target === $('#exportModal')) closeExport(); });
$$('[data-export]').forEach(button => button.addEventListener('click', async () => { const type = button.dataset.export; closeExport(); if (type === 'json') downloadProject(); else if (type === 'print') printAllPages(); else await exportImage(type); }));

document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); showToast('Proyecto guardado'); } if (event.key === 'Delete' && selectedItemId && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) deleteSelected(); if (event.key === 'Escape') closeExport(); });

prepareMigratedProject();
render();
