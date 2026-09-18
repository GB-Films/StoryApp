const STORAGE_KEY = 'storyboard-studio-project-v1';

const createId = () => `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const defaultProject = () => ({
  title: 'Mi nuevo storyboard',
  author: 'Tu nombre',
  date: new Date().toISOString().slice(0, 10),
  notes: '',
  shots: []
});

let project = loadProject();
let activeView = 'grid';
let draggedId = null;
let saveTimer;
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));

function loadProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.shots) ? { ...defaultProject(), ...saved } : defaultProject();
  } catch { return defaultProject(); }
}

function saveProject() {
  clearTimeout(saveTimer);
  $('#saveState').innerHTML = '<span class="status-dot is-saving"></span>Guardando…';
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    $('#saveState').innerHTML = '<span class="status-dot"></span>Guardado local';
  }, 350);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function shotTypeLabel(value) {
  const labels = { wide: 'Plano general', medium: 'Plano medio', close: 'Primer plano', detail: 'Detalle', tracking: 'Seguimiento' };
  return labels[value] || labels.wide;
}

function shotTemplate(shot, index) {
  const image = shot.image
    ? `<img src="${shot.image}" alt="${escapeHtml(shot.title || `Foto ${index + 1}`)}" />`
    : '<span>▱</span>';
  return `<article class="shot-card" draggable="true" data-id="${shot.id}">
    <div class="shot-card-image ${shot.image ? '' : 'no-image'}">
      ${image}<span class="shot-number">${String(index + 1).padStart(2, '0')}</span><span class="drag-handle">⠿</span>
    </div>
    <div class="shot-card-body">
      <input class="shot-card-title" data-field="title" value="${escapeHtml(shot.title)}" placeholder="Título de la toma" aria-label="Título de la toma" />
      <textarea class="shot-card-description" data-field="description" placeholder="¿Qué sucede en esta toma?">${escapeHtml(shot.description)}</textarea>
      <div class="card-footer"><span class="shot-tag">${escapeHtml(shotTypeLabel(shot.type))}</span><div class="card-actions"><button class="icon-button" data-action="duplicate" title="Duplicar toma" type="button">⧉</button><button class="icon-button" data-action="delete" title="Eliminar toma" type="button">⌫</button></div></div>
    </div>
  </article>`;
}

function tableTemplate(shot, index) {
  return `<div class="table-row" data-id="${shot.id}">
    <div><span class="table-number">${String(index + 1).padStart(2, '0')}</span></div>
    <div><div class="table-thumb">${shot.image ? `<img src="${shot.image}" alt="" />` : ''}</div></div>
    <div><textarea class="table-field" data-field="description" placeholder="Acción / diálogo">${escapeHtml(shot.description)}</textarea></div>
    <div><select class="table-select" data-field="type"><option value="wide" ${shot.type === 'wide' ? 'selected' : ''}>Plano general</option><option value="medium" ${shot.type === 'medium' ? 'selected' : ''}>Plano medio</option><option value="close" ${shot.type === 'close' ? 'selected' : ''}>Primer plano</option><option value="detail" ${shot.type === 'detail' ? 'selected' : ''}>Detalle</option><option value="tracking" ${shot.type === 'tracking' ? 'selected' : ''}>Seguimiento</option></select><textarea class="table-field" data-field="camera" placeholder="Cámara / movimiento">${escapeHtml(shot.camera)}</textarea></div>
    <div><input class="table-field" data-field="duration" value="${escapeHtml(shot.duration)}" placeholder="00:04" /></div>
  </div>`;
}

function render() {
  $('#projectTitle').value = project.title;
  $('#projectAuthor').value = project.author;
  $('#projectDate').value = project.date;
  $('#projectNotes').value = project.notes;
  $('#shotCount').textContent = project.shots.length;
  $('#gridView').innerHTML = project.shots.map(shotTemplate).join('');
  $('#tableView').innerHTML = `<div class="table-head"><div>Nº</div><div>Foto</div><div>Acción / diálogo</div><div>Cámara / movimiento</div><div>Duración</div></div>${project.shots.map(tableTemplate).join('')}`;
  $('#gridView').hidden = activeView !== 'grid';
  $('#tableView').hidden = activeView !== 'table';
  $('#dropZone').hidden = project.shots.length > 0;
  $('#emptyState').hidden = project.shots.length > 0;
  $$('.view-btn').forEach(btn => btn.classList.toggle('is-active', btn.dataset.view === activeView));
  bindShotEvents();
}

function bindShotEvents() {
  $$('.shot-card, .table-row').forEach(card => {
    card.addEventListener('dragstart', event => { draggedId = card.dataset.id; card.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { draggedId = null; card.classList.remove('is-dragging'); $$('.shot-card, .table-row').forEach(item => item.classList.remove('is-selected')); });
    card.addEventListener('dragover', event => { event.preventDefault(); });
    card.addEventListener('drop', event => { event.preventDefault(); reorderShots(draggedId, card.dataset.id); });
    card.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'delete') deleteShot(card.dataset.id);
      if (action === 'duplicate') duplicateShot(card.dataset.id);
    });
    $$('[data-field]', card).forEach(field => field.addEventListener('input', () => updateShot(card.dataset.id, field.dataset.field, field.value)));
  });
}

function updateShot(id, field, value) { const shot = project.shots.find(item => item.id === id); if (!shot) return; shot[field] = value; saveProject(); if (field === 'type' && activeView === 'grid') render(); }
function reorderShots(fromId, toId) { if (!fromId || fromId === toId) return; const from = project.shots.findIndex(shot => shot.id === fromId); const to = project.shots.findIndex(shot => shot.id === toId); if (from < 0 || to < 0) return; const [shot] = project.shots.splice(from, 1); project.shots.splice(to, 0, shot); render(); saveProject(); showToast('Secuencia actualizada'); }
function deleteShot(id) { project.shots = project.shots.filter(shot => shot.id !== id); render(); saveProject(); showToast('Toma eliminada'); }
function duplicateShot(id) { const index = project.shots.findIndex(shot => shot.id === id); if (index < 0) return; const copy = { ...project.shots[index], id: createId(), title: `${project.shots[index].title || 'Toma'} (copia)` }; project.shots.splice(index + 1, 0, copy); render(); saveProject(); showToast('Toma duplicada'); }

function makeShot(file, image) { return { id: createId(), image, title: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '), description: '', camera: '', duration: '00:04', type: 'wide' }; }

function handleFiles(files) {
  const images = [...files].filter(file => file.type.startsWith('image/'));
  if (!images.length) { showToast('Elegí archivos de imagen JPG, PNG o WEBP'); return; }
  let pending = images.length;
  images.forEach(file => { const reader = new FileReader(); reader.onload = event => { project.shots.push(makeShot(file, event.target.result)); if (!--pending) { render(); saveProject(); showToast(`${images.length} foto${images.length === 1 ? '' : 's'} agregada${images.length === 1 ? '' : 's'}`); } }; reader.readAsDataURL(file); });
}

function resetProject() { if (project.shots.length && !window.confirm('¿Crear un proyecto nuevo? Se conservará lo que ya guardaste en este dispositivo, pero se limpiará la vista actual.')) return; project = defaultProject(); render(); saveProject(); showToast('Nuevo proyecto listo'); }

function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function downloadJson() { downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${project.title || 'storyboard'}.json`); showToast('Proyecto editable exportado'); }

function exportImage(format) {
  const width = 1600, cardWidth = 370, cardHeight = 310, gap = 24, padding = 70, columns = 3;
  const rows = Math.max(1, Math.ceil(project.shots.length / columns));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 245 + rows * (cardHeight + gap) + 100;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f5f5f0'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#172327'; ctx.font = '600 52px Arial'; ctx.fillText(project.title || 'Storyboard', padding, 78); ctx.fillStyle = '#ef714d'; ctx.font = '500 18px monospace'; ctx.fillText('STORYBOARD / ' + String(project.shots.length).padStart(2, '0') + ' TOMAS', padding, 116);
  ctx.strokeStyle = '#dfe4e0'; ctx.beginPath(); ctx.moveTo(padding, 145); ctx.lineTo(width - padding, 145); ctx.stroke();
  const drawCard = (shot, index) => new Promise(resolve => { const x = padding + (index % columns) * (cardWidth + gap); const y = 180 + Math.floor(index / columns) * (cardHeight + gap); ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(20,35,32,.08)'; ctx.shadowBlur = 18; ctx.fillRect(x, y, cardWidth, cardHeight); ctx.shadowBlur = 0; ctx.fillStyle = '#e4ece8'; ctx.fillRect(x, y, cardWidth, 205); const finish = () => { ctx.fillStyle = '#172327'; ctx.font = '600 20px Arial'; ctx.fillText(`${String(index + 1).padStart(2, '0')}  ${(shot.title || 'Sin título').slice(0, 25)}`, x + 18, y + 239); ctx.fillStyle = '#71807c'; ctx.font = '14px Arial'; const desc = (shot.description || 'Sin descripción').slice(0, 45); ctx.fillText(desc, x + 18, y + 264); resolve(); }; if (shot.image) { const image = new Image(); image.onload = () => { const ratio = Math.max(cardWidth / image.width, 205 / image.height); const iw = image.width * ratio, ih = image.height * ratio; ctx.save(); ctx.beginPath(); ctx.rect(x, y, cardWidth, 205); ctx.clip(); ctx.drawImage(image, x + (cardWidth - iw) / 2, y + (205 - ih) / 2, iw, ih); ctx.restore(); finish(); }; image.onerror = finish; image.src = shot.image; } else finish(); });
  Promise.all(project.shots.map(drawCard)).then(() => { canvas.toBlob(blob => { downloadBlob(blob, `${project.title || 'storyboard'}.${format}`); showToast(`Storyboard exportado como ${format.toUpperCase()}`); }, format === 'jpg' ? 'image/jpeg' : 'image/png', .92); });
}

function openExport() { $('#exportModal').hidden = false; }
function closeExport() { $('#exportModal').hidden = true; }

$('#addPhotosBtn').addEventListener('click', () => $('#fileInput').click()); $('#dropBrowseBtn').addEventListener('click', () => $('#fileInput').click()); $('#emptyAddBtn').addEventListener('click', () => $('#fileInput').click()); $('#fileInput').addEventListener('change', event => { handleFiles(event.target.files); event.target.value = ''; });
$('#newProjectBtn').addEventListener('click', resetProject); $('#exportBtn').addEventListener('click', openExport); $('#importBtn').addEventListener('click', () => $('#projectInput').click());
$('#projectInput').addEventListener('change', event => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const imported = JSON.parse(reader.result); if (!Array.isArray(imported.shots)) throw new Error(); project = { ...defaultProject(), ...imported }; render(); saveProject(); showToast('Proyecto importado'); } catch { showToast('Ese archivo no parece un proyecto válido'); } }; reader.readAsText(file); event.target.value = ''; });
$('#dropZone').addEventListener('dragover', event => { event.preventDefault(); $('#dropZone').classList.add('is-over'); }); $('#dropZone').addEventListener('dragleave', event => { if (event.target === $('#dropZone')) $('#dropZone').classList.remove('is-over'); }); $('#dropZone').addEventListener('drop', event => { event.preventDefault(); $('#dropZone').classList.remove('is-over'); handleFiles(event.dataTransfer.files); });
const workspace = $('.workspace');
workspace.addEventListener('dragover', event => {
  const hasFiles = [...(event.dataTransfer?.items || [])].some(item => item.kind === 'file');
  if (!hasFiles) return;
  event.preventDefault();
  workspace.classList.add('is-over');
});
workspace.addEventListener('dragleave', event => {
  if (!workspace.contains(event.relatedTarget)) workspace.classList.remove('is-over');
});
workspace.addEventListener('drop', event => {
  const hasFiles = [...(event.dataTransfer?.items || [])].some(item => item.kind === 'file');
  if (!hasFiles) return;
  event.preventDefault();
  workspace.classList.remove('is-over');
  handleFiles(event.dataTransfer.files);
});
$$('.view-btn').forEach(btn => btn.addEventListener('click', () => { activeView = btn.dataset.view; render(); }));
['projectTitle', 'projectAuthor', 'projectDate', 'projectNotes'].forEach(id => { $('#' + id).addEventListener('input', event => { const map = { projectTitle: 'title', projectAuthor: 'author', projectDate: 'date', projectNotes: 'notes' }; project[map[id]] = event.target.value; saveProject(); }); });
$$('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeExport)); $('#exportModal').addEventListener('click', event => { if (event.target === $('#exportModal')) closeExport(); });
$$('[data-export]').forEach(btn => btn.addEventListener('click', () => { const type = btn.dataset.export; closeExport(); if (type === 'json') downloadJson(); else if (type === 'print') { activeView = 'table'; render(); setTimeout(() => window.print(), 80); } else exportImage(type); }));
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); showToast('Proyecto guardado'); } if (event.key === 'Escape') closeExport(); });

render();
