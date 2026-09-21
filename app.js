const STORAGE_KEY = 'storyboard-studio-workspace-v2';
const LEGACY_KEY = 'storyboard-studio-project-v1';
const PROJECTS_KEY = 'storyboard-studio-projects-v1';
const CURRENT_PROJECT_KEY = 'storyboard-studio-current-project-v1';

let currentPageIndex = 0;
let selectedItemId = null;
let activeInspector = 'page';
let draggedAssetId = null;
let slotMode = false;
let hoverSlotIndex = null;
let slotDrag = null;
let zoom = 1;
let toastTimer;
let saveTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const createId = (prefix = 'id') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
let project = null;
let projects = loadProjects();
let currentProjectId = null;

function blankPage(title = 'Página 1') { return { id: createId('page'), title, items: [] }; }
function defaultProject() { return { version: 2, title: 'Storyboard X', author: 'Tu nombre', date: new Date().toISOString().slice(0, 10), ratio: 'landscape', formatLocked: false, showProjectTitle: true, background: '#ffffff', padding: 4, gap: 16, defaultFit: 'contain', showDescriptions: true, photosPerPage: 4, layoutDirection: 'grid', assets: [], pages: [blankPage()] }; }

function normalizeProject(data) {
  const base = defaultProject();
  const normalized = { ...base, ...data };
  normalized.id = data.id || createId('project');
  normalized.createdAt = data.createdAt || new Date().toISOString();
  normalized.updatedAt = data.updatedAt || normalized.createdAt;
  if (normalized.title === 'Mi nuevo video') normalized.title = 'Storyboard X';
  const migrateOldCropDefault = data.version !== 2;
  normalized.version = 2;
  normalized.formatLocked = typeof data.formatLocked === 'boolean' ? data.formatLocked : true;
  normalized.showProjectTitle = typeof data.showProjectTitle === 'boolean' ? data.showProjectTitle : true;
  normalized.showDescriptions = typeof data.showDescriptions === 'boolean' ? data.showDescriptions : true;
  if (migrateOldCropDefault) normalized.defaultFit = 'contain';
  normalized.assets = Array.isArray(data.assets) ? data.assets : [];
  normalized.pages = Array.isArray(data.pages) && data.pages.length ? data.pages.map((page, index) => ({ ...blankPage(`Página ${index + 1}`), ...page, items: Array.isArray(page.items) ? page.items.map((item, itemIndex) => ({ ...item, title: item.title || '', description: item.description || '', slot: Number.isFinite(item.slot) ? item.slot : itemIndex, fit: migrateOldCropDefault ? 'contain' : (item.fit || normalized.defaultFit) })) : [] })) : [blankPage()];
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

function loadProjects() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECTS_KEY));
    if (Array.isArray(saved)) return saved.map(normalizeProject);
  } catch { /* Recover from the single-project format below. */ }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.assets)) return [normalizeProject(saved)];
  } catch { /* Start with an empty dashboard below. */ }
  const legacy = migrateLegacy();
  return legacy ? [normalizeProject(legacy)] : [];
}

function projectHasContent(candidate = project) { return !!candidate && (candidate.assets.length > 0 || candidate.pages.some(page => page.items.length > 0)); }
function projectFormatLabel(ratio) { return ratio === 'portrait' ? 'Vertical · 9:16' : ratio === 'square' ? 'Cuadrado · 1:1' : 'Horizontal · 16:9'; }
function projectDateLabel(value) { const date = new Date(value || Date.now()); return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }

function currentPage() { return project.pages[currentPageIndex] || project.pages[0]; }
function findItem(id) { return currentPage()?.items.find(item => item.id === id); }
function findAsset(id) { return project.assets.find(asset => asset.id === id); }
function placedAssetIds() { return new Set(project.pages.flatMap(page => page.items.map(item => item.assetId))); }

function saveProject() {
  if (!project) return;
  const candidate = project;
  candidate.updatedAt = new Date().toISOString();
  const index = projects.findIndex(entry => entry.id === candidate.id);
  if (index === -1) projects.unshift(candidate);
  else projects[index] = candidate;
  clearTimeout(saveTimer);
  $('#saveState').innerHTML = '<span class="status-dot is-saving"></span>Guardando…';
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
      localStorage.setItem(CURRENT_PROJECT_KEY, candidate.id);
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
function layoutDimensions(count = Number(project.photosPerPage) || 4) {
  if (project.layoutDirection === 'columns') return { cols: count, rows: 1 };
  if (project.layoutDirection === 'rows') return { cols: 1, rows: count };
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  return { cols, rows: Math.ceil(count / cols) };
}
function slotRect(slotIndex, count = Number(project.photosPerPage) || 4) {
  const { cols, rows } = layoutDimensions(count); const pad = project.padding; const gap = project.gap / 10; const usableW = 100 - pad * 2; const usableH = 100 - pad * 2; const cellW = (usableW - gap * (cols - 1)) / cols; const cellH = (usableH - gap * (rows - 1)) / rows; const col = slotIndex % cols; const row = Math.floor(slotIndex / cols);
  return { x: pad + col * (cellW + gap), y: pad + row * (cellH + gap), width: cellW, height: cellH };
}
function assetAspect(asset) {
  const width = Number(asset?.width);
  const height = Number(asset?.height);
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

function renderDashboard() {
  const grid = $('#projectGrid');
  if (!grid) return;
  $('#projectCount').textContent = `${projects.length} proyecto${projects.length === 1 ? '' : 's'}`;
  $('#dashboardEmpty').hidden = projects.length > 0;
  grid.innerHTML = projects.map((entry, index) => {
    const asset = entry.assets[0];
    const preview = asset ? `<img src="${asset.image}" alt="" />` : '<span class="project-card-empty-mark">▱</span>';
    const pageCount = entry.pages.length;
    const photoCount = entry.assets.length;
    return `<article class="project-card" style="--card-index:${index}"><button class="project-card-open" data-open-project="${entry.id}" type="button"><span class="project-card-preview ${asset ? '' : 'is-empty'}">${preview}<span class="project-card-format">${projectFormatLabel(entry.ratio)}</span></span><span class="project-card-body"><strong>${escapeHtml(entry.title || 'Sin título')}</strong><small>${escapeHtml(entry.author || 'Sin autor')}</small><span class="project-card-meta"><span>${pageCount} página${pageCount === 1 ? '' : 's'}</span><span>${photoCount} foto${photoCount === 1 ? '' : 's'}</span><span>${projectDateLabel(entry.updatedAt)}</span></span></span><span class="project-card-arrow">↗</span></button></article>`;
  }).join('');
  $$('[data-open-project]', grid).forEach(button => button.addEventListener('click', () => openProject(button.dataset.openProject)));
}

function showDashboard() {
  if (project) saveProject();
  project = null;
  currentProjectId = null;
  $('#dashboardView').hidden = false;
  $('#editorView').hidden = true;
  $('#backToDashboardBtn').hidden = true;
  $('#exportBtn').hidden = true;
  $('#saveState').innerHTML = '<span class="status-dot"></span>Guardado local';
  $('#breadcrumbTitle').textContent = 'Todos los proyectos';
  renderDashboard();
}

function showEditor() {
  $('#dashboardView').hidden = true;
  $('#editorView').hidden = false;
  $('#backToDashboardBtn').hidden = false;
  $('#exportBtn').hidden = false;
  $('#breadcrumbTitle').textContent = project?.title || 'Sin título';
}

function openProject(id) {
  const stored = projects.find(entry => entry.id === id);
  if (!stored) return;
  project = normalizeProject(stored);
  currentProjectId = project.id;
  currentPageIndex = 0;
  selectedItemId = null;
  activeInspector = 'page';
  localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
  showEditor();
  render();
  if (!project.formatLocked) openFormatModal();
}
function itemLayout(item) {
  const slot = slotRect(item.slot ?? 0);
  const descriptionHeight = project.showDescriptions ? Math.min(slot.height * .24, 11) : 0;
  const imageSlot = { x: slot.x, y: slot.y, width: slot.width, height: Math.max(1, slot.height - descriptionHeight) };
  if (item.fit === 'cover') {
    const card = { x: slot.x, y: slot.y, width: slot.width, height: imageSlot.height + descriptionHeight };
    return { card, image: imageSlot, caption: descriptionHeight ? { x: slot.x, y: slot.y + imageSlot.height, width: slot.width, height: descriptionHeight } : null };
  }
  const aspect = assetAspect(findAsset(item.assetId));
  const slotAspect = getPageAspect() * imageSlot.width / imageSlot.height;
  const image = aspect >= slotAspect
    ? { x: 0, y: 0, width: imageSlot.width, height: getPageAspect() * imageSlot.width / aspect }
    : { x: 0, y: 0, width: imageSlot.height * aspect / getPageAspect(), height: imageSlot.height };
  const card = { width: image.width, height: image.height + descriptionHeight };
  card.x = slot.x + (slot.width - card.width) / 2;
  card.y = slot.y + (slot.height - card.height) / 2;
  image.x = card.x;
  image.y = card.y;
  return { card, image, caption: descriptionHeight ? { x: card.x, y: card.y + image.height, width: card.width, height: descriptionHeight } : null };
}
function itemRect(item) { return itemLayout(item).image; }
function slotGuideRect(slotIndex) {
  const sourceAssetId = draggedAssetId || findItem(slotDrag?.id)?.assetId || findItem(selectedItemId)?.assetId;
  return sourceAssetId ? itemRect({ slot: slotIndex, assetId: sourceAssetId, fit: 'contain' }) : slotRect(slotIndex);
}
function slotAtPoint(clientX, clientY) { const rect = $('#canvasPage').getBoundingClientRect(); const x = (clientX - rect.left) / rect.width * 100; const y = (clientY - rect.top) / rect.height * 100; const count = Number(project.photosPerPage) || 4; for (let index = 0; index < count; index += 1) { const slot = slotRect(index, count); if (x >= slot.x && x <= slot.x + slot.width && y >= slot.y && y <= slot.y + slot.height) return index; } return null; }

function itemMarkup(item) {
  const asset = findAsset(item.assetId); if (!asset) return '';
  const label = item.title || asset.name || `Plano ${(item.slot ?? 0) + 1}`;
  const number = String((item.slot ?? 0) + 1).padStart(2, '0');
  const layout = itemLayout(item);
  const imageHeight = layout.image.height / layout.card.height * 100;
  const captionHeight = layout.caption ? layout.caption.height / layout.card.height * 100 : 0;
  const description = item.description?.trim() || '';
  return `<div class="design-item ${item.fit === 'contain' ? 'fit-contain' : 'fit-cover'} ${item.id === selectedItemId ? 'is-selected' : ''}" data-item-id="${item.id}" style="left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%" draggable="false">
    <div class="design-photo" style="height:${imageHeight}%"><img src="${asset.image}" alt="${escapeHtml(label)}" style="object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" /><span class="item-number">${number}</span></div>
    ${project.showDescriptions ? `<div class="description-box ${description ? '' : 'is-empty'}" style="height:${captionHeight}%"><strong>${escapeHtml(label)}</strong><small class="description-editor" contenteditable="true" spellcheck="false" data-placeholder="Agregar descripción…">${escapeHtml(description)}</small></div>` : ''}
  </div>`;
}

function renderLibrary() {
  const placed = placedAssetIds();
  $('#assetCount').textContent = project.assets.length;
  $('#clearLibraryBtn').hidden = !project.assets.length;
  $('#libraryEmpty').hidden = !!project.assets.length;
  $('#assetGrid').innerHTML = project.assets.map((asset, index) => `<div class="asset-thumb ${placed.has(asset.id) ? 'is-placed' : ''}" draggable="true" data-asset-id="${asset.id}" title="${escapeHtml(asset.name)}"><img src="${asset.image}" alt="${escapeHtml(asset.name)}" /><span class="asset-thumb-index">${String(index + 1).padStart(2, '0')}</span><button class="asset-thumb-action" data-add-asset="${asset.id}" type="button" title="Agregar al artboard">＋</button></div>`).join('');
  $$('.asset-thumb').forEach(thumb => {
    thumb.addEventListener('dragstart', event => { draggedAssetId = thumb.dataset.assetId; slotMode = true; thumb.classList.add('is-dragging'); renderPage(); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', draggedAssetId); });
    thumb.addEventListener('dragend', () => { draggedAssetId = null; slotMode = false; hoverSlotIndex = null; thumb.classList.remove('is-dragging'); renderPage(); });
    thumb.addEventListener('dblclick', () => addAssetToPage(thumb.dataset.assetId));
    thumb.querySelector('[data-add-asset]')?.addEventListener('click', event => { event.stopPropagation(); addAssetToPage(thumb.dataset.assetId); });
  });
}

function renderPage() {
  const page = currentPage();
  $('#canvasPage').className = `canvas-page ${pageFormatClass()} ${slotMode ? 'is-slot-mode' : ''}`;
  $('#canvasPage').style.background = page ? project.background : '#ffffff';
  const guides = slotMode ? Array.from({ length: Number(project.photosPerPage) || 4 }, (_, index) => { const rect = slotGuideRect(index); return `<div class="slot-guide ${hoverSlotIndex === index ? 'is-target' : ''}" data-slot-index="${index}" style="left:${rect.x}%;top:${rect.y}%;width:${rect.width}%;height:${rect.height}%"><span>${String(index + 1).padStart(2, '0')}</span></div>`; }).join('') : '';
  const content = page?.items.length ? page.items.map(itemMarkup).join('') : '<div class="empty-page"><div><span>▱</span><strong>Tu artboard está vacío</strong><small>Arrastrá una foto desde la biblioteca</small></div></div>';
  const titleOverlay = project.showProjectTitle && project.title.trim() ? `<div class="project-title-overlay" id="canvasProjectTitle" contenteditable="true" spellcheck="false">${escapeHtml(project.title)}</div>` : '';
  $('#canvasPage').innerHTML = guides + content + titleOverlay;
  $$('.design-item').forEach(item => bindDesignItem(item));
  $$('.description-editor').forEach(editor => {
    editor.addEventListener('pointerdown', event => event.stopPropagation());
    editor.addEventListener('click', event => event.stopPropagation());
    editor.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); editor.blur(); } });
    editor.addEventListener('input', event => { const item = findItem(editor.closest('.design-item')?.dataset.itemId); if (!item) return; item.description = event.currentTarget.textContent.trim(); $('#photoDescription').value = item.description; saveProject(); });
  });
  const titleEditor = $('#canvasProjectTitle');
  if (titleEditor) {
    titleEditor.addEventListener('pointerdown', event => event.stopPropagation());
    titleEditor.addEventListener('click', event => event.stopPropagation());
    titleEditor.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); titleEditor.blur(); } });
    titleEditor.addEventListener('input', event => { project.title = event.currentTarget.textContent.trim(); $('#projectTitle').value = project.title; $('#breadcrumbTitle').textContent = project.title || 'Sin título'; saveProject(); });
  }
  $('#pageNumber').textContent = currentPageIndex + 1;
  $('#pageTotal').textContent = project.pages.length;
  $('#prevPageBtn').disabled = currentPageIndex === 0;
  $('#nextPageBtn').disabled = currentPageIndex >= project.pages.length - 1;
  $('#selectionStatus').textContent = selectedItemId ? 'Foto seleccionada · arrastrá a otro casillero para reordenar' : 'Seleccioná una foto para editarla';
  $('#selectionStatus').classList.toggle('photo-selected', !!selectedItemId);
  renderPageCarousel();
}

function pageThumbnailMarkup(page) {
  if (!page.items.length) return '<div class="page-thumb-empty">Página vacía</div>';
  return page.items.map(item => {
    const asset = findAsset(item.assetId); if (!asset) return '';
    const layout = itemLayout(item);
    const label = item.title || asset.name || `Plano ${(item.slot ?? 0) + 1}`;
    const number = String((item.slot ?? 0) + 1).padStart(2, '0');
    const imageHeight = layout.image.height / layout.card.height * 100;
    const captionHeight = layout.caption ? layout.caption.height / layout.card.height * 100 : 0;
    return `<div class="page-thumb-item" style="left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%"><div class="page-thumb-photo" style="height:${imageHeight}%"><img src="${asset.image}" alt="" /><span>${number}</span></div>${project.showDescriptions ? `<div class="page-thumb-caption" style="height:${captionHeight}%">${escapeHtml(label)}</div>` : ''}</div>`;
  }).join('');
}

function renderPageCarousel() {
  const track = $('#pageCarouselTrack');
  if (!track) return;
  $('#carouselCount').textContent = `${project.pages.length} página${project.pages.length === 1 ? '' : 's'}`;
  track.innerHTML = project.pages.map((page, index) => `<button class="page-thumb ${index === currentPageIndex ? 'is-active' : ''}" data-page-index="${index}" type="button"><span class="page-thumb-canvas ${pageFormatClass()}" style="background:${project.background}">${pageThumbnailMarkup(page)}</span><span class="page-thumb-label">${String(index + 1).padStart(2, '0')} · ${escapeHtml(page.title || `Página ${index + 1}`)}</span></button>`).join('');
  $$('.page-thumb', track).forEach(button => button.addEventListener('click', () => { currentPageIndex = Number(button.dataset.pageIndex); selectedItemId = null; activeInspector = 'page'; render(); }));
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
  $('#showDescriptions').checked = project.showDescriptions;
  $('#showProjectTitle').checked = project.showProjectTitle;
  $$('.format-btn').forEach(button => { button.classList.toggle('is-active', button.dataset.format === project.ratio); button.disabled = project.formatLocked; button.title = project.formatLocked ? 'El formato queda fijo durante este proyecto' : 'Elegí el formato del proyecto'; });
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
  $('#slotNumber').textContent = String((item.slot ?? 0) + 1).padStart(2, '0');
  $('#photoFocusX').value = item.focusX ?? 50; $('#photoFocusY').value = item.focusY ?? 50;
  $('#focusValue').textContent = `${Math.round(item.focusX ?? 50)}% / ${Math.round(item.focusY ?? 50)}%`;
  $('#photoTitle').value = item.title || '';
  $('#photoDescription').value = item.description || '';
  $$('.fit-btn').forEach(button => button.classList.toggle('is-active', button.dataset.fit === item.fit));
}

function render() { renderControls(); renderLibrary(); renderPage(); renderInspector(); }

function selectItem(id) { selectedItemId = id; activeInspector = 'photo'; renderPage(); renderInspector(); }

function bindDesignItem(element) {
  const id = element.dataset.itemId;
  element.addEventListener('pointerdown', event => startSlotDrag(event, id));
  element.addEventListener('click', event => { event.stopPropagation(); selectItem(id); });
}

function startSlotDrag(event, id) {
  const item = findItem(id); if (!item) return;
  event.preventDefault(); selectItem(id); slotMode = true; hoverSlotIndex = item.slot ?? 0; renderPage();
  slotDrag = { id, target: event.currentTarget };
  const onMove = moveEvent => { hoverSlotIndex = slotAtPoint(moveEvent.clientX, moveEvent.clientY); updateSlotGuides(); };
  const onUp = upEvent => { document.removeEventListener('pointermove', onMove); slotDrag = null; const targetSlot = slotAtPoint(upEvent.clientX, upEvent.clientY); if (targetSlot !== null) moveItemToSlot(id, targetSlot); slotMode = false; hoverSlotIndex = null; render(); saveProject(); };
  document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp, { once: true });
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function updateSlotGuides() { $$('.slot-guide').forEach(guide => guide.classList.toggle('is-target', Number(guide.dataset.slotIndex) === hoverSlotIndex)); }
function moveItemToSlot(itemId, targetSlot) { const page = currentPage(); const item = page.items.find(entry => entry.id === itemId); if (!item) return; const occupant = page.items.find(entry => entry.slot === targetSlot && entry.id !== itemId); if (occupant) occupant.slot = item.slot; item.slot = targetSlot; selectedItemId = itemId; }
function firstEmptySlot(page) { const used = new Set(page.items.map(item => item.slot ?? 0)); const count = Number(project.photosPerPage) || 4; return Array.from({ length: count }, (_, index) => index).find(index => !used.has(index)); }
function addAssetToPage(assetId, targetSlot = null) {
  const asset = findAsset(assetId); let page = currentPage(); if (!asset || !page) return;
  let slot = targetSlot === null ? firstEmptySlot(page) : targetSlot;
  if (slot === undefined || slot === null) { project.pages.push(blankPage(`Página ${project.pages.length + 1}`)); currentPageIndex = project.pages.length - 1; page = currentPage(); slot = 0; }
  const occupant = page.items.find(item => item.slot === slot); if (occupant) slot = firstEmptySlot(page); if (slot === undefined) { project.pages.push(blankPage(`Página ${project.pages.length + 1}`)); currentPageIndex = project.pages.length - 1; page = currentPage(); slot = 0; }
  const item = { id: createId('item'), assetId, slot, fit: project.defaultFit, focusX: 50, focusY: 50, title: '', description: '' };
  page.items.push(item); selectedItemId = item.id; activeInspector = 'photo'; render(); saveProject(); showToast('Foto colocada en el siguiente casillero');
}

function createAutoItems(assets) {
  return assets.map((asset, index) => ({ id: createId('item'), assetId: asset.id, slot: index, fit: project.defaultFit, focusX: 50, focusY: 50, title: '', description: '' }));
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

async function handleFiles(fileList, firstSlot = null) {
  const files = [...fileList].filter(file => file.type.startsWith('image/')); if (!files.length) { showToast('Elegí archivos de imagen JPG, PNG o WEBP'); return; }
  try {
    const incoming = await Promise.all(files.map(async file => { const compressed = await compressImage(file); return { id: createId('asset'), name: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '), ...compressed }; }));
    project.assets.push(...incoming);
    if (firstSlot !== null) incoming.forEach((asset, index) => addAssetToPage(asset.id, firstSlot + index)); else { render(); saveProject(); showToast(`${incoming.length} foto${incoming.length === 1 ? '' : 's'} cargada${incoming.length === 1 ? '' : 's'} en la biblioteca`); }
  } catch { showToast('No se pudo leer alguna de las fotos'); }
}

function deleteSelected() { if (!selectedItemId) return; const page = currentPage(); page.items = page.items.filter(item => item.id !== selectedItemId); selectedItemId = null; activeInspector = 'page'; render(); saveProject(); showToast('Foto quitada del artboard'); }
function duplicateSelected() { const item = findItem(selectedItemId); if (!item) return; const slot = firstEmptySlot(currentPage()); if (slot === undefined) { showToast('No hay casilleros libres en esta hoja'); return; } const copy = { ...item, id: createId('item'), slot }; currentPage().items.push(copy); selectedItemId = copy.id; render(); saveProject(); showToast('Foto duplicada en el siguiente casillero'); }

function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function downloadProject() { downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${project.title || 'storyboard'}.json`); showToast('Proyecto editable exportado'); }

function drawImageInBox(ctx, image, x, y, width, height, fit, focusX = 50, focusY = 50) {
  if (fit === 'contain') { const scale = Math.min(width / image.width, height / image.height); const drawW = image.width * scale; const drawH = image.height * scale; ctx.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH); return; }
  const scale = Math.max(width / image.width, height / image.height); const drawW = image.width * scale; const drawH = image.height * scale; const freeX = width - drawW; const freeY = height - drawH; ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); ctx.drawImage(image, x + freeX * (focusX / 100), y + freeY * (focusY / 100), drawW, drawH); ctx.restore();
}

function drawItemMetadata(ctx, item, asset, layout, width, height) {
  const image = layout.image;
  const x = image.x / 100 * width;
  const y = image.y / 100 * height;
  const number = String((item.slot ?? 0) + 1).padStart(2, '0');
  ctx.fillStyle = 'rgba(0,0,0,.86)';
  ctx.fillRect(x + 10, y + 10, 34, 24);
  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(number, x + 27, y + 26);
  ctx.textAlign = 'left';
  if (!project.showDescriptions || !layout.caption) return;
  const title = item.title || asset.name || `Plano ${Number(item.slot ?? 0) + 1}`;
  const description = item.description || '';
  const caption = layout.caption;
  const captionX = caption.x / 100 * width;
  const captionY = caption.y / 100 * height;
  const captionWidth = caption.width / 100 * width;
  const captionHeight = caption.height / 100 * height;
  ctx.fillStyle = 'rgba(0,0,0,.86)';
  ctx.fillRect(captionX, captionY, captionWidth, captionHeight);
  ctx.fillStyle = '#fff';
  ctx.font = '600 13px Arial';
  ctx.fillText(title.slice(0, 48), captionX + 8, captionY + Math.min(17, captionHeight - 7));
  if (description && captionHeight > 30) { ctx.font = '11px Arial'; ctx.fillText(description.slice(0, 68), captionX + 8, captionY + Math.min(34, captionHeight - 7)); }
}
function drawProjectTitle(ctx, width, height) {
  if (!project.showProjectTitle || !project.title.trim()) return;
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.max(16, Math.round(width * .012))}px Arial`;
  ctx.textAlign = 'right';
  ctx.fillText(project.title.slice(0, 70), width * .965, height * .045);
  ctx.restore();
}

async function renderPageCanvas(page) {
  const width = project.ratio === 'portrait' ? 900 : 1600; const height = Math.round(width / getPageAspect()); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.fillStyle = project.background; ctx.fillRect(0, 0, width, height);
  await Promise.all(page.items.map(item => new Promise(resolve => { const asset = findAsset(item.assetId); if (!asset) return resolve(); const image = new Image(); const layout = itemLayout(item); image.onload = () => { drawImageInBox(ctx, image, layout.image.x / 100 * width, layout.image.y / 100 * height, layout.image.width / 100 * width, layout.image.height / 100 * height, item.fit, item.focusX, item.focusY); drawItemMetadata(ctx, item, asset, layout, width, height); resolve(); }; image.onerror = resolve; image.src = asset.image; })));
  drawProjectTitle(ctx, width, height);
  return canvas;
}

async function exportImage(type) { const canvas = await renderPageCanvas(currentPage()); canvas.toBlob(blob => { downloadBlob(blob, `${project.title || 'storyboard'}-pagina-${currentPageIndex + 1}.${type}`); showToast(`Página exportada como ${type.toUpperCase()}`); }, type === 'jpg' ? 'image/jpeg' : 'image/png', .92); }

function printAllPages() {
  const layer = document.createElement('div'); layer.className = 'print-layer';
  project.pages.forEach(page => { const sheet = document.createElement('div'); sheet.className = `canvas-page print-page ${pageFormatClass()}`; sheet.style.background = project.background; page.items.forEach(item => { const asset = findAsset(item.assetId); if (!asset) return; const layout = itemLayout(item); const label = item.title || asset.name || `Plano ${(item.slot ?? 0) + 1}`; const number = String((item.slot ?? 0) + 1).padStart(2, '0'); const imageHeight = layout.image.height / layout.card.height * 100; const captionHeight = layout.caption ? layout.caption.height / layout.card.height * 100 : 0; const node = document.createElement('div'); node.className = `design-item ${item.fit === 'contain' ? 'fit-contain' : 'fit-cover'}`; node.style.cssText = `left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%`; node.innerHTML = `<div class="design-photo" style="height:${imageHeight}%"><img src="${asset.image}" alt="" style="object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" /><span class="item-number">${number}</span></div>${project.showDescriptions ? `<div class="description-box ${item.description ? '' : 'is-empty'}" style="height:${captionHeight}%"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(item.description || 'Agregar descripción…')}</small></div>` : ''}`; sheet.appendChild(node); }); if (project.showProjectTitle && project.title.trim()) { const title = document.createElement('div'); title.className = 'project-title-overlay'; title.textContent = project.title; sheet.appendChild(title); } layer.appendChild(sheet); });
  document.body.appendChild(layer); const cleanup = () => layer.remove(); window.addEventListener('afterprint', cleanup, { once: true }); window.print(); setTimeout(cleanup, 2500);
}

function openExport() { $('#exportModal').hidden = false; }
function closeExport() { $('#exportModal').hidden = true; }
function openFormatModal() { $('#formatModal').hidden = false; }
function closeFormatModal() { $('#formatModal').hidden = true; }
function selectProjectFormat(format) {
  project.ratio = format;
  project.formatLocked = true;
  closeFormatModal();
  render();
  saveProject();
  const labels = { landscape: 'Horizontal', portrait: 'Vertical', square: 'Cuadrado' };
  showToast(`Canvas ${labels[format] || ''} seleccionado`);
}
function createProjectDraft() {
  project = normalizeProject(defaultProject());
  project.title = 'Storyboard X';
  currentProjectId = project.id;
  currentPageIndex = 0;
  selectedItemId = null;
  activeInspector = 'page';
  showEditor();
  render();
  openFormatModal();
}
function resetProject() {
  if (project) { $('#newProjectConfirmModal').hidden = false; return; }
  createProjectDraft();
}
function closeNewProjectConfirm() { $('#newProjectConfirmModal').hidden = true; }

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
  const reader = new FileReader(); reader.onload = () => { try { const imported = JSON.parse(reader.result); if (!Array.isArray(imported.assets) || !Array.isArray(imported.pages)) throw new Error(); project = normalizeProject(imported); project.id = createId('project'); project.createdAt = new Date().toISOString(); project.updatedAt = project.createdAt; currentProjectId = project.id; currentPageIndex = 0; selectedItemId = null; activeInspector = 'page'; showEditor(); render(); saveProject(); showToast('Proyecto importado correctamente'); } catch { showToast('Ese archivo no parece un proyecto válido'); } }; reader.readAsText(file); event.target.value = '';
});

$('#canvasPage').addEventListener('click', event => { if (event.target === $('#canvasPage')) { selectedItemId = null; activeInspector = 'page'; render(); } });
$('#canvasPage').addEventListener('dragover', event => { event.preventDefault(); $('#canvasPage').classList.add('is-drop-target'); hoverSlotIndex = slotAtPoint(event.clientX, event.clientY); updateSlotGuides(); });
$('#canvasPage').addEventListener('dragleave', event => { if (!$('#canvasPage').contains(event.relatedTarget)) $('#canvasPage').classList.remove('is-drop-target'); });
$('#canvasPage').addEventListener('drop', event => { event.preventDefault(); $('#canvasPage').classList.remove('is-drop-target'); const targetSlot = slotAtPoint(event.clientX, event.clientY); if (draggedAssetId) { addAssetToPage(draggedAssetId, targetSlot); draggedAssetId = null; slotMode = false; hoverSlotIndex = null; } else if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files, targetSlot); });

$('#autoArrangeBtn').addEventListener('click', autoArrange);
$('#photosPerPage').addEventListener('change', event => { project.photosPerPage = Number(event.target.value); autoArrange(); });
$('#layoutDirection').addEventListener('change', event => { project.layoutDirection = event.target.value; autoArrange(); });
$$('.format-btn').forEach(button => button.addEventListener('click', () => { if (project.formatLocked) { showToast('El formato está fijado para este proyecto'); return; } project.ratio = button.dataset.format; render(); saveProject(); }));
$('#zoomOutBtn').addEventListener('click', () => { zoom = clamp(zoom - .1, .6, 1.4); renderControls(); }); $('#zoomInBtn').addEventListener('click', () => { zoom = clamp(zoom + .1, .6, 1.4); renderControls(); });
$('#prevPageBtn').addEventListener('click', () => { if (currentPageIndex > 0) { currentPageIndex--; selectedItemId = null; render(); } }); $('#nextPageBtn').addEventListener('click', () => { if (currentPageIndex < project.pages.length - 1) { currentPageIndex++; selectedItemId = null; render(); } });
$('#addPageBtn').addEventListener('click', () => { project.pages.push(blankPage(`Página ${project.pages.length + 1}`)); currentPageIndex = project.pages.length - 1; selectedItemId = null; render(); saveProject(); showToast('Página nueva agregada'); });

['projectTitle', 'projectAuthor', 'projectDate'].forEach(id => $('#' + id).addEventListener('input', event => { const key = { projectTitle: 'title', projectAuthor: 'author', projectDate: 'date' }[id]; project[key] = event.target.value; $('#breadcrumbTitle').textContent = project.title || 'Sin título'; if (id === 'projectTitle' && $('#canvasProjectTitle')) $('#canvasProjectTitle').textContent = project.title; saveProject(); }));
$('#backgroundColor').addEventListener('input', event => { project.background = event.target.value; render(); saveProject(); });
$('#pageGap').addEventListener('input', event => { project.gap = Number(event.target.value); render(); saveProject(); }); $('#pagePadding').addEventListener('input', event => { project.padding = Number(event.target.value); render(); saveProject(); }); $('#showDescriptions').addEventListener('change', event => { project.showDescriptions = event.target.checked; render(); saveProject(); }); $('#showProjectTitle').addEventListener('change', event => { project.showProjectTitle = event.target.checked; render(); saveProject(); });
$$('.fit-default-btn').forEach(button => button.addEventListener('click', () => { project.defaultFit = button.dataset.fit; renderControls(); saveProject(); }));
$('#clearPageBtn').addEventListener('click', () => { if (!currentPage().items.length || window.confirm('¿Limpiar todas las fotos de esta página?')) { currentPage().items = []; selectedItemId = null; render(); saveProject(); } });

$$('.inspector-tab').forEach(tab => tab.addEventListener('click', () => { activeInspector = tab.dataset.inspector; renderInspector(); }));
$$('.fit-btn').forEach(button => button.addEventListener('click', () => { const item = findItem(selectedItemId); if (!item) return; item.fit = button.dataset.fit; renderPage(); renderInspector(); saveProject(); }));
$('#photoFocusX').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.focusX = Number(event.target.value); renderPage(); renderInspector(); saveProject(); }); $('#photoFocusY').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.focusY = Number(event.target.value); renderPage(); renderInspector(); saveProject(); }); $('#photoTitle').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.title = event.target.value; renderPage(); saveProject(); }); $('#photoDescription').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.description = event.target.value; renderPage(); saveProject(); });
$('#deletePhotoBtn').addEventListener('click', deleteSelected); $('#duplicatePhotoBtn').addEventListener('click', duplicateSelected); $('#clearLibraryBtn').addEventListener('click', () => { if (window.confirm('¿Quitar todas las fotos de la biblioteca?')) { project.assets = []; project.pages.forEach(page => { page.items = []; }); selectedItemId = null; render(); saveProject(); } });

$('#newProjectBtn').addEventListener('click', resetProject); $('#dashboardCreateBtn').addEventListener('click', resetProject); $('#dashboardEmptyCreateBtn').addEventListener('click', resetProject); $('#backToDashboardBtn').addEventListener('click', showDashboard); $('#exportBtn').addEventListener('click', openExport); $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeExport)); $('#exportModal').addEventListener('click', event => { if (event.target === $('#exportModal')) closeExport(); }); $$('[data-project-format]').forEach(button => button.addEventListener('click', () => selectProjectFormat(button.dataset.projectFormat))); $('#cancelNewProjectBtn').addEventListener('click', closeNewProjectConfirm); $('#cancelNewProjectBtnSecondary').addEventListener('click', closeNewProjectConfirm); $('#confirmNewProjectBtn').addEventListener('click', () => { closeNewProjectConfirm(); createProjectDraft(); }); $('#newProjectConfirmModal').addEventListener('click', event => { if (event.target === $('#newProjectConfirmModal')) closeNewProjectConfirm(); });
$$('[data-export]').forEach(button => button.addEventListener('click', async () => { const type = button.dataset.export; closeExport(); if (type === 'json') downloadProject(); else if (type === 'print') printAllPages(); else await exportImage(type); }));

document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); showToast('Proyecto guardado'); } if (event.key === 'Delete' && selectedItemId && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) deleteSelected(); if (event.key === 'Escape') { closeExport(); closeNewProjectConfirm(); } });

showDashboard();
