const STORAGE_KEY = 'storyboard-studio-workspace-v2';
const LEGACY_KEY = 'storyboard-studio-project-v1';
const PROJECTS_KEY = 'storyboard-studio-projects-v1';
const CURRENT_PROJECT_KEY = 'storyboard-studio-current-project-v1';
const MIN_CANVAS_PADDING = 6;
const PHOTO_INFO_OVERLAY_HEIGHT = 18;

const SHOT_TYPES = [
  { value: 'PG', label: 'Plano general' },
  { value: 'PE', label: 'Plano entero' },
  { value: 'PA', label: 'Plano americano' },
  { value: 'PM', label: 'Plano medio' },
  { value: 'PP', label: 'Primer plano' },
  { value: 'PD', label: 'Plano detalle' },
  { value: 'POV', label: 'Plano subjetivo / POV' },
  { value: 'OTS', label: 'Sobre hombro' },
  { value: 'CEN', label: 'Cenital' },
  { value: 'NAD', label: 'Nadir' },
  { value: 'TRK', label: 'Seguimiento' }
];

const CAMERA_MOVES = [
  { value: 'none', label: 'Sin movimiento', tag: '' },
  { value: 'zoom-in', label: 'Zoom in', tag: 'ZOOM IN' },
  { value: 'zoom-out', label: 'Zoom out', tag: 'ZOOM OUT' },
  { value: 'pan-left', label: 'Pan a izquierda', tag: 'PAN ←' },
  { value: 'pan-right', label: 'Pan a derecha', tag: 'PAN →' },
  { value: 'tilt-up', label: 'Tilt hacia arriba', tag: 'TILT ↑' },
  { value: 'tilt-down', label: 'Tilt hacia abajo', tag: 'TILT ↓' },
  { value: 'dolly-in', label: 'Dolly in / Push in', tag: 'DOLLY IN' },
  { value: 'dolly-out', label: 'Dolly out / Pull out', tag: 'DOLLY OUT' },
  { value: 'track-left', label: 'Travelling a izquierda', tag: 'TRACK ←' },
  { value: 'track-right', label: 'Travelling a derecha', tag: 'TRACK →' }
];

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
let pendingDeleteProjectId = null;
let pendingDeletePageIndex = null;
let lastUndoState = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const createId = (prefix = 'id') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
function shotTypeInfo(value) { return SHOT_TYPES.find(type => type.value === value) || SHOT_TYPES[0]; }
function cameraMoveInfo(value) { return CAMERA_MOVES.find(move => move.value === value) || CAMERA_MOVES[0]; }
function itemDisplayTitle(item, asset) {
  const type = shotTypeInfo(item.shotType);
  const base = item.title?.trim() || asset?.name || `Plano ${(item.slot ?? 0) + 1}`;
  return base.startsWith(`${type.value} ·`) ? base : `${type.value} · ${base}`;
}
let project = null;
let projects = [];
let currentProjectId = null;

function blankPage(title = 'Página 1') { return { id: createId('page'), title, items: [] }; }
function defaultProject() { return { version: 2, layoutEngine: 'grid', layoutEngineVersion: 1, title: 'Storyboard X', producer: '', client: '', agency: '', director: '', date: new Date().toISOString().slice(0, 10), ratio: 'landscape', formatLocked: false, showProjectTitle: true, showProducerBranding: false, showClientMeta: false, showAgencyMeta: false, showDirectorMeta: false, showProjectFrame: true, showPageNumber: true, producerLogo: '', producerLogoName: '', background: '#ffffff', padding: MIN_CANVAS_PADDING, gap: 16, defaultFit: 'contain', defaultFrame: 'original', defaultCropAspect: null, showDescriptions: true, infoPlacement: 'below', infoStyle: 'dark', assets: [], pages: [blankPage()] }; }

const FRAME_ASPECTS = Object.freeze({ horizontal: 16 / 9, vertical: 9 / 16, square: 1 });
const FRAME_MODES = new Set(['original', 'horizontal', 'vertical', 'square']);
const FRAME_LABELS = Object.freeze({ original: 'Original', horizontal: 'Horizontal', vertical: 'Vertical', square: 'Cuadrada' });
function validFrameMode(value) { return FRAME_MODES.has(value) ? value : null; }
function frameAspect(mode) { return FRAME_ASPECTS[mode] || null; }
function formatAspect(ratio) { return ratio === 'portrait' ? 9 / 16 : ratio === 'square' ? 1 : 16 / 9; }
function frameModeFromAspect(aspect, fallback = 'horizontal') {
  const target = Number(aspect);
  if (!Number.isFinite(target) || target <= 0) return fallback;
  return Object.entries(FRAME_ASPECTS).reduce((closest, [mode, value]) => {
    const distance = Math.abs(Math.log(target / value));
    return distance < closest.distance ? { mode, distance } : closest;
  }, { mode: fallback, distance: Infinity }).mode;
}
function projectDefaultFrame() {
  if (validFrameMode(project?.defaultFrame)) return project.defaultFrame;
  return project?.defaultFit === 'cover' ? frameModeFromAspect(project.defaultCropAspect || getPageAspect()) : 'original';
}
function frameFields(mode) {
  return mode === 'original' ? { frame: 'original', fit: 'contain', cropAspect: null } : { frame: mode, fit: 'cover', cropAspect: frameAspect(mode) };
}
function frameModesForAsset(asset) {
  const nativeMode = frameModeFromAspect(assetAspect(asset));
  return ['original', ...Object.keys(FRAME_ASPECTS).filter(mode => mode !== nativeMode)];
}
function renderFrameButtons(selector, modes, activeMode) {
  $$(selector).forEach((button, index) => {
    const mode = modes[index];
    button.hidden = !mode;
    button.dataset.frame = mode || '';
    button.textContent = mode ? FRAME_LABELS[mode] : '';
    button.classList.toggle('is-active', mode === activeMode);
  });
}
function itemFrameMode(item) {
  if (validFrameMode(item?.frame)) return item.frame;
  return item?.fit === 'cover' ? frameModeFromAspect(item.cropAspect || getPageAspect()) : 'original';
}

projects = loadProjects();

function legacyCropAspect(page, data) {
  const count = Number(page.photosPerPage || data.photosPerPage) || 4;
  const effectiveCount = Math.max(count, page.items?.length || 0);
  const direction = page.layoutDirection || data.layoutDirection || 'grid';
  const cols = direction === 'columns' ? count : direction === 'rows' ? Math.ceil(effectiveCount / count) : effectiveCount <= 1 ? 1 : effectiveCount <= 4 ? 2 : 3;
  const rows = direction === 'rows' ? count : Math.ceil(effectiveCount / cols);
  const pad = Math.max(MIN_CANVAS_PADDING, Number(data.padding) || MIN_CANVAS_PADDING);
  const gap = (Number(data.gap) || 0) / 10;
  const w = (100 - pad * 2 - gap * (cols - 1)) / cols;
  const h = (100 - pad * 2 - gap * (rows - 1)) / rows;
  const safe = Math.min(1.6, w * .12, h * .12);
  const imageHeight = h - safe * 2 - (data.showDescriptions !== false && data.infoPlacement !== 'overlay' ? Math.min((h - safe * 2) * .24, 11) : 0);
  return (data.ratio === 'portrait' ? 9 / 16 : data.ratio === 'square' ? 1 : 16 / 9) * (w - safe * 2) / imageHeight;
}

function normalizeProject(data) {
  const base = defaultProject();
  const normalized = { ...base, ...data };
  normalized.id = data.id || createId('project');
  normalized.createdAt = data.createdAt || new Date().toISOString();
  normalized.updatedAt = data.updatedAt || normalized.createdAt;
  normalized.producer = typeof data.producer === 'string' ? data.producer : (data.author && data.author !== 'Tu nombre' ? data.author : '');
  normalized.author = normalized.producer;
  normalized.client = typeof data.client === 'string' ? data.client : '';
  normalized.agency = typeof data.agency === 'string' ? data.agency : '';
  normalized.director = typeof data.director === 'string' ? data.director : '';
  if (normalized.title === 'Mi nuevo video') normalized.title = 'Storyboard X';
  const migrateOldCropDefault = data.version !== 2;
  normalized.version = 2;
  normalized.layoutEngineVersion = 1;
  normalized.layoutEngine = data.layoutEngineVersion === 1 && data.layoutEngine === 'adaptive' ? 'adaptive' : 'grid';
  normalized.formatLocked = typeof data.formatLocked === 'boolean' ? data.formatLocked : true;
  normalized.showProjectTitle = typeof data.showProjectTitle === 'boolean' ? data.showProjectTitle : true;
  normalized.showProducerBranding = typeof data.showProducerBranding === 'boolean' ? data.showProducerBranding : false;
  normalized.showClientMeta = typeof data.showClientMeta === 'boolean' ? data.showClientMeta : false;
  normalized.showAgencyMeta = typeof data.showAgencyMeta === 'boolean' ? data.showAgencyMeta : false;
  normalized.showDirectorMeta = typeof data.showDirectorMeta === 'boolean' ? data.showDirectorMeta : false;
  normalized.showProjectFrame = typeof data.showProjectFrame === 'boolean' ? data.showProjectFrame : false;
  normalized.showPageNumber = typeof data.showPageNumber === 'boolean' ? data.showPageNumber : true;
  normalized.producerLogo = typeof data.producerLogo === 'string' ? data.producerLogo : '';
  normalized.producerLogoName = typeof data.producerLogoName === 'string' ? data.producerLogoName : '';
  normalized.showDescriptions = typeof data.showDescriptions === 'boolean' ? data.showDescriptions : true;
  normalized.infoPlacement = data.infoPlacement === 'overlay' ? 'overlay' : 'below';
  normalized.infoStyle = data.infoStyle === 'light' ? 'light' : 'dark';
  normalized.padding = Math.max(MIN_CANVAS_PADDING, Number(normalized.padding) || MIN_CANVAS_PADDING);
  if (migrateOldCropDefault) normalized.defaultFit = 'contain';
  normalized.defaultFrame = validFrameMode(data.defaultFrame) ? data.defaultFrame : (normalized.defaultFit === 'cover' ? frameModeFromAspect(data.defaultCropAspect || formatAspect(normalized.ratio)) : 'original');
  normalized.defaultCropAspect = frameAspect(normalized.defaultFrame);
  normalized.defaultFit = normalized.defaultFrame === 'original' ? 'contain' : 'cover';
  normalized.assets = Array.isArray(data.assets) ? data.assets : [];
  normalized.pages = Array.isArray(data.pages) && data.pages.length ? data.pages.map((page, index) => {
    const migratedPage = { ...blankPage(`Página ${index + 1}`), ...page, items: Array.isArray(page.items) ? page.items.map((item, itemIndex) => {
      const legacyFit = migrateOldCropDefault ? 'contain' : (item.fit || normalized.defaultFit);
      const mode = validFrameMode(item.frame) ? item.frame : (legacyFit === 'cover' ? frameModeFromAspect(item.cropAspect || normalized.defaultCropAspect || formatAspect(normalized.ratio)) : 'original');
      return { ...item, ...frameFields(mode), shotType: item.shotType || 'PG', title: item.title || '', description: item.description || '', cameraMove: item.cameraMove || 'none', cameraMoveMode: item.cameraMoveMode === 'between' ? 'between' : 'overlay', slot: Number.isFinite(item.slot) ? item.slot : itemIndex };
    }) : [] };
    if (data.layoutEngine !== 'adaptive') migratedPage.items.forEach(item => {
      if (item.fit === 'cover' && !item.cropAspect) item.cropAspect = legacyCropAspect(page, data);
    });
    migratedPage.items.sort((a, b) => a.slot - b.slot);
    renumberItems(migratedPage);
    delete migratedPage.photosPerPage;
    delete migratedPage.layoutDirection;
    return migratedPage;
  }) : [blankPage()];
  delete normalized.photosPerPage;
  delete normalized.layoutDirection;
  return normalized;
}

function migrateLegacy() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (!legacy || !Array.isArray(legacy.shots) || !legacy.shots.length) return null;
    const migrated = defaultProject();
    migrated.title = legacy.title || migrated.title;
    migrated.producer = legacy.author || migrated.producer;
    migrated.author = migrated.producer;
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

function persistProjects() {
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); } catch { showToast('No se pudo actualizar el archivo de proyectos'); }
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function captureUndoState() {
  lastUndoState = { project: JSON.parse(JSON.stringify(project)), currentPageIndex, selectedItemId, activeInspector };
}

function closeDeletePageConfirm() {
  pendingDeletePageIndex = null;
  $('#deletePageConfirmModal').hidden = true;
}
function closeClearPageConfirm() { $('#clearPageConfirmModal').hidden = true; }
function confirmClearPage() {
  if (!project || !currentPage().items.length) { closeClearPageConfirm(); return; }
  captureUndoState();
  currentPage().items = [];
  selectedItemId = null;
  activeInspector = 'page';
  closeClearPageConfirm();
  render();
  saveProject();
  showToast('Página limpiada · Ctrl + Z para recuperar');
}

function restoreLastUndo() {
  if (!lastUndoState || !project) { showToast('No hay una acción para deshacer'); return; }
  project = normalizeProject(lastUndoState.project);
  currentProjectId = project.id;
  currentPageIndex = Math.min(lastUndoState.currentPageIndex, project.pages.length - 1);
  selectedItemId = lastUndoState.selectedItemId;
  activeInspector = lastUndoState.activeInspector;
  lastUndoState = null;
  closeDeletePageConfirm();
  closeClearPageConfirm();
  render();
  saveProject();
  showToast('Página recuperada');
}

function pageFormatClass() { return project.ratio === 'portrait' ? 'format-portrait' : project.ratio === 'square' ? 'format-square' : ''; }
function getPageAspect() { return project.ratio === 'portrait' ? 9 / 16 : project.ratio === 'square' ? 1 : 16 / 9; }
function renumberItems(page) { page.items.forEach((item, index) => { item.slot = index; }); }
const layoutCache = new WeakMap();
function pageLayout(page = currentPage()) {
  const aspects = page.items.map(item => item.fit === 'cover' ? (item.cropAspect || getPageAspect()) : assetAspect(findAsset(item.assetId)));
  const options = { engine: project.layoutEngine, aspect: getPageAspect(), padding: project.padding, gap: project.gap, captions: project.showDescriptions && project.infoPlacement !== 'overlay' };
  const key = JSON.stringify([aspects, options]);
  const cached = layoutCache.get(page);
  if (cached?.key === key) return cached.rects;
  const rects = StoryboardLayout.arrange(aspects, options);
  layoutCache.set(page, { key, rects });
  return rects;
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
    const projectDetails = [['CLIENTE', entry.client], ['AGENCIA', entry.agency], ['PRODUCTORA', entry.producer], ['DIRECTOR', entry.director]].filter(([, value]) => value?.trim());
    const projectDetailsMarkup = projectDetails.length ? `<div class="project-card-details">${projectDetails.map(([label, value]) => `<span><small>${label}</small><strong>${escapeHtml(value)}</strong></span>`).join('')}</div>` : '';
    const editIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.7 3.7 3.7-.7L18.5 8a2.5 2.5 0 0 0-3.5-3.5L4 16.5Zm9.5-9.5 4 4" /></svg>';
    const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h8l1-13M10 11v6m4-6v6" /></svg>';
    return `<article class="project-card" style="--card-index:${index}"><div class="project-card-open" data-open-project="${entry.id}" role="button" tabindex="0"><span class="project-card-preview ${asset ? '' : 'is-empty'}">${preview}<span class="project-card-format">${projectFormatLabel(entry.ratio)}</span></span><span class="project-card-body"><span class="project-card-title-slot"><strong class="project-card-name">${escapeHtml(entry.title || 'Sin título')}</strong><input id="dashboard-title-${entry.id}" class="project-card-title-input" data-project-title="${entry.id}" value="${escapeHtml(entry.title || '')}" placeholder="Título del proyecto" autocomplete="off" hidden /></span>${projectDetailsMarkup}<span class="project-card-meta"><span>${pageCount} página${pageCount === 1 ? '' : 's'}</span><span>${photoCount} foto${photoCount === 1 ? '' : 's'}</span><span>${projectDateLabel(entry.updatedAt)}</span></span></span></div><div class="project-card-actions"><button class="project-card-action project-card-edit" data-edit-project="${entry.id}" type="button" aria-label="Editar nombre del proyecto" title="Editar nombre">${editIcon}</button><button class="project-card-action project-card-delete" data-delete-project="${entry.id}" type="button" aria-label="Eliminar proyecto" title="Eliminar proyecto">${deleteIcon}</button></div></article>`;
  }).join('');
  $$('[data-open-project]', grid).forEach(card => {
    const open = () => { if (!card.classList.contains('is-editing')) openProject(card.dataset.openProject); };
    card.addEventListener('click', event => { if (!event.target.closest('input,button')) open(); });
    card.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('input')) { event.preventDefault(); open(); } });
  });
  $$('[data-edit-project]', grid).forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const card = button.closest('.project-card')?.querySelector('[data-open-project]');
    const input = card?.querySelector('[data-project-title]');
    const title = card?.querySelector('.project-card-name');
    if (!card || !input || !title) return;
    input.dataset.previousValue = input.value;
    card.classList.add('is-editing');
    title.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  }));
  $$('[data-project-title]', grid).forEach(input => {
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('input', event => {
      const entry = projects.find(candidate => candidate.id === input.dataset.projectTitle);
      if (!entry) return;
      entry.title = event.currentTarget.value;
      entry.updatedAt = new Date().toISOString();
      input.closest('.project-card')?.querySelector('.project-card-name')?.replaceChildren(document.createTextNode(entry.title || 'Sin título'));
      persistProjects();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape') {
        event.preventDefault();
        input.value = input.dataset.previousValue || input.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      const card = input.closest('[data-open-project]');
      const title = card?.querySelector('.project-card-name');
      if (title) title.hidden = false;
      input.hidden = true;
      card?.classList.remove('is-editing');
    });
  });
  $$('[data-delete-project]', grid).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); openDeleteProjectModal(button.dataset.deleteProject); }));
}

function showDashboard() {
  if (project) saveProject();
  project = null;
  lastUndoState = null;
  closeDeletePageConfirm();
  currentProjectId = null;
  $('#dashboardView').hidden = false;
  $('#editorView').hidden = true;
  $('#backToDashboardBtn').hidden = true;
  $('#createVersionBtn').hidden = true;
  $('#exportBtn').hidden = true;
  $('#saveState').innerHTML = '<span class="status-dot"></span>Guardado local';
  $('#breadcrumbTitle').textContent = 'Todos los proyectos';
  renderDashboard();
}

function showEditor() {
  $('#dashboardView').hidden = true;
  $('#editorView').hidden = false;
  $('#backToDashboardBtn').hidden = false;
  $('#createVersionBtn').hidden = false;
  $('#exportBtn').hidden = false;
  $('#breadcrumbTitle').textContent = project?.title || 'Sin título';
}

function openDeleteProjectModal(id) {
  const entry = projects.find(candidate => candidate.id === id);
  if (!entry) return;
  pendingDeleteProjectId = id;
  $('#deleteProjectName').textContent = entry.title || 'Sin título';
  $('#deleteProjectModal').hidden = false;
}
function closeDeleteProjectModal() { pendingDeleteProjectId = null; $('#deleteProjectModal').hidden = true; }
function confirmDeleteProject() {
  if (!pendingDeleteProjectId) return;
  const entry = projects.find(candidate => candidate.id === pendingDeleteProjectId);
  projects = projects.filter(candidate => candidate.id !== pendingDeleteProjectId);
  persistProjects();
  if (currentProjectId === pendingDeleteProjectId) { project = null; currentProjectId = null; }
  closeDeleteProjectModal();
  renderDashboard();
  showToast(`${entry?.title || 'Proyecto'} eliminado`);
}

function openProject(id) {
  const stored = projects.find(entry => entry.id === id);
  if (!stored) return;
  project = normalizeProject(stored);
  lastUndoState = null;
  currentProjectId = project.id;
  currentPageIndex = 0;
  selectedItemId = null;
  activeInspector = 'page';
  localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
  showEditor();
  render();
  if (!project.formatLocked) openFormatModal();
}
function itemLayout(item, page = currentPage()) {
  return pageLayout(page)[page.items.indexOf(item)];
}
function slotAtPoint(clientX, clientY) {
  const rect = $('#canvasPage').getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  const x = (clientX - rect.left) / rect.width * 100;
  const y = (clientY - rect.top) / rect.height * 100;
  const layouts = pageLayout();
  if (!layouts.length) return 0;
  let closest = 0;
  let distance = Infinity;
  layouts.forEach(({ card }, index) => {
    const dx = Math.max(card.x - x, 0, x - card.x - card.width) * getPageAspect();
    const dy = Math.max(card.y - y, 0, y - card.y - card.height);
    const candidate = dx * dx + dy * dy;
    if (candidate < distance) { closest = index; distance = candidate; }
  });
  if (slotDrag && !slotDrag.duplicate) return closest;
  const target = layouts[closest].card;
  return closest + (x > target.x + target.width / 2 || y > target.y + target.height ? 1 : 0);
}

function cameraMoveSvg(move, itemId, className = '') {
  const markerId = `camera-arrow-${String(itemId).replace(/[^a-z0-9_-]/gi, '')}`;
  let paths = '';
  if (move.value === 'zoom-in' || move.value === 'dolly-in') paths = '<path d="M10 28 L28 10 M90 28 L72 10 M10 72 L28 90 M90 72 L72 90" marker-end="url(#' + markerId + ')" />';
  if (move.value === 'zoom-out' || move.value === 'dolly-out') paths = '<path d="M28 10 L10 28 M72 10 L90 28 M28 90 L10 72 M72 90 L90 72" marker-end="url(#' + markerId + ')" />';
  if (move.value === 'pan-left') paths = '<path d="M82 50 H18" marker-end="url(#' + markerId + ')" />';
  if (move.value === 'pan-right') paths = '<path d="M18 50 H82" marker-end="url(#' + markerId + ')" />';
  if (move.value === 'tilt-up') paths = '<path d="M50 82 V18" marker-end="url(#' + markerId + ')" />';
  if (move.value === 'tilt-down') paths = '<path d="M50 18 V82" marker-end="url(#' + markerId + ')" />';
  if (move.value === 'track-left') paths = '<path d="M82 42 H18 M82 58 H18" marker-end="url(#' + markerId + ')" />';
  if (move.value === 'track-right') paths = '<path d="M18 42 H82 M18 58 H82" marker-end="url(#' + markerId + ')" />';
  if (move.value === 'dolly-in' || move.value === 'dolly-out') paths += '<rect x="30" y="30" width="40" height="40" rx="2" />';
  return `<svg class="${className}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="${markerId}" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6 Z" /></marker></defs><g>${paths}</g></svg>`;
}

function cameraMoveMarkup(item) {
  const move = cameraMoveInfo(item.cameraMove);
  if (move.value === 'none' || item.cameraMoveMode === 'between') return '';
  return `<div class="camera-move-overlay camera-move-${move.value}" title="Movimiento de cámara: ${escapeHtml(move.label)}">${cameraMoveSvg(move, item.id)}<span>${escapeHtml(move.tag)}</span></div>`;
}

function cameraMoveConnectorMarkup(page) {
  const layouts = pageLayout(page);
  const aspect = getPageAspect();
  const pageWidth = aspect * 100;
  const connections = [];
  page.items.forEach((item, index) => {
    const move = cameraMoveInfo(item.cameraMove);
    const next = page.items[index + 1];
    if (move.value === 'none' || item.cameraMoveMode !== 'between' || !next || !layouts[index] || !layouts[index + 1]) return;
    const toPhysical = rect => ({ x: rect.x / 100 * pageWidth, y: rect.y, width: rect.width / 100 * pageWidth, height: rect.height });
    const from = toPhysical(layouts[index].card);
    const target = toPhysical(layouts[index + 1].card);
    const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const dx = targetCenter.x - fromCenter.x;
    const dy = targetCenter.y - fromCenter.y;
    const distance = Math.hypot(dx, dy);
    if (!distance) return;
    const ux = dx / distance;
    const uy = dy / distance;
    const edgePoint = (rect, x, y) => { const tx = Math.abs(x) > .001 ? rect.width / 2 / Math.abs(x) : Infinity; const ty = Math.abs(y) > .001 ? rect.height / 2 / Math.abs(y) : Infinity; const distanceToEdge = Math.min(tx, ty); return { x: rect.x + rect.width / 2 + x * distanceToEdge, y: rect.y + rect.height / 2 + y * distanceToEdge }; };
    const start = edgePoint(from, ux, uy);
    const end = edgePoint(target, -ux, -uy);
    const markerId = `camera-connector-${String(item.id).replace(/[^a-z0-9_-]/gi, '')}`;
    connections.push({ move, markerId, start, end, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } });
  });
  if (!connections.length) return '';
  const lines = connections.map(({ markerId, start, end }) => `<defs><marker id="${markerId}" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L6 3 L0 6 Z" /></marker></defs><line x1="${start.x / pageWidth * 100}" y1="${start.y}" x2="${end.x / pageWidth * 100}" y2="${end.y}" marker-end="url(#${markerId})" />`).join('');
  const labels = connections.map(({ move, mid }) => `<span class="camera-move-connector-label" style="left:${mid.x / pageWidth * 100}%;top:${mid.y}%">${escapeHtml(move.tag)}</span>`).join('');
  return `<svg class="camera-move-connectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${labels}`;
}

function itemMarkup(item, page = currentPage()) {
  const asset = findAsset(item.assetId); if (!asset) return '';
  const label = itemDisplayTitle(item, asset);
  const number = String((item.slot ?? 0) + 1).padStart(2, '0');
  const layout = itemLayout(item, page);
  const imageHeight = layout.image.height / layout.card.height * 100;
  const captionHeight = layout.caption ? layout.caption.height / layout.card.height * 100 : 0;
  const description = item.description?.trim() || '';
  const overlayInfo = project.showDescriptions && project.infoPlacement === 'overlay';
  const infoStyleClass = `description-style-${project.infoStyle || 'dark'}`;
  const infoMarkup = project.showDescriptions ? `<div class="description-box ${overlayInfo ? 'description-overlay ' : ''}${infoStyleClass} ${description ? '' : 'is-empty'}" style="height:${overlayInfo ? PHOTO_INFO_OVERLAY_HEIGHT : captionHeight}%"><strong>${escapeHtml(label)}</strong><small class="description-editor" contenteditable="true" spellcheck="false" data-placeholder="Agregar descripción…">${escapeHtml(description)}</small></div>` : '';
  return `<div class="design-item ${item.fit === 'contain' ? 'fit-contain' : 'fit-cover'} ${item.id === selectedItemId ? 'is-selected' : ''}" data-item-id="${item.id}" style="left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%" draggable="false">
    <div class="design-photo" style="height:${imageHeight}%"><img src="${asset.image}" alt="${escapeHtml(label)}" style="object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" /><span class="item-number">${number}</span>${overlayInfo ? infoMarkup : ''}</div>
    ${overlayInfo ? '' : infoMarkup}
  </div>`;
}

function storyboardMetaMarkup(pageNumber = currentPageIndex + 1, totalPages = project.pages.length) {
  if (!project.showProjectFrame) return '';
  const producer = project.showProducerBranding && (project.producer?.trim() || project.producerLogo);
  const details = [
    project.showClientMeta && project.client?.trim() ? ['CLIENTE', project.client] : null,
    project.showAgencyMeta && project.agency?.trim() ? ['AGENCIA', project.agency] : null,
    project.showDirectorMeta && project.director?.trim() ? ['DIRECTOR', project.director] : null
  ].filter(Boolean);
  const producerMarkup = producer ? `<span class="storyboard-meta-producer">${project.producerLogo ? `<img src="${project.producerLogo}" alt="" />` : ''}${project.producer?.trim() ? `<strong>${escapeHtml(project.producer)}</strong>` : ''}</span>` : '';
  const titleMarkup = project.showProjectTitle && project.title.trim() ? `<strong class="storyboard-meta-title">${escapeHtml(project.title)}</strong>` : '';
  const detailsMarkup = details.map(([label, value]) => `<span><small>${label}</small><strong>${escapeHtml(value)}</strong></span>`).join('');
  const pageMarkup = project.showPageNumber ? `<strong class="storyboard-meta-page">${String(pageNumber).padStart(2, '0')}</strong>` : '';
  return `<div class="storyboard-meta-frame" aria-hidden="true"><div class="storyboard-meta-top">${producerMarkup}${titleMarkup}</div><div class="storyboard-meta-bottom">${detailsMarkup ? `<div class="storyboard-meta-details">${detailsMarkup}</div>` : '<span></span>'}${pageMarkup}</div></div>`;
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
  const guides = slotMode ? pageLayout(page).map(({ card: rect }, index) => `<div class="slot-guide" data-slot-index="${index}" style="left:${rect.x}%;top:${rect.y}%;width:${rect.width}%;height:${rect.height}%"><span>${String(index + 1).padStart(2, '0')}</span></div>`).join('') : '';
  const content = page?.items.length ? page.items.map(item => itemMarkup(item, page)).join('') : '<div class="empty-page"><div><span>▱</span><strong>Tu artboard está vacío</strong><small>Arrastrá una foto desde la biblioteca</small></div></div>';
  const producerBrand = !project.showProjectFrame && project.showProducerBranding && (project.producer?.trim() || project.producerLogo) ? `<div class="producer-brand-overlay" id="canvasProducerBrand">${project.producerLogo ? `<img src="${project.producerLogo}" alt="" />` : ''}${project.producer?.trim() ? `<span>${escapeHtml(project.producer.trim())}</span>` : ''}</div>` : '';
  const titleOverlay = !project.showProjectFrame && project.showProjectTitle && project.title.trim() ? `<div class="project-title-overlay" id="canvasProjectTitle">${escapeHtml(project.title)}</div>` : '';
  const cameraConnectors = page ? cameraMoveConnectorMarkup(page) : '';
  $('#canvasPage').innerHTML = guides + content + cameraConnectors + producerBrand + titleOverlay + storyboardMetaMarkup();
  $$('.design-item').forEach(item => bindDesignItem(item));
  $$('.description-editor').forEach(editor => {
    editor.addEventListener('pointerdown', event => event.stopPropagation());
    editor.addEventListener('click', event => event.stopPropagation());
    editor.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); editor.blur(); } });
    editor.addEventListener('input', event => { const item = findItem(editor.closest('.design-item')?.dataset.itemId); if (!item) return; item.description = event.currentTarget.textContent.trim(); $('#photoDescription').value = item.description; saveProject(); });
  });
  $('#pageNumber').textContent = currentPageIndex + 1;
  $('#pageTotal').textContent = project.pages.length;
  $('#prevPageBtn').disabled = currentPageIndex === 0;
  $('#nextPageBtn').disabled = currentPageIndex >= project.pages.length - 1;
  $('#pagePhotoCount').textContent = `${page.items.length} foto${page.items.length === 1 ? '' : 's'} en esta página`;
  $('#selectionStatus').textContent = selectedItemId ? 'Foto seleccionada · arrastrá para cambiar su lugar en la secuencia' : 'Las fotos se acomodan automáticamente al agregarlas o quitarlas';
  $('#selectionStatus').classList.toggle('photo-selected', !!selectedItemId);
  renderPageCarousel();
  updateSlotGuides();
}

function pageThumbnailMarkup(page) {
  if (!page.items.length) return '<div class="page-thumb-empty">Página vacía</div>';
  return page.items.map(item => {
    const asset = findAsset(item.assetId); if (!asset) return '';
    const layout = itemLayout(item, page);
    const label = itemDisplayTitle(item, asset);
    const number = String((item.slot ?? 0) + 1).padStart(2, '0');
    const imageHeight = layout.image.height / layout.card.height * 100;
    const captionHeight = layout.caption ? layout.caption.height / layout.card.height * 100 : 0;
    const overlayInfo = project.showDescriptions && project.infoPlacement === 'overlay';
    const caption = project.showDescriptions ? `<div class="page-thumb-caption ${overlayInfo ? 'page-thumb-caption-overlay ' : ''}page-thumb-caption-style-${project.infoStyle || 'dark'}" style="height:${overlayInfo ? PHOTO_INFO_OVERLAY_HEIGHT : captionHeight}%">${escapeHtml(label)}</div>` : '';
    const objectFit = item.fit === 'cover' ? 'cover' : 'contain';
    return `<div class="page-thumb-item" style="left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%"><div class="page-thumb-photo" style="height:${imageHeight}%"><img src="${asset.image}" alt="" style="object-fit:${objectFit};object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" /><span>${number}</span>${overlayInfo ? caption : ''}</div>${overlayInfo ? '' : caption}</div>`;
  }).join('');
}

function addNewPage() {
  project.pages.push(blankPage(`Página ${project.pages.length + 1}`));
  currentPageIndex = project.pages.length - 1;
  selectedItemId = null;
  activeInspector = 'page';
  render();
  saveProject();
  showToast('Página nueva agregada');
}

function duplicatePage(source) {
  return {
    ...source,
    id: createId('page'),
    title: `${source.title || 'Página'} · copia`,
    items: source.items.map(item => ({ ...item, id: createId('item') }))
  };
}

function duplicatePageAt(sourceIndex) {
  if (!project.pages[sourceIndex]) return;
  captureUndoState();
  const copy = duplicatePage(project.pages[sourceIndex]);
  project.pages.splice(sourceIndex + 1, 0, copy);
  currentPageIndex = sourceIndex + 1;
  selectedItemId = null;
  activeInspector = 'page';
  closePageMenus();
  render();
  saveProject();
  showToast('Página copiada');
}

function removePageAt(pageIndex) {
  if (project.pages.length <= 1) { showToast('El proyecto necesita al menos una página'); return false; }
  if (!project.pages[pageIndex]) return false;
  captureUndoState();
  project.pages.splice(pageIndex, 1);
  currentPageIndex = Math.min(pageIndex, project.pages.length - 1);
  selectedItemId = null;
  activeInspector = 'page';
  closePageMenus();
  render();
  saveProject();
  showToast('Página eliminada · Ctrl + Z para recuperar');
  return true;
}

function closePageMenus() { $$('.page-thumb-wrap.is-menu-open').forEach(wrapper => { wrapper.classList.remove('is-menu-open'); const menu = wrapper.querySelector('.page-thumb-menu'); if (menu) { menu.style.left = ''; menu.style.top = ''; } }); }

function pageIndexAtPoint(clientX, clientY, track) {
  return [...track.querySelectorAll('[data-page-index]')].map(button => ({ button, rect: button.getBoundingClientRect() })).find(({ rect }) => clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
}

function startPageDuplicateDrag(sourceIndex, event, track) {
  event.preventDefault();
  event.stopPropagation();
  let moved = false;
  document.body.classList.add('is-page-dragging');
  const onMove = moveEvent => { moved ||= Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) > 8; };
  const finish = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', cancel);
    document.body.classList.remove('is-page-dragging');
  };
  const onUp = upEvent => {
    const target = pageIndexAtPoint(upEvent.clientX, upEvent.clientY, track);
    if (moved && target) {
      const targetIndex = Number(target.button.dataset.pageIndex);
      const targetRect = target.button.getBoundingClientRect();
      const insertIndex = targetIndex + (upEvent.clientX > targetRect.left + targetRect.width / 2 ? 1 : 0);
      const copy = duplicatePage(project.pages[sourceIndex]);
      project.pages.splice(Math.min(insertIndex, project.pages.length), 0, copy);
      currentPageIndex = Math.min(insertIndex, project.pages.length - 1);
      selectedItemId = null;
      activeInspector = 'page';
      finish(); render(); saveProject(); showToast('Página duplicada');
      return;
    }
    finish();
  };
  const cancel = () => finish();
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
  document.addEventListener('pointercancel', cancel, { once: true });
}

function renderPageCarousel() {
  const track = $('#pageCarouselTrack');
  if (!track) return;
  $('#carouselCount').textContent = `${project.pages.length} página${project.pages.length === 1 ? '' : 's'}`;
  track.innerHTML = `${project.pages.map((page, index) => `<div class="page-thumb-wrap"><button class="page-thumb ${index === currentPageIndex ? 'is-active' : ''}" data-page-index="${index}" type="button"><span class="page-thumb-canvas ${pageFormatClass()}" style="background:${project.background}">${pageThumbnailMarkup(page)}</span><span class="page-thumb-label">${String(index + 1).padStart(2, '0')} · ${escapeHtml(page.title || `Página ${index + 1}`)}</span></button><button class="page-thumb-menu-button" data-page-menu type="button" aria-label="Opciones de ${escapeHtml(page.title || `Página ${index + 1}`)}" title="Opciones">⋯</button><div class="page-thumb-menu" role="menu"><button data-copy-page="${index}" type="button" role="menuitem">Copiar</button><button data-delete-page-menu="${index}" type="button" role="menuitem" ${project.pages.length <= 1 ? 'disabled' : ''}>Eliminar</button></div></div>`).join('')}<button class="page-thumb page-thumb-add" data-add-page type="button" aria-label="Agregar nueva página"><span class="page-thumb-canvas page-thumb-add-canvas ${pageFormatClass()}"><span class="page-thumb-add-symbol">＋</span></span><span class="page-thumb-label">＋ Nueva página</span></button>`;
  $$('[data-page-index]', track).forEach(button => {
    button.addEventListener('pointerdown', event => { if (event.altKey) startPageDuplicateDrag(Number(button.dataset.pageIndex), event, track); });
    button.addEventListener('click', () => { if (document.body.classList.contains('is-page-dragging')) return; currentPageIndex = Number(button.dataset.pageIndex); selectedItemId = null; activeInspector = 'page'; render(); });
  });
  $$('[data-page-menu]', track).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); const wrapper = button.closest('.page-thumb-wrap'); const menu = wrapper.querySelector('.page-thumb-menu'); const wasOpen = wrapper.classList.contains('is-menu-open'); closePageMenus(); if (!wasOpen) { const rect = button.getBoundingClientRect(); menu.style.left = `${Math.max(6, Math.min(window.innerWidth - 144, rect.right - 136))}px`; menu.style.top = `${Math.min(window.innerHeight - 82, rect.bottom + 4)}px`; wrapper.classList.add('is-menu-open'); } }));
  $$('[data-copy-page]', track).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); duplicatePageAt(Number(button.dataset.copyPage)); }));
  $$('[data-delete-page-menu]', track).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); removePageAt(Number(button.dataset.deletePageMenu)); }));
  $('[data-add-page]', track)?.addEventListener('click', addNewPage);
}

function renderControls() {
  $('#projectTitle').value = project.title;
  $('#projectProducer').value = project.producer || '';
  $('#projectTitleDisplay').textContent = project.title || 'Sin título';
  $('#projectProducerDisplay').textContent = project.producer || '';
  $('#projectProducerLabel').hidden = !project.producer?.trim();
  $('#projectClient').value = project.client || '';
  $('#projectAgency').value = project.agency || '';
  $('#projectDirector').value = project.director || '';
  $('#breadcrumbTitle').textContent = project.title || 'Sin título';
  $('#backgroundColor').value = project.background;
  $('#backgroundValue').textContent = project.background.toUpperCase();
  $('#pageGap').value = project.gap;
  $('#pageGapValue').textContent = `${project.gap} px`;
  $('#pagePadding').value = project.padding;
  $('#pagePaddingValue').textContent = `${project.padding}%`;
  $('#layoutEngine').value = project.layoutEngine || 'grid';
  $('#layoutModeLabel').textContent = project.layoutEngine === 'adaptive' ? '✦ Distribución adaptable' : '✦ Grilla equitativa';
  $('#autoLayoutStatus').title = project.layoutEngine === 'adaptive' ? 'Las fotos se distribuyen según sus proporciones' : 'La grilla equitativa elige la mejor cantidad de filas y columnas para aprovechar el canvas';
  $('#showDescriptions').checked = project.showDescriptions;
  $('#infoPlacement').value = project.infoPlacement || 'below';
  $('#infoPlacement').disabled = !project.showDescriptions;
  $('#infoStyle').value = project.infoStyle || 'dark';
  $('#infoStyle').disabled = !project.showDescriptions;
  $('#showProjectTitle').checked = project.showProjectTitle;
  $('#showProducerBranding').checked = project.showProducerBranding;
  $('#showProjectFrame').checked = project.showProjectFrame;
  $('#showClientMeta').checked = project.showClientMeta;
  $('#showAgencyMeta').checked = project.showAgencyMeta;
  $('#showDirectorMeta').checked = project.showDirectorMeta;
  $('#showPageNumber').checked = project.showPageNumber;
  $('#producerLogoPreview').hidden = !project.producerLogo;
  $('#producerLogoPreview').innerHTML = project.producerLogo ? `<img src="${project.producerLogo}" alt="" /><span>${escapeHtml(project.producerLogoName || 'Logo cargado')}</span>` : '';
  $('#removeProducerLogoBtn').disabled = !project.producerLogo;
  $$('.format-btn').forEach(button => { button.classList.toggle('is-active', button.dataset.format === project.ratio); button.disabled = project.formatLocked; button.title = project.formatLocked ? 'El formato queda fijo durante este proyecto' : 'Elegí el formato del proyecto'; });
  renderFrameButtons('.fit-default-btn', ['original', ...Object.keys(FRAME_ASPECTS)], projectDefaultFrame());
  document.documentElement.style.setProperty('--zoom', zoom);
}

function renderInspector() {
  $('#pageInspector').hidden = activeInspector !== 'page';
  $('#infoInspector').hidden = activeInspector !== 'info';
  $('#photoInspector').hidden = activeInspector !== 'photo';
  $$('.inspector-tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.inspector === activeInspector));
  const item = findItem(selectedItemId);
  const photoInspectorActive = activeInspector === 'photo';
  $('#noSelection').hidden = !photoInspectorActive || !!item;
  $('#selectedPhotoForm').hidden = !photoInspectorActive || !item;
  if (!photoInspectorActive || !item) return;
  const asset = findAsset(item.assetId);
  $('#selectedPreview').innerHTML = asset ? `<img src="${asset.image}" alt="" />` : '';
  $('#selectedPhotoName').textContent = itemDisplayTitle(item, asset) || 'Foto';
  $('#selectedPhotoSize').textContent = asset ? `${asset.width} × ${asset.height} px` : '—';
  $('#slotNumber').textContent = String((item.slot ?? 0) + 1).padStart(2, '0');
  $('#photoFocusX').value = item.focusX ?? 50; $('#photoFocusY').value = item.focusY ?? 50;
  $('#focusValue').textContent = `${Math.round(item.focusX ?? 50)}% / ${Math.round(item.focusY ?? 50)}%`;
  $('#photoShotType').innerHTML = SHOT_TYPES.map(type => `<option value="${type.value}">${type.value} · ${type.label}</option>`).join('');
  $('#photoShotType').value = item.shotType || 'PG';
  $('#photoTitle').value = item.title || '';
  $('#photoDescription').value = item.description || '';
  $('#photoCameraMove').value = item.cameraMove || 'none';
  $('#photoCameraMoveMode').value = item.cameraMoveMode || 'overlay';
  $('#photoCameraMoveMode').disabled = item.slot >= currentPage().items.length - 1;
  $('#photoCameraMoveMode').title = item.slot >= currentPage().items.length - 1 ? 'El último plano no tiene un siguiente plano para conectar' : '';
  const frameModes = asset ? frameModesForAsset(asset) : ['original', ...Object.keys(FRAME_ASPECTS)];
  const currentFrame = itemFrameMode(item);
  renderFrameButtons('.fit-btn', frameModes, frameModes.includes(currentFrame) ? currentFrame : 'original');
}

function render() { renderControls(); renderLibrary(); renderPage(); renderInspector(); }

function selectItem(id) { selectedItemId = id; activeInspector = 'photo'; renderPage(); renderInspector(); }

function bindDesignItem(element) {
  const id = element.dataset.itemId;
  element.addEventListener('pointerdown', event => startSlotDrag(event, id));
  element.addEventListener('click', event => { event.stopPropagation(); selectItem(id); });
}

function startSlotDrag(event, id) {
  const item = findItem(id); if (!item || event.button !== 0) return;
  event.preventDefault();
  selectedItemId = id; activeInspector = 'photo';
  slotDrag = { id, duplicate: event.altKey };
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  slotMode = true; hoverSlotIndex = item.slot; renderPage(); renderInspector();
  const onMove = moveEvent => { moved ||= Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8; hoverSlotIndex = slotAtPoint(moveEvent.clientX, moveEvent.clientY); updateSlotGuides(); };
  const finish = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', cancel);
    slotDrag = null; slotMode = false; hoverSlotIndex = null;
    render();
  };
  const onUp = upEvent => {
    const targetSlot = slotAtPoint(upEvent.clientX, upEvent.clientY);
    if (targetSlot === null && moved && !slotDrag.duplicate) {
      currentPage().items = currentPage().items.filter(entry => entry.id !== id);
      renumberItems(currentPage());
      selectedItemId = null;
      activeInspector = 'page';
      finish(); saveProject(); showToast('Foto eliminada al arrastrarla fuera del canvas');
      return;
    }
    if (targetSlot !== null) {
      if (slotDrag.duplicate) {
        const copy = { ...item, id: createId('item') };
        currentPage().items.splice(targetSlot, 0, copy);
        renumberItems(currentPage());
        selectedItemId = copy.id;
      } else {
        moveItemToSlot(id, targetSlot);
      }
    }
    finish(); saveProject();
  };
  const cancel = () => finish();
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
  document.addEventListener('pointercancel', cancel, { once: true });
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function updateSlotGuides() { const target = hoverSlotIndex === null ? null : Math.min(hoverSlotIndex, currentPage().items.length - 1); $$('.slot-guide').forEach(guide => guide.classList.toggle('is-target', Number(guide.dataset.slotIndex) === target)); }
function moveItemToSlot(itemId, targetSlot) {
  const page = currentPage();
  const source = page.items.findIndex(item => item.id === itemId);
  if (source < 0) return;
  const [item] = page.items.splice(source, 1);
  page.items.splice(clamp(targetSlot, 0, page.items.length), 0, item);
  renumberItems(page);
  selectedItemId = itemId;
}
function addAssetToPage(assetId, targetSlot = null) {
  const asset = findAsset(assetId); const page = currentPage(); if (!asset || !page) return;
  const [item] = createAutoItems([asset]);
  page.items.splice(targetSlot === null ? page.items.length : clamp(targetSlot, 0, page.items.length), 0, item);
  renumberItems(page);
  selectedItemId = item.id; activeInspector = 'photo'; render(); saveProject(); showToast('Foto agregada · distribución ajustada');
}

function createAutoItems(assets) {
  return assets.map((asset, index) => ({ id: createId('item'), assetId: asset.id, slot: index, ...frameFields(projectDefaultFrame()), focusX: 50, focusY: 50, shotType: 'PG', title: '', description: '', cameraMove: 'none', cameraMoveMode: 'overlay' }));
}

function autoArrange() {
  const placed = placedAssetIds();
  const remaining = project.assets.filter(asset => !placed.has(asset.id));
  if (!remaining.length) { showToast('Todas las fotos de la biblioteca ya están en el storyboard'); return; }
  currentPage().items.push(...createAutoItems(remaining));
  renumberItems(currentPage());
  render(); saveProject(); showToast(`${remaining.length} fotos agregadas a esta página`);
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
    if (firstSlot !== null) {
      const page = currentPage();
      const items = createAutoItems(incoming);
      page.items.splice(clamp(firstSlot, 0, page.items.length), 0, ...items);
      renumberItems(page);
      selectedItemId = items[items.length - 1].id; activeInspector = 'photo';
    }
    render(); saveProject(); showToast(`${incoming.length} foto${incoming.length === 1 ? '' : 's'} agregada${incoming.length === 1 ? '' : 's'} ${firstSlot !== null ? 'al artboard' : 'a la biblioteca'}`);
  } catch { showToast('No se pudo leer alguna de las fotos'); }
}

function deleteSelected() { if (!selectedItemId) return; const page = currentPage(); page.items = page.items.filter(item => item.id !== selectedItemId); renumberItems(page); selectedItemId = null; activeInspector = 'page'; render(); saveProject(); showToast('Foto quitada · distribución ajustada'); }
function duplicateSelected() { const item = findItem(selectedItemId); if (!item) return; const copy = { ...item, id: createId('item') }; currentPage().items.splice(item.slot + 1, 0, copy); renumberItems(currentPage()); selectedItemId = copy.id; render(); saveProject(); showToast('Foto duplicada · distribución ajustada'); }
function deleteCurrentPage() {
  removePageAt(currentPageIndex);
}

function confirmDeletePage() {
  if (pendingDeletePageIndex === null || project.pages.length <= 1) return;
  captureUndoState();
  project.pages.splice(pendingDeletePageIndex, 1);
  currentPageIndex = Math.min(pendingDeletePageIndex, project.pages.length - 1);
  selectedItemId = null;
  activeInspector = 'page';
  closeDeletePageConfirm();
  render();
  saveProject();
  showToast('Página eliminada · Ctrl + Z para recuperar');
}

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
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, image.width / 100 * width, image.height / 100 * height);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.86)';
  ctx.fillRect(x + 10, y + 10, 34, 24);
  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(number, x + 27, y + 26);
  ctx.restore();
  ctx.textAlign = 'left';
  const title = itemDisplayTitle(item, asset);
  const description = item.description || '';
  if (!project.showDescriptions) return;
  const caption = layout.caption || { x: image.x, y: image.y + image.height * (1 - PHOTO_INFO_OVERLAY_HEIGHT / 100), width: image.width, height: image.height * PHOTO_INFO_OVERLAY_HEIGHT / 100 };
  const captionX = caption.x / 100 * width;
  const captionY = caption.y / 100 * height;
  const captionWidth = caption.width / 100 * width;
  const captionHeight = caption.height / 100 * height;
  ctx.save();
  ctx.beginPath();
  ctx.rect(captionX, captionY, captionWidth, captionHeight);
  ctx.clip();
  const lightInfo = project.infoStyle === 'light';
  ctx.fillStyle = lightInfo ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.86)';
  ctx.fillRect(captionX, captionY, captionWidth, captionHeight);
  ctx.fillStyle = lightInfo ? '#000' : '#fff';
  ctx.font = '600 13px Arial';
  ctx.fillText(title.slice(0, 48), captionX + 8, captionY + Math.min(17, captionHeight - 7));
  if (description && captionHeight > 30) { ctx.font = '11px Arial'; ctx.fillStyle = lightInfo ? '#555' : '#d0d0d0'; ctx.fillText(description.slice(0, 68), captionX + 8, captionY + Math.min(34, captionHeight - 7)); }
  ctx.restore();
}

function loadImageSource(source) {
  return new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = source; });
}

async function drawProducerBranding(ctx, width, height) {
  const producer = project.producer?.trim() || '';
  if (!project.showProducerBranding || (!producer && !project.producerLogo)) return;
  const logo = project.producerLogo ? await loadImageSource(project.producerLogo) : null;
  const padding = Math.max(8, Math.round(width * .008));
  const logoSize = Math.max(22, Math.round(height * .045));
  const fontSize = Math.max(13, Math.round(width * .011));
  ctx.save();
  ctx.font = `600 ${fontSize}px Arial`;
  const textWidth = producer ? ctx.measureText(producer.toUpperCase()).width : 0;
  const contentWidth = (logo ? logoSize + 8 : 0) + textWidth;
  const boxWidth = contentWidth + padding * 2;
  const boxHeight = logo ? logoSize + padding * 2 : fontSize + padding * 2;
  const x = width * .06;
  const y = height * .06;
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillRect(x, y, boxWidth, boxHeight);
  let cursorX = x + padding;
  if (logo) { ctx.drawImage(logo, cursorX, y + (boxHeight - logoSize) / 2, logoSize, logoSize); cursorX += logoSize + 8; }
  if (producer) { ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(producer.toUpperCase(), cursorX, y + boxHeight / 2); }
  ctx.restore();
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

function drawCanvasArrow(ctx, x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(8, Math.min(18, Math.hypot(x2 - x1, y2 - y1) * .08));
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6)); ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6)); ctx.closePath(); ctx.fill();
}

function drawCameraMoveOverlayCanvas(ctx, item, layout, width, height) {
  const move = cameraMoveInfo(item.cameraMove);
  if (move.value === 'none' || item.cameraMoveMode === 'between') return;
  const x = layout.card.x / 100 * width; const y = layout.card.y / 100 * height; const w = layout.card.width / 100 * width; const h = layout.card.height / 100 * height;
  const inset = Math.min(w, h) * .12;
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(2, Math.min(7, w * .012)); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 4;
  if (move.value === 'zoom-in' || move.value === 'dolly-in') { drawCanvasArrow(ctx, x + inset, y + inset * 2.4, x + inset * 3, y + inset); drawCanvasArrow(ctx, x + w - inset, y + inset * 2.4, x + w - inset * 3, y + inset); drawCanvasArrow(ctx, x + inset, y + h - inset * 2.4, x + inset * 3, y + h - inset); drawCanvasArrow(ctx, x + w - inset, y + h - inset * 2.4, x + w - inset * 3, y + h - inset); }
  if (move.value === 'zoom-out' || move.value === 'dolly-out') { drawCanvasArrow(ctx, x + inset * 3, y + inset, x + inset, y + inset * 2.4); drawCanvasArrow(ctx, x + w - inset * 3, y + inset, x + w - inset, y + inset * 2.4); drawCanvasArrow(ctx, x + inset * 3, y + h - inset, x + inset, y + h - inset * 2.4); drawCanvasArrow(ctx, x + w - inset * 3, y + h - inset, x + w - inset, y + h - inset * 2.4); }
  if (move.value === 'pan-left') drawCanvasArrow(ctx, x + w - inset, y + h / 2, x + inset, y + h / 2);
  if (move.value === 'pan-right') drawCanvasArrow(ctx, x + inset, y + h / 2, x + w - inset, y + h / 2);
  if (move.value === 'tilt-up') drawCanvasArrow(ctx, x + w / 2, y + h - inset, x + w / 2, y + inset);
  if (move.value === 'tilt-down') drawCanvasArrow(ctx, x + w / 2, y + inset, x + w / 2, y + h - inset);
  if (move.value === 'track-left') { drawCanvasArrow(ctx, x + w - inset, y + h * .43, x + inset, y + h * .43); drawCanvasArrow(ctx, x + w - inset, y + h * .57, x + inset, y + h * .57); }
  if (move.value === 'track-right') { drawCanvasArrow(ctx, x + inset, y + h * .43, x + w - inset, y + h * .43); drawCanvasArrow(ctx, x + inset, y + h * .57, x + w - inset, y + h * .57); }
  if (move.value === 'dolly-in' || move.value === 'dolly-out') { ctx.strokeRect(x + w * .32, y + h * .32, w * .36, h * .36); }
  ctx.shadowBlur = 0; ctx.font = `600 ${Math.max(9, Math.round(width * .008))}px Arial`; const labelWidth = Math.min(w * .7, Math.max(70, ctx.measureText(move.tag).width + 16)); ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.fillRect(x + (w - labelWidth) / 2, y + h - Math.max(24, h * .12), labelWidth, Math.max(18, h * .1)); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(move.tag, x + w / 2, y + h - Math.max(24, h * .12) / 2); ctx.restore();
}

function drawCameraMoveConnectorsCanvas(ctx, page, width, height) {
  const layouts = pageLayout(page); const aspect = getPageAspect(); const pageWidth = aspect * 100;
  page.items.forEach((item, index) => {
    const move = cameraMoveInfo(item.cameraMove); const next = page.items[index + 1];
    if (move.value === 'none' || item.cameraMoveMode !== 'between' || !next || !layouts[index] || !layouts[index + 1]) return;
    const toPhysical = rect => ({ x: rect.x / 100 * pageWidth, y: rect.y, width: rect.width / 100 * pageWidth, height: rect.height }); const from = toPhysical(layouts[index].card); const target = toPhysical(layouts[index + 1].card); const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }; const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 }; const dx = targetCenter.x - fromCenter.x; const dy = targetCenter.y - fromCenter.y; const distance = Math.hypot(dx, dy); if (!distance) return; const ux = dx / distance; const uy = dy / distance; const edgePoint = (rect, x, y) => { const tx = Math.abs(x) > .001 ? rect.width / 2 / Math.abs(x) : Infinity; const ty = Math.abs(y) > .001 ? rect.height / 2 / Math.abs(y) : Infinity; const edge = Math.min(tx, ty); return { x: rect.x + rect.width / 2 + x * edge, y: rect.y + rect.height / 2 + y * edge }; }; const start = edgePoint(from, ux, uy); const end = edgePoint(target, -ux, -uy); const sx = start.x / pageWidth * width; const sy = start.y / 100 * height; const ex = end.x / pageWidth * width; const ey = end.y / 100 * height;
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(2, Math.min(6, width * .004)); ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 4; drawCanvasArrow(ctx, sx, sy, ex, ey); ctx.shadowBlur = 0; ctx.font = `600 ${Math.max(9, Math.round(width * .007))}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const label = move.tag; const labelWidth = ctx.measureText(label).width + 14; const mx = (sx + ex) / 2; const my = (sy + ey) / 2; ctx.fillStyle = 'rgba(0,0,0,.82)'; ctx.fillRect(mx - labelWidth / 2, my - 11, labelWidth, 22); ctx.fillStyle = '#fff'; ctx.fillText(label, mx, my); ctx.restore();
  });
}

async function drawProjectMetaFrame(ctx, width, height, pageNumber, totalPages) {
  if (!project.showProjectFrame) return;
  const inset = Math.max(18, Math.round(Math.min(width, height) * .035));
  const barHeight = Math.max(24, Math.round(height * .045));
  const barY = inset - Math.round(barHeight / 2);
  const footerY = height - inset - Math.round(barHeight / 2);
  const logo = project.showProducerBranding && project.producerLogo ? await loadImageSource(project.producerLogo) : null;
  const details = [
    project.showClientMeta && project.client?.trim() ? ['CLIENTE', project.client] : null,
    project.showAgencyMeta && project.agency?.trim() ? ['AGENCIA', project.agency] : null,
    project.showDirectorMeta && project.director?.trim() ? ['DIRECTOR', project.director] : null
  ].filter(Boolean);
  ctx.save();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = Math.max(1, Math.round(width / 1400));
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.fillRect(inset + 12, barY, width - inset * 2 - 24, barHeight);
  ctx.fillRect(inset + 12, footerY, width - inset * 2 - 24, barHeight);
  const fontSize = Math.max(11, Math.round(width * .009));
  ctx.font = `600 ${fontSize}px Arial`;
  ctx.textBaseline = 'middle';
  let leftX = inset + 22;
  if (logo) { const logoSize = Math.max(16, Math.round(barHeight * .7)); ctx.drawImage(logo, leftX, barY + (barHeight - logoSize) / 2, logoSize, logoSize); leftX += logoSize + 8; }
  if (project.showProducerBranding && project.producer?.trim()) { ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.fillText(project.producer.trim().toUpperCase().slice(0, 44), leftX, barY + barHeight / 2); }
  if (project.showProjectTitle && project.title.trim()) { ctx.fillStyle = '#111'; ctx.textAlign = 'right'; ctx.fillText(project.title.trim().toUpperCase().slice(0, 54), width - inset - 22, barY + barHeight / 2); }
  let detailX = inset + 22;
  ctx.textAlign = 'left';
  details.forEach(([label, value]) => { ctx.fillStyle = '#777'; ctx.font = `500 ${Math.max(8, Math.round(fontSize * .72))}px Arial`; const prefix = `${label} ·`; ctx.fillText(prefix, detailX, footerY + barHeight / 2); detailX += ctx.measureText(prefix).width + 5; ctx.fillStyle = '#111'; ctx.font = `600 ${Math.max(9, Math.round(fontSize * .82))}px Arial`; const text = value.trim().toUpperCase().slice(0, 30); ctx.fillText(text, detailX, footerY + barHeight / 2); detailX += ctx.measureText(text).width + 18; });
  if (project.showPageNumber) { ctx.fillStyle = '#111'; ctx.font = `600 ${Math.max(9, Math.round(fontSize * .82))}px Arial`; ctx.textAlign = 'right'; ctx.fillText(String(pageNumber).padStart(2, '0'), width - inset - 22, footerY + barHeight / 2); }
  ctx.restore();
}

async function renderPageCanvas(page) {
  const width = project.ratio === 'portrait' ? 900 : 1600; const height = Math.round(width / getPageAspect()); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.fillStyle = project.background; ctx.fillRect(0, 0, width, height);
  await Promise.all(page.items.map(item => new Promise(resolve => { const asset = findAsset(item.assetId); if (!asset) return resolve(); const image = new Image(); const layout = itemLayout(item, page); image.onload = () => { drawImageInBox(ctx, image, layout.image.x / 100 * width, layout.image.y / 100 * height, layout.image.width / 100 * width, layout.image.height / 100 * height, item.fit, item.focusX, item.focusY); drawItemMetadata(ctx, item, asset, layout, width, height); resolve(); }; image.onerror = resolve; image.src = asset.image; })));
  page.items.forEach(item => drawCameraMoveOverlayCanvas(ctx, item, itemLayout(item, page), width, height));
  drawCameraMoveConnectorsCanvas(ctx, page, width, height);
  if (project.showProjectFrame) await drawProjectMetaFrame(ctx, width, height, currentPageIndex + 1, project.pages.length);
  else { await drawProducerBranding(ctx, width, height); drawProjectTitle(ctx, width, height); }
  return canvas;
}

async function exportImage(type) { const canvas = await renderPageCanvas(currentPage()); canvas.toBlob(blob => { downloadBlob(blob, `${project.title || 'storyboard'}-pagina-${currentPageIndex + 1}.${type}`); showToast(`Página exportada como ${type.toUpperCase()}`); }, type === 'jpg' ? 'image/jpeg' : 'image/png', .92); }

function printAllPages() {
  const layer = document.createElement('div'); layer.className = 'print-layer';
  project.pages.forEach((page, pageIndex) => {
    const sheet = document.createElement('div');
    sheet.className = `canvas-page print-page ${pageFormatClass()}`;
    sheet.style.background = project.background;
    page.items.forEach(item => {
      const asset = findAsset(item.assetId); if (!asset) return;
      const layout = itemLayout(item, page);
      const label = itemDisplayTitle(item, asset);
      const number = String((item.slot ?? 0) + 1).padStart(2, '0');
      const imageHeight = layout.image.height / layout.card.height * 100;
      const captionHeight = layout.caption ? layout.caption.height / layout.card.height * 100 : 0;
      const overlayInfo = project.showDescriptions && project.infoPlacement === 'overlay';
      const infoStyleClass = `description-style-${project.infoStyle || 'dark'}`;
      const infoMarkup = project.showDescriptions ? `<div class="description-box ${overlayInfo ? 'description-overlay ' : ''}${infoStyleClass} ${item.description ? '' : 'is-empty'}" style="height:${overlayInfo ? PHOTO_INFO_OVERLAY_HEIGHT : captionHeight}%"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(item.description || 'Agregar descripción…')}</small></div>` : '';
      const node = document.createElement('div');
      node.className = `design-item ${item.fit === 'contain' ? 'fit-contain' : 'fit-cover'}`;
      node.style.cssText = `left:${layout.card.x}%;top:${layout.card.y}%;width:${layout.card.width}%;height:${layout.card.height}%`;
      node.innerHTML = `<div class="design-photo" style="height:${imageHeight}%"><img src="${asset.image}" alt="" style="object-position:${item.focusX ?? 50}% ${item.focusY ?? 50}%" /><span class="item-number">${number}</span>${overlayInfo ? infoMarkup : ''}</div>${overlayInfo ? '' : infoMarkup}`;
      node.insertAdjacentHTML('beforeend', cameraMoveMarkup(item));
      sheet.appendChild(node);
    });
    sheet.insertAdjacentHTML('beforeend', cameraMoveConnectorMarkup(page));
    if (project.showProjectFrame) sheet.insertAdjacentHTML('beforeend', storyboardMetaMarkup(pageIndex + 1, project.pages.length));
    else {
      if (project.showProducerBranding && (project.producer?.trim() || project.producerLogo)) {
        const brand = document.createElement('div'); brand.className = 'producer-brand-overlay print-producer-brand';
        if (project.producerLogo) { const image = document.createElement('img'); image.src = project.producerLogo; image.alt = ''; brand.appendChild(image); }
        if (project.producer?.trim()) { const name = document.createElement('span'); name.textContent = project.producer.trim(); brand.appendChild(name); }
        sheet.appendChild(brand);
      }
      if (project.showProjectTitle && project.title.trim()) { const title = document.createElement('div'); title.className = 'project-title-overlay'; title.textContent = project.title; sheet.appendChild(title); }
    }
    layer.appendChild(sheet);
  });
  document.body.appendChild(layer); const cleanup = () => layer.remove(); window.addEventListener('afterprint', cleanup, { once: true }); window.print(); setTimeout(cleanup, 2500);
}

function openExport() { $('#exportModal').hidden = false; }
function closeExport() { $('#exportModal').hidden = true; }
function openFormatModal() { $('#formatModal').hidden = false; }
function closeFormatModal() { $('#formatModal').hidden = true; }
function openVersionModal() {
  if (!project) return;
  $$('#versionModal [data-version-format]').forEach(button => { button.disabled = button.dataset.versionFormat === project.ratio; button.title = button.disabled ? 'Este es el formato actual' : 'Crear una copia en este formato'; });
  $('#versionModal').hidden = false;
}
function closeVersionModal() { $('#versionModal').hidden = true; }
function createProjectVersion(format) {
  if (!project || format === project.ratio) return;
  const labels = { landscape: 'Horizontal', portrait: 'Vertical', square: '1:1' };
  const variant = normalizeProject(JSON.parse(JSON.stringify(project)));
  variant.id = createId('project');
  variant.title = `${project.title || 'Storyboard'} · ${labels[format] || format}`;
  variant.ratio = format;
  variant.formatLocked = true;
  variant.createdAt = new Date().toISOString();
  variant.updatedAt = variant.createdAt;
  variant.pages = variant.pages.map((page, pageIndex) => ({ ...page, id: createId('page'), title: page.title || `Página ${pageIndex + 1}`, items: page.items.map(item => ({ ...item, id: createId('item') })) }));
  projects.unshift(variant);
  persistProjects();
  project = variant;
  currentProjectId = variant.id;
  currentPageIndex = 0;
  selectedItemId = null;
  activeInspector = 'page';
  lastUndoState = null;
  closeVersionModal();
  showEditor();
  render();
  saveProject();
  showToast(`Versión ${labels[format] || format} creada`);
}
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
  lastUndoState = null;
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

$('#uploadZone').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', event => { handleFiles(event.target.files); event.target.value = ''; });
$('#uploadZone').addEventListener('dragover', event => { event.preventDefault(); $('#uploadZone').classList.add('is-over'); });
$('#uploadZone').addEventListener('dragleave', () => $('#uploadZone').classList.remove('is-over'));
$('#uploadZone').addEventListener('drop', event => { event.preventDefault(); $('#uploadZone').classList.remove('is-over'); handleFiles(event.dataTransfer.files); });

$('#importBtn').addEventListener('click', () => $('#projectInput').click());
$('#projectInput').addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader(); reader.onload = () => { try { const imported = JSON.parse(reader.result); if (!Array.isArray(imported.assets) || !Array.isArray(imported.pages)) throw new Error(); project = normalizeProject(imported); project.id = createId('project'); project.createdAt = new Date().toISOString(); project.updatedAt = new Date().toISOString(); lastUndoState = null; currentProjectId = project.id; currentPageIndex = 0; selectedItemId = null; activeInspector = 'page'; showEditor(); render(); saveProject(); showToast('Proyecto importado correctamente'); } catch { showToast('Ese archivo no parece un proyecto válido'); } }; reader.readAsText(file); event.target.value = '';
});

$('#canvasPage').addEventListener('click', event => { if (event.target === $('#canvasPage')) { selectedItemId = null; activeInspector = 'page'; render(); } });
$('#canvasPage').addEventListener('dragover', event => { event.preventDefault(); $('#canvasPage').classList.add('is-drop-target'); hoverSlotIndex = slotAtPoint(event.clientX, event.clientY); updateSlotGuides(); });
$('#canvasPage').addEventListener('dragleave', event => { if (!$('#canvasPage').contains(event.relatedTarget)) $('#canvasPage').classList.remove('is-drop-target'); });
$('#canvasPage').addEventListener('drop', event => { event.preventDefault(); $('#canvasPage').classList.remove('is-drop-target'); const targetSlot = slotAtPoint(event.clientX, event.clientY) ?? currentPage().items.length; const assetId = draggedAssetId; draggedAssetId = null; slotMode = false; hoverSlotIndex = null; if (assetId) addAssetToPage(assetId, targetSlot); else if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files, targetSlot); });

$('#autoArrangeBtn').addEventListener('click', autoArrange);
$$('.format-btn').forEach(button => button.addEventListener('click', () => { if (project.formatLocked) { showToast('El formato está fijado para este proyecto'); return; } project.ratio = button.dataset.format; render(); saveProject(); }));
$('#zoomOutBtn').addEventListener('click', () => { zoom = clamp(zoom - .1, .6, 1.4); renderControls(); }); $('#zoomInBtn').addEventListener('click', () => { zoom = clamp(zoom + .1, .6, 1.4); renderControls(); });
$('#prevPageBtn').addEventListener('click', () => { if (currentPageIndex > 0) { currentPageIndex--; selectedItemId = null; render(); } }); $('#nextPageBtn').addEventListener('click', () => { if (currentPageIndex < project.pages.length - 1) { currentPageIndex++; selectedItemId = null; render(); } });

['projectTitle', 'projectProducer', 'projectClient', 'projectAgency', 'projectDirector'].forEach(id => $('#' + id).addEventListener('input', event => { const key = { projectTitle: 'title', projectProducer: 'producer', projectClient: 'client', projectAgency: 'agency', projectDirector: 'director' }[id]; project[key] = event.target.value; if (id === 'projectProducer') { project.author = project.producer; $('#projectProducerDisplay').textContent = project.producer; $('#projectProducerLabel').hidden = !project.producer.trim(); } if (id === 'projectTitle') $('#projectTitleDisplay').textContent = project.title || 'Sin título'; $('#breadcrumbTitle').textContent = project.title || 'Sin título'; renderPage(); saveProject(); }));
$('#backgroundColor').addEventListener('input', event => { project.background = event.target.value; render(); saveProject(); });
$('#layoutEngine').addEventListener('change', event => { project.layoutEngine = event.target.value === 'adaptive' ? 'adaptive' : 'grid'; project.layoutEngineVersion = 1; render(); saveProject(); });
$('#pageGap').addEventListener('input', event => { project.gap = Number(event.target.value); render(); saveProject(); }); $('#pagePadding').addEventListener('input', event => { project.padding = Number(event.target.value); render(); saveProject(); }); $('#showDescriptions').addEventListener('change', event => { project.showDescriptions = event.target.checked; render(); saveProject(); }); $('#infoPlacement').addEventListener('change', event => { project.infoPlacement = event.target.value === 'overlay' ? 'overlay' : 'below'; render(); saveProject(); }); $('#infoStyle').addEventListener('change', event => { project.infoStyle = event.target.value === 'light' ? 'light' : 'dark'; render(); saveProject(); }); $('#showProjectTitle').addEventListener('change', event => { project.showProjectTitle = event.target.checked; render(); saveProject(); });
$('#showProducerBranding').addEventListener('change', event => { project.showProducerBranding = event.target.checked; render(); saveProject(); });
$('#showProjectFrame').addEventListener('change', event => { project.showProjectFrame = event.target.checked; render(); saveProject(); });
$('#showClientMeta').addEventListener('change', event => { project.showClientMeta = event.target.checked; render(); saveProject(); });
$('#showAgencyMeta').addEventListener('change', event => { project.showAgencyMeta = event.target.checked; render(); saveProject(); });
$('#showDirectorMeta').addEventListener('change', event => { project.showDirectorMeta = event.target.checked; render(); saveProject(); });
$('#showPageNumber').addEventListener('change', event => { project.showPageNumber = event.target.checked; render(); saveProject(); });
$('#producerLogoBtn').addEventListener('click', () => $('#producerLogoInput').click());
$('#producerLogoInput').addEventListener('change', event => { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) { showToast('Elegí un archivo de imagen'); event.target.value = ''; return; } const reader = new FileReader(); reader.onload = () => { project.producerLogo = reader.result; project.producerLogoName = file.name; project.showProducerBranding = true; render(); saveProject(); showToast('Logo de productora cargado'); }; reader.readAsDataURL(file); event.target.value = ''; });
$('#removeProducerLogoBtn').addEventListener('click', () => { project.producerLogo = ''; project.producerLogoName = ''; render(); saveProject(); });
$$('.fit-default-btn').forEach(button => button.addEventListener('click', () => { const mode = validFrameMode(button.dataset.frame) ? button.dataset.frame : 'original'; project.defaultFrame = mode; project.defaultCropAspect = frameAspect(mode); project.defaultFit = mode === 'original' ? 'contain' : 'cover'; renderControls(); saveProject(); }));
$('#clearPageBtn').addEventListener('click', () => { if (currentPage().items.length) $('#clearPageConfirmModal').hidden = false; });

$$('.inspector-tab').forEach(tab => tab.addEventListener('click', () => { activeInspector = tab.dataset.inspector; renderInspector(); }));
$$('.fit-btn').forEach(button => button.addEventListener('click', () => { const item = findItem(selectedItemId); if (!item) return; Object.assign(item, frameFields(validFrameMode(button.dataset.frame) ? button.dataset.frame : 'original')); renderPage(); renderInspector(); saveProject(); }));
$('#photoFocusX').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.focusX = Number(event.target.value); renderPage(); renderInspector(); saveProject(); }); $('#photoFocusY').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.focusY = Number(event.target.value); renderPage(); renderInspector(); saveProject(); }); $('#photoShotType').addEventListener('change', event => { const item = findItem(selectedItemId); if (!item) return; item.shotType = event.target.value; renderPage(); renderInspector(); saveProject(); }); $('#photoTitle').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.title = event.target.value; renderPage(); saveProject(); }); $('#photoDescription').addEventListener('input', event => { const item = findItem(selectedItemId); if (!item) return; item.description = event.target.value; renderPage(); saveProject(); }); $('#photoCameraMove').addEventListener('change', event => { const item = findItem(selectedItemId); if (!item) return; item.cameraMove = event.target.value; if (item.cameraMove === 'none') item.cameraMoveMode = 'overlay'; render(); saveProject(); }); $('#photoCameraMoveMode').addEventListener('change', event => { const item = findItem(selectedItemId); if (!item) return; item.cameraMoveMode = event.target.value === 'between' ? 'between' : 'overlay'; render(); saveProject(); });
$('#deletePhotoBtn').addEventListener('click', deleteSelected); $('#duplicatePhotoBtn').addEventListener('click', duplicateSelected); $('#clearLibraryBtn').addEventListener('click', () => { if (window.confirm('¿Quitar todas las fotos de la biblioteca?')) { project.assets = []; project.pages.forEach(page => { page.items = []; }); selectedItemId = null; render(); saveProject(); } });

$('#newProjectBtn').addEventListener('click', resetProject); $('#dashboardCreateBtn').addEventListener('click', resetProject); $('#dashboardEmptyCreateBtn').addEventListener('click', resetProject); $('#backToDashboardBtn').addEventListener('click', showDashboard); $('#createVersionBtn').addEventListener('click', openVersionModal); $('#exportBtn').addEventListener('click', openExport); $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeExport)); $('#exportModal').addEventListener('click', event => { if (event.target === $('#exportModal')) closeExport(); }); $$('[data-project-format]').forEach(button => button.addEventListener('click', () => selectProjectFormat(button.dataset.projectFormat))); $$('[data-version-format]').forEach(button => button.addEventListener('click', () => createProjectVersion(button.dataset.versionFormat))); $('#cancelVersionBtn').addEventListener('click', closeVersionModal); $('#versionModal').addEventListener('click', event => { if (event.target === $('#versionModal')) closeVersionModal(); }); $('#cancelNewProjectBtn').addEventListener('click', closeNewProjectConfirm); $('#cancelNewProjectBtnSecondary').addEventListener('click', closeNewProjectConfirm); $('#confirmNewProjectBtn').addEventListener('click', () => { closeNewProjectConfirm(); createProjectDraft(); }); $('#newProjectConfirmModal').addEventListener('click', event => { if (event.target === $('#newProjectConfirmModal')) closeNewProjectConfirm(); }); $('#cancelDeletePageBtn').addEventListener('click', closeDeletePageConfirm); $('#cancelDeletePageBtnSecondary').addEventListener('click', closeDeletePageConfirm); $('#confirmDeletePageBtn').addEventListener('click', confirmDeletePage); $('#deletePageConfirmModal').addEventListener('click', event => { if (event.target === $('#deletePageConfirmModal')) closeDeletePageConfirm(); }); $('#cancelClearPageBtn').addEventListener('click', closeClearPageConfirm); $('#cancelClearPageBtnSecondary').addEventListener('click', closeClearPageConfirm); $('#confirmClearPageBtn').addEventListener('click', confirmClearPage); $('#clearPageConfirmModal').addEventListener('click', event => { if (event.target === $('#clearPageConfirmModal')) closeClearPageConfirm(); }); $('#cancelDeleteProjectBtn').addEventListener('click', closeDeleteProjectModal); $('#cancelDeleteProjectBtnSecondary').addEventListener('click', closeDeleteProjectModal); $('#confirmDeleteProjectBtn').addEventListener('click', confirmDeleteProject); $('#deleteProjectModal').addEventListener('click', event => { if (event.target === $('#deleteProjectModal')) closeDeleteProjectModal(); });
$$('[data-export]').forEach(button => button.addEventListener('click', async () => { const type = button.dataset.export; closeExport(); if (type === 'json') downloadProject(); else if (type === 'print') printAllPages(); else await exportImage(type); }));

document.addEventListener('click', event => { if (!event.target.closest('.page-thumb-wrap')) closePageMenus(); });
document.addEventListener('keydown', event => { const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); showToast('Proyecto guardado'); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); restoreLastUndo(); } if (event.key === 'Delete' && !editing) { if (selectedItemId) deleteSelected(); else if (project && !$('#editorView').hidden) deleteCurrentPage(); } if (event.key === 'Escape') { closeExport(); closeVersionModal(); closeNewProjectConfirm(); closeDeletePageConfirm(); closeClearPageConfirm(); closeDeleteProjectModal(); closePageMenus(); } });

showDashboard();
