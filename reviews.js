/* GB Studio Reviews: local media, time-linked feedback and frame annotations. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const DB_NAME = 'gb-studio-reviews-v1';
  const ACTIVE_KEY = 'gb-studio-reviews-active-v1';
  const state = { records: [], active: null, mediaUrl: null, model: null, drawing: false, sketchMode: false, draft: [], scratch: [], activeCommentId: null, pointerId: null, saving: false, view: { scale: 1, x: 0, y: 0 }, zHeld: false, zoomPointer: null };
  const video = $('#reviewsVideo');
  const image = $('#reviewsImage');
  const canvas = $('#reviewsCanvas');
  const ctx = canvas.getContext('2d');
  let databasePromise;

  function openDatabase() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }
  async function databaseRequest(storeName, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      let result;
      try { result = action(transaction.objectStore(storeName)); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar el archivo'));
    });
  }
  async function saveRecord(record) { await databaseRequest('items', 'readwrite', store => store.put(record)); }
  async function getMedia(id) { return databaseRequest('media', 'readonly', store => store.get(id)); }
  function formatTime(seconds) {
    const whole = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0;
    const hours = Math.floor(whole / 3600);
    const minutes = String(Math.floor(whole / 60) % 60).padStart(2, '0');
    const rest = String(whole % 60).padStart(2, '0');
    return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
  }
  function readableSize(bytes) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
  function parseDropboxLink(input) {
    let url;
    try { url = new URL(input.trim()); } catch { throw new Error('Pegá un enlace válido de Dropbox.'); }
    if (url.protocol !== 'https:' || !['dropbox.com', 'www.dropbox.com'].includes(url.hostname) || url.username || url.password || url.port || !/^\/(?:s\/[^/]+|scl\/fi\/[^/]+)(?:\/[^/]+)?\/?$/.test(url.pathname)) {
      throw new Error('Usá un enlace compartido de un archivo de dropbox.com, no una carpeta ni otra página.');
    }
    url.hash = '';
    url.searchParams.delete('dl'); url.searchParams.delete('raw');
    const sourceUrl = url.href;
    url.searchParams.set('raw', '1');
    const pathParts = url.pathname.split('/').filter(Boolean);
    let name = pathParts.length > (pathParts[0] === 's' ? 2 : 3) ? pathParts.at(-1) : 'Archivo de Dropbox';
    if (name) { try { name = decodeURIComponent(name); } catch { /* Keep the safe encoded name. */ } }
    if (!name || name === 'fi' || name === 's') name = 'Archivo de Dropbox';
    return { sourceUrl, streamUrl: url.href, name };
  }
  function sharedReviewFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('review')) return null;
    try { return { ...parseDropboxLink(params.get('review')), kind: params.get('kind') === 'image' ? 'image' : 'video' }; }
    catch { return null; }
  }
  const sharedReview = sharedReviewFromHash();
  if (sharedReview) document.body.classList.add('public-review');
  function isGuestReview() { return document.body.classList.contains('public-review') && !window.STUDIO_SIGNED_IN; }
  function applyReviewPermissions() {
    const guest = isGuestReview();
    $('#reviewsGuestPrompt').hidden = !guest;
    $('#reviewsCommentForm').hidden = guest || !state.active;
    $('#reviewsAnnotationBar').hidden = guest || !state.active;
    $('#reviewsRemoveMedia').hidden = guest || !state.active;
    renderCommentList();
  }
  function isVideo() { return state.active?.kind === 'video'; }
  function currentTime() { return isVideo() ? Math.max(0, video.currentTime || 0) : 0; }
  function showStatus(message) { $('#reviewsCommentContext').textContent = message; }
  function stopMedia() { video.pause(); video.removeAttribute('src'); video.load(); image.removeAttribute('src'); state.model?.dispose(); state.model = null; if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl); state.mediaUrl = null; }
  function clearAnnotation() { state.draft = []; state.scratch = []; state.activeCommentId = null; redraw(); renderCommentList(); }
  function fps() { return Number(state.active?.fps) || 24; }
  function firstFrame() { return Number.isSafeInteger(state.active?.frameStart) ? state.active.frameStart : 1; }
  function frameNumber() { return firstFrame() + Math.round(currentTime() * fps()); }
  function isMp4() { return isVideo() && /\.mp4$/i.test(state.active?.name || ''); }
  async function saveActiveSettings() { if (!state.active || state.active.ephemeral) return; state.active.updatedAt = new Date().toISOString(); try { await saveRecord(state.active); } catch { showStatus('No se pudieron guardar los ajustes en este navegador.'); } }
  function resetView() { state.view = { scale: 1, x: 0, y: 0 }; applyView(); state.model?.fit(); }
  function applyView() { $('#reviewsMediaSurface').style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`; $('#reviewsZoomValue').textContent = `${Math.round(state.view.scale * 100)}%`; }
  function zoomAt(factor, clientX, clientY) {
    const next = Math.max(.25, Math.min(12, state.view.scale * factor));
    const ratio = next / state.view.scale;
    const stage = $('#reviewsStage').getBoundingClientRect();
    state.view.x += (1 - ratio) * (clientX - (stage.left + stage.width / 2 + state.view.x));
    state.view.y += (1 - ratio) * (clientY - (stage.top + stage.height / 2 + state.view.y));
    state.view.scale = next; applyView();
  }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  function fitSurface() {
    const stage = $('#reviewsStage'), surface = $('#reviewsMediaSurface');
    if (surface.hidden || !stage.clientWidth || !stage.clientHeight) return;
    const style = getComputedStyle(stage);
    const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const aspect = Number(surface.style.getPropertyValue('--review-aspect')) || 16 / 9;
    const fittedWidth = Math.max(1, Math.min(width, height * aspect));
    surface.style.width = `${fittedWidth}px`;
    surface.style.height = `${fittedWidth / aspect}px`;
    resizeCanvas();
  }
  function visibleStrokes() {
    if (state.sketchMode) return state.scratch;
    if (state.draft.length) return state.draft;
    return state.active?.comments.find(comment => comment.id === state.activeCommentId)?.strokes || [];
  }
  function redraw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of visibleStrokes()) {
      if (!stroke.points?.length) continue;
      ctx.beginPath();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke.color || '#ff3b30';
      ctx.lineWidth = Math.max(2, rect.width * .004);
      stroke.points.forEach(([x, y], index) => index ? ctx.lineTo(x * rect.width, y * rect.height) : ctx.moveTo(x * rect.width, y * rect.height));
      if (stroke.points.length === 1) { const [x, y] = stroke.points[0]; ctx.lineTo(x * rect.width + .1, y * rect.height + .1); }
      ctx.stroke();
    }
  }
  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  }
  function renderList() {
    const list = $('#reviewsList');
    list.replaceChildren();
    $('#reviewsCount').textContent = state.records.length;
    if (!state.records.length) {
      const empty = document.createElement('p'); empty.className = 'reviews-list-empty'; empty.textContent = 'Todavía no cargaste archivos.'; list.append(empty); return;
    }
    for (const record of [...state.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `reviews-file${record.id === state.active?.id ? ' is-active' : ''}`;
      const icon = document.createElement('span'); icon.className = 'reviews-file-icon'; icon.textContent = record.kind === 'video' ? '▶' : record.kind === 'model' ? '◇' : '▧';
      const copy = document.createElement('span'); copy.className = 'reviews-file-copy';
      const name = document.createElement('strong'); name.textContent = record.name;
      const details = document.createElement('small'); details.textContent = `${record.source === 'dropbox' ? 'DROPBOX · ' : ''}${record.kind === 'video' ? 'VIDEO' : record.kind === 'model' ? 'FBX 3D' : 'FOTO'} · ${record.comments.length} comentario${record.comments.length === 1 ? '' : 's'}`;
      copy.append(name, details); button.append(icon, copy); button.addEventListener('click', () => selectRecord(record.id)); list.append(button);
    }
  }
  function renderMarkers() {
    const wrapper = $('#reviewsMarkers'); wrapper.replaceChildren();
    if (!isVideo() || !Number.isFinite(video.duration) || !video.duration) return;
    for (const comment of state.active.comments) {
      const marker = document.createElement('button'); marker.type = 'button'; marker.className = `reviews-marker${comment.resolved ? ' is-resolved' : ''}`;
      marker.style.left = `${Math.max(0, Math.min(100, comment.time / video.duration * 100))}%`;
      marker.title = `${formatTime(comment.time)} · ${comment.text || 'Anotación'}`;
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('click', () => selectComment(comment.id)); wrapper.append(marker);
    }
  }
  function renderCommentList() {
    const list = $('#reviewsCommentList'); list.replaceChildren();
    if (isGuestReview()) { $('#reviewsCommentCount').textContent = '0'; const empty = document.createElement('p'); empty.className = 'reviews-comment-empty'; empty.textContent = 'Iniciá sesión para ver y dejar comentarios. Los comentarios aún no se sincronizan entre personas.'; list.append(empty); return; }
    const comments = state.active?.comments || [];
    $('#reviewsCommentCount').textContent = comments.length;
    if (!state.active) return;
    if (!comments.length) {
      const empty = document.createElement('p'); empty.className = 'reviews-comment-empty'; empty.textContent = state.active.kind === 'model' ? 'Aún no hay comentarios sobre este modelo.' : 'Aún no hay comentarios. Pausá el video o elegí un punto de la foto para dejar la primera corrección.'; list.append(empty); return;
    }
    for (const comment of [...comments].sort((a, b) => a.time - b.time || a.createdAt.localeCompare(b.createdAt))) {
      const card = document.createElement('article'); card.className = `reviews-comment${comment.id === state.activeCommentId ? ' is-selected' : ''}${comment.resolved ? ' is-resolved' : ''}`;
      const open = document.createElement('button'); open.type = 'button'; open.className = 'reviews-comment-open';
      const meta = document.createElement('span'); meta.className = 'reviews-comment-meta'; meta.textContent = `${isVideo() ? formatTime(comment.time) : 'FOTO'}${comment.strokes?.length ? ' · ✎ Anotación' : ''}`;
      const text = document.createElement('span'); text.className = 'reviews-comment-text'; text.textContent = comment.text || 'Anotación visual';
      open.append(meta, text); open.addEventListener('click', () => selectComment(comment.id));
      const actions = document.createElement('div'); actions.className = 'reviews-comment-actions';
      const resolve = document.createElement('button'); resolve.type = 'button'; resolve.textContent = comment.resolved ? 'Reabrir' : 'Resolver'; resolve.addEventListener('click', () => updateComment(comment.id, entry => { entry.resolved = !entry.resolved; }));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => updateComment(comment.id, null));
      actions.append(resolve, remove); card.append(open, actions); list.append(card);
    }
  }
  function updateClock() {
    $('#reviewsCurrentTime').textContent = formatTime(currentTime());
    $('#reviewsDuration').textContent = formatTime(video.duration);
    $('#reviewsCommentTime').textContent = isVideo() ? formatTime(currentTime()) : 'Foto';
    $('#reviewsSeek').value = video.duration ? String(Math.round(currentTime() / video.duration * 1000)) : '0';
    $('#reviewsPlayBtn').textContent = video.paused ? '▶' : '❚❚';
    $('#reviewsPlayBtn').setAttribute('aria-label', video.paused ? 'Reproducir' : 'Pausar');
    $('#reviewsMuteBtn').textContent = video.muted ? '×' : '♪';
    $('#reviewsMuteBtn').setAttribute('aria-label', video.muted ? 'Activar sonido' : 'Silenciar');
    $('#reviewsFrameNumber').textContent = `Fotograma ${frameNumber()}`;
  }
  function renderPlaybackSettings() {
    const record = state.active;
    $('#reviewsFps').value = String(record?.fps || 24);
    $('#reviewsFrameStart').value = String(firstFrame());
    $('#reviewsInValue').textContent = Number.isFinite(record?.inPoint) ? formatTime(record.inPoint) : '—';
    $('#reviewsOutValue').textContent = Number.isFinite(record?.outPoint) ? formatTime(record.outPoint) : '—';
    for (const [id, point] of [['#reviewsInMarker', record?.inPoint], ['#reviewsOutMarker', record?.outPoint]]) {
      const marker = $(id); marker.hidden = !Number.isFinite(point) || !Number.isFinite(video.duration) || !video.duration;
      if (!marker.hidden) marker.style.left = `${Math.max(0, Math.min(100, point / video.duration * 100))}%`;
    }
    updateClock();
  }
  async function selectRecord(id) {
    const record = state.records.find(entry => entry.id === id); if (!record) return;
    stopMedia(); state.active = record; state.draft = []; state.scratch = []; state.sketchMode = false; state.activeCommentId = null; state.drawing = false; resetView();
    localStorage.setItem(ACTIVE_KEY, id);
    renderList(); renderCommentList();
    $('#reviewsMediaTitle').textContent = record.name;
    $('#reviewsMediaDetails').textContent = record.source === 'dropbox' ? `${record.kind === 'video' ? 'Video' : 'Foto'} · Dropbox · sin copia local` : `${record.kind === 'model' ? 'Modelo FBX' : record.kind === 'video' ? 'Video' : 'Foto'} · ${readableSize(record.size)}`;
    $('#reviewsMediaSurface').style.setProperty('--review-aspect', String(16 / 9));
    $('#reviewsMediaError').hidden = true;
    $('#reviewsOpenSource').hidden = record.source !== 'dropbox';
    $('#reviewsShareBtn').hidden = record.source !== 'dropbox';
    if (record.source === 'dropbox') { $('#reviewsOpenSource').href = record.sourceUrl; $('#reviewsErrorSource').href = record.sourceUrl; }
    $('#reviewsEmpty').hidden = true; $('#reviewsMediaSurface').hidden = false;
    $('#reviewsAnnotationBar').hidden = false; $('#reviewsCommentForm').hidden = false; $('#reviewsRemoveMedia').hidden = false;
    $('#reviewsViewTools').hidden = false; $('#reviewsPlaybackTools').hidden = record.kind !== 'video'; $('#reviewsDownloadBtn').hidden = !isMp4();
    $('#reviewsTimeline').hidden = record.kind !== 'video';
    $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); $('#reviewsSketchBtn').classList.remove('is-active'); $('#reviewsSketchBtn').setAttribute('aria-pressed', 'false');
    canvas.classList.remove('is-drawing');
    showStatus(record.kind === 'video' ? 'Los comentarios se guardan en el segundo actual.' : record.kind === 'model' ? 'Arrastrá para orbitar el modelo. Los comentarios no cambian el FBX.' : 'Los comentarios se guardan sobre esta foto.');
    image.hidden = record.kind !== 'image'; video.hidden = record.kind !== 'video'; $('#reviewsModel').hidden = record.kind !== 'model'; canvas.hidden = record.kind === 'model';
    renderPlaybackSettings(); requestAnimationFrame(fitSurface);
    applyReviewPermissions();
    try {
      if (record.source === 'dropbox') {
        const link = parseDropboxLink(record.sourceUrl);
        if (record.kind === 'video') video.src = link.streamUrl; else image.src = link.streamUrl;
        updateClock(); renderMarkers(); requestAnimationFrame(resizeCanvas);
        return;
      }
      const blob = await getMedia(id);
      if (state.active?.id !== id) return;
      if (!blob) throw new Error('El archivo ya no está disponible en este navegador');
      if (record.kind === 'model') {
        const { mountFbx } = await import('./reviews-3d.js?v=1');
        if (state.active?.id !== id) return;
        const viewer = await mountFbx($('#reviewsModel'), blob);
        if (state.active?.id !== id) { viewer.dispose(); return; }
        state.model = viewer;
        return;
      }
      state.mediaUrl = URL.createObjectURL(blob);
      if (record.kind === 'video') video.src = state.mediaUrl; else image.src = state.mediaUrl;
      updateClock(); renderMarkers(); requestAnimationFrame(resizeCanvas);
    } catch (error) { showStatus(error.message || 'No se pudo abrir el archivo'); $('#reviewsMediaError').hidden = false; console.error(error); }
  }
  function selectComment(id) {
    const comment = state.active?.comments.find(entry => entry.id === id); if (!comment) return;
    video.pause();
    if (isVideo()) video.currentTime = Math.min(comment.time, Number.isFinite(video.duration) ? video.duration : comment.time);
    state.activeCommentId = id; state.draft = []; state.scratch = []; state.sketchMode = false; state.drawing = false;
    canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); $('#reviewsSketchBtn').classList.remove('is-active'); $('#reviewsSketchBtn').setAttribute('aria-pressed', 'false');
    renderCommentList(); redraw(); updateClock();
  }
  async function updateComment(id, mutate) {
    if (!state.active) return;
    if (mutate) { const entry = state.active.comments.find(comment => comment.id === id); if (!entry) return; mutate(entry); }
    else state.active.comments = state.active.comments.filter(comment => comment.id !== id);
    if (state.activeCommentId === id && !mutate) state.activeCommentId = null;
    state.active.updatedAt = new Date().toISOString();
    try { await saveRecord(state.active); } catch { showStatus('No se pudo guardar el cambio. Revisá el espacio disponible.'); }
    renderCommentList(); renderList(); renderMarkers(); redraw();
  }
  async function addFiles(files) {
    for (const file of files) {
      const kind = /\.fbx$/i.test(file.name) ? 'model' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
      if (!kind) { showStatus(`Formato no compatible: ${file.name}`); continue; }
      const now = new Date().toISOString();
      const record = { id: crypto.randomUUID(), name: file.name, kind, size: file.size, createdAt: now, updatedAt: now, comments: [] };
      try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['items', 'media'], 'readwrite');
          tx.objectStore('items').put(record); tx.objectStore('media').put(file, record.id);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
        state.records.unshift(record); await selectRecord(record.id);
      } catch (error) { showStatus(`No se pudo guardar ${file.name}. Puede faltar espacio en este navegador.`); console.error(error); }
    }
  }
  async function addDropboxLink(event) {
    event.preventDefault();
    const message = $('#reviewsLinkMessage'); message.classList.remove('is-error');
    let link;
    try { link = parseDropboxLink($('#reviewsLinkUrl').value); }
    catch (error) { message.textContent = error.message; message.classList.add('is-error'); return; }
    const existing = state.records.find(record => record.source === 'dropbox' && record.sourceUrl === link.sourceUrl);
    if (existing) { await selectRecord(existing.id); message.textContent = 'Este archivo ya estaba vinculado; lo abrimos en el visor.'; return; }
    const now = new Date().toISOString();
    const record = { id: crypto.randomUUID(), name: link.name, kind: $('#reviewsLinkKind').value, source: 'dropbox', sourceUrl: link.sourceUrl, size: 0, createdAt: now, updatedAt: now, comments: [] };
    try {
      await saveRecord(record);
      state.records.unshift(record); await selectRecord(record.id);
      $('#reviewsLinkUrl').value = ''; setLinkFormOpen(false);
      message.textContent = 'En Dropbox: Compartir → Copiar enlace del archivo. Para verlo acá, debe permitir acceso a cualquiera con el enlace.';
    } catch (error) { message.textContent = 'No se pudo guardar el enlace en este navegador.'; message.classList.add('is-error'); console.error(error); }
  }
  async function removeActive() {
    const record = state.active; if (!record || !confirm(`¿Quitar “${record.name}” y sus comentarios de este navegador?${record.source === 'dropbox' ? ' El archivo original de Dropbox no se eliminará.' : ''}`)) return;
    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['items', 'media'], 'readwrite');
        tx.objectStore('items').delete(record.id); tx.objectStore('media').delete(record.id);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      stopMedia(); state.records = state.records.filter(entry => entry.id !== record.id); state.active = null; localStorage.removeItem(ACTIVE_KEY);
      if (state.records.length) await selectRecord(state.records[0].id);
      else {
        $('#reviewsMediaTitle').textContent = 'Elegí un archivo'; $('#reviewsMediaDetails').textContent = 'Vinculá Dropbox o cargá un archivo para empezar.';
        $('#reviewsEmpty').hidden = false; $('#reviewsMediaSurface').hidden = true; $('#reviewsTimeline').hidden = true;
        $('#reviewsAnnotationBar').hidden = true; $('#reviewsCommentForm').hidden = true; $('#reviewsRemoveMedia').hidden = true; $('#reviewsOpenSource').hidden = true; $('#reviewsShareBtn').hidden = true; $('#reviewsMediaError').hidden = true; $('#reviewsViewTools').hidden = true; $('#reviewsPlaybackTools').hidden = true;
        showStatus('Elegí un archivo para ver sus comentarios.'); renderList(); renderCommentList();
      }
    } catch (error) { showStatus('No se pudo eliminar el archivo.'); console.error(error); }
  }
  function showReviews() {
    const publicView = document.body.classList.contains('public-review');
    if (document.body.classList.contains('auth-locked') && !publicView) return;
    showDashboard();
    if (publicView) document.body.classList.add('public-review');
    $('#dashboardView').hidden = true; $('#reviewsView').hidden = false; document.body.classList.add('reviews-open');
    $('#reviewsHudRestore').hidden = true;
    $('#storyboardsNav').classList.remove('is-active'); $('#reviewsNav').classList.add('is-active');
    $('#breadcrumbTitle').textContent = 'Reviews';
    applyReviewPermissions();
    requestAnimationFrame(fitSurface);
  }
  async function initialize() {
    try {
      state.records = await databaseRequest('items', 'readonly', store => store.getAll()) || [];
      renderList();
    } catch (error) { showStatus('Reviews necesita almacenamiento local del navegador para guardar archivos y comentarios.'); console.error(error); }
    if (sharedReview) {
      const record = { id: crypto.randomUUID(), name: sharedReview.name, kind: sharedReview.kind, source: 'dropbox', sourceUrl: sharedReview.sourceUrl, size: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: [], ephemeral: true };
      state.records.unshift(record);
      await selectRecord(record.id);
      showReviews();
      return;
    }
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id && state.records.some(record => record.id === id)) await selectRecord(id);
    else if (state.records.length) await selectRecord(state.records[0].id);
  }

  function setRangePoint(which) {
    if (!isVideo() || !Number.isFinite(video.duration)) return;
    const point = Math.max(0, Math.min(video.duration, currentTime()));
    if (which === 'in') { state.active.inPoint = point; if (Number.isFinite(state.active.outPoint) && state.active.outPoint <= point) state.active.outPoint = null; }
    else { state.active.outPoint = point; if (Number.isFinite(state.active.inPoint) && state.active.inPoint >= point) state.active.inPoint = null; }
    renderPlaybackSettings(); saveActiveSettings();
  }
  function stepFrame(direction) { if (!isVideo() || !Number.isFinite(video.duration)) return; video.pause(); video.currentTime = Math.max(0, Math.min(video.duration, currentTime() + direction / fps())); updateClock(); }
  function jumpNote(direction) {
    if (!isVideo()) return;
    const times = [...new Set(state.active.comments.map(comment => comment.time))].sort((a, b) => a - b);
    const target = direction > 0 ? times.find(time => time > currentTime() + .02) : times.reverse().find(time => time < currentTime() - .02);
    if (target === undefined) return;
    video.pause(); video.currentTime = target;
    const comment = state.active.comments.find(entry => Math.abs(entry.time - target) < .001);
    if (comment) selectComment(comment.id);
  }
  async function screenshot() {
    if (!state.active) return;
    const source = state.active.kind === 'model' ? state.model?.canvas : isVideo() ? video : image;
    const width = source?.videoWidth || source?.naturalWidth || source?.width;
    const height = source?.videoHeight || source?.naturalHeight || source?.height;
    if (!width || !height) { showStatus('Esperá a que el archivo termine de cargar para capturar el cuadro.'); return; }
    const output = document.createElement('canvas'); output.width = width; output.height = height;
    const outputContext = output.getContext('2d');
    try {
      outputContext.drawImage(source, 0, 0, width, height);
      if (!canvas.hidden) outputContext.drawImage(canvas, 0, 0, width, height);
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('El navegador bloqueó la captura del archivo externo.');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${state.active.name.replace(/\.[^.]+$/, '')}-${isVideo() ? `fotograma-${frameNumber()}` : 'captura'}.png`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showStatus('Captura PNG descargada.');
    } catch (error) { showStatus('No se pudo capturar este archivo externo: Dropbox no habilita la lectura de sus píxeles desde esta página. Probá con un archivo local.'); console.error(error); }
  }
  function downloadMp4() {
    if (!isMp4()) return;
    const anchor = document.createElement('a');
    if (state.active.source === 'dropbox') { const url = new URL(state.active.sourceUrl); url.searchParams.set('dl', '1'); anchor.href = url.href; }
    else anchor.href = state.mediaUrl;
    anchor.download = state.active.name; anchor.rel = 'noopener'; anchor.click();
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#reviewsView').requestFullscreen(); }
    catch { showStatus('El navegador no permitió activar pantalla completa.'); }
  }
  function toggleHud() { const hidden = document.body.classList.toggle('reviews-hud-hidden'); $('#reviewsHudRestore').hidden = !hidden; requestAnimationFrame(fitSurface); }
  function isEditingText(target) { return target?.closest?.('input,textarea,select,[contenteditable="true"]'); }

  $('#reviewsNav').addEventListener('click', showReviews);
  $('#dashboardReviewsBtn').addEventListener('click', showReviews);
  $('#storyboardsNav').addEventListener('click', () => video.pause());
  document.querySelector('.brand').addEventListener('click', () => video.pause());
  $('#reviewsUploadBtn').addEventListener('click', () => $('#reviewsFileInput').click());
  function setLinkFormOpen(open) { $('#reviewsLinkForm').hidden = !open; $('#reviewsLinkBtn').setAttribute('aria-expanded', String(open)); $('#reviewsView .reviews-library').classList.toggle('is-linking', open); if (open) $('#reviewsLinkUrl').focus(); }
  $('#reviewsLinkBtn').addEventListener('click', () => setLinkFormOpen($('#reviewsLinkForm').hidden));
  $('#reviewsEmptyUpload').addEventListener('click', () => setLinkFormOpen(true));
  $('#reviewsLinkCancel').addEventListener('click', () => setLinkFormOpen(false));
  $('#reviewsLinkForm').addEventListener('submit', addDropboxLink);
  $('#reviewsLinkUrl').addEventListener('input', () => { const message = $('#reviewsLinkMessage'); message.classList.remove('is-error'); message.textContent = 'En Dropbox: Compartir → Copiar enlace del archivo. Para verlo acá, debe permitir acceso a cualquiera con el enlace.'; const value = $('#reviewsLinkUrl').value.toLowerCase().split('?')[0]; if (/\.(?:jpg|jpeg|png|webp|gif|avif|heic|bmp)$/.test(value)) $('#reviewsLinkKind').value = 'image'; else if (/\.(?:mp4|mov|m4v|webm|mkv)$/.test(value)) $('#reviewsLinkKind').value = 'video'; });
  $('#reviewsFileInput').addEventListener('change', event => { addFiles([...event.target.files]); event.target.value = ''; });
  $('#reviewsRemoveMedia').addEventListener('click', removeActive);
  $('#reviewsGuestLogin').addEventListener('click', () => $('#authGateButton').click());
  window.addEventListener('studio-auth-change', () => {
    if (sharedReview && window.STUDIO_SIGNED_IN) {
      const existing = state.records.find(record => !record.ephemeral && record.source === 'dropbox' && record.sourceUrl === sharedReview.sourceUrl);
      if (existing && state.active?.id !== existing.id) selectRecord(existing.id);
    }
    applyReviewPermissions();
  });
  $('#reviewsShareBtn').addEventListener('click', async () => {
    if (state.active?.source !== 'dropbox') return;
    const link = new URL(location.href); link.hash = new URLSearchParams({ review: state.active.sourceUrl, kind: state.active.kind }).toString();
    try { await navigator.clipboard.writeText(link.href); showStatus('Enlace de vista copiado. La otra persona podrá ver el archivo; los comentarios todavía no se comparten.'); }
    catch { window.prompt('Copiá el enlace de vista:', link.href); }
  });
  $('#reviewsInBtn').addEventListener('click', () => setRangePoint('in'));
  $('#reviewsOutBtn').addEventListener('click', () => setRangePoint('out'));
  $('#reviewsClearRange').addEventListener('click', () => { if (!isVideo()) return; state.active.inPoint = null; state.active.outPoint = null; renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsFps').addEventListener('change', event => { if (!isVideo()) return; state.active.fps = Number(event.target.value); renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsFrameStart').addEventListener('change', event => { if (!isVideo()) return; state.active.frameStart = Math.max(0, Math.min(9999999, Math.round(Number(event.target.value) || 0))); renderPlaybackSettings(); saveActiveSettings(); });
  $('#reviewsFitBtn').addEventListener('click', resetView);
  $('#reviewsScreenshotBtn').addEventListener('click', screenshot);
  $('#reviewsDownloadBtn').addEventListener('click', downloadMp4);
  $('#reviewsFullscreenBtn').addEventListener('click', toggleFullscreen);
  $('#reviewsHudBtn').addEventListener('click', toggleHud);
  $('#reviewsHudRestore').addEventListener('click', toggleHud);
  document.addEventListener('fullscreenchange', () => { $('#reviewsFullscreenBtn').textContent = document.fullscreenElement ? 'F · Salir de pantalla completa' : 'F · Pantalla completa'; requestAnimationFrame(fitSurface); });
  $('#reviewsStage').addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); $('#reviewsStage').classList.add('is-drop-target'); } });
  $('#reviewsStage').addEventListener('dragleave', () => $('#reviewsStage').classList.remove('is-drop-target'));
  $('#reviewsStage').addEventListener('drop', event => { event.preventDefault(); $('#reviewsStage').classList.remove('is-drop-target'); addFiles([...event.dataTransfer.files]); });
  $('#reviewsStage').addEventListener('wheel', event => { if (!state.active || state.active.kind === 'model') return; event.preventDefault(); zoomAt(Math.exp(-event.deltaY * .002), event.clientX, event.clientY); }, { passive: false });
  $('#reviewsStage').addEventListener('pointerdown', event => { if (!state.zHeld || !state.active || event.button !== 0) return; event.preventDefault(); state.zoomPointer = { id: event.pointerId, y: event.clientY, scale: state.view.scale, moved: false }; $('#reviewsStage').setPointerCapture(event.pointerId); });
  $('#reviewsStage').addEventListener('pointermove', event => { const drag = state.zoomPointer; if (!drag || drag.id !== event.pointerId) return; if (Math.abs(event.clientY - drag.y) > 3) drag.moved = true; if (drag.moved) zoomAt(Math.exp((drag.y - event.clientY) * .012) * drag.scale / state.view.scale, event.clientX, event.clientY); });
  const endZoom = event => { const drag = state.zoomPointer; if (!drag || drag.id !== event.pointerId) return; if (!drag.moved && event.type === 'pointerup') zoomAt(1.5, event.clientX, event.clientY); state.zoomPointer = null; if ($('#reviewsStage').hasPointerCapture(event.pointerId)) $('#reviewsStage').releasePointerCapture(event.pointerId); };
  $('#reviewsStage').addEventListener('pointerup', endZoom); $('#reviewsStage').addEventListener('pointercancel', endZoom);
  document.addEventListener('keydown', event => {
    if ($('#reviewsView').hidden || isEditingText(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.toLowerCase() === 'z') { state.zHeld = true; $('#reviewsStage').classList.add('is-zooming'); event.preventDefault(); return; }
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'i', 'o', 'f', 'q', 'h'].includes(key)) event.preventDefault(); else return;
    if (key === 'arrowleft') stepFrame(-1);
    else if (key === 'arrowright') stepFrame(1);
    else if (key === 'arrowup') jumpNote(-1);
    else if (key === 'arrowdown') jumpNote(1);
    else if (key === 'home' && isVideo()) video.currentTime = 0;
    else if (key === 'end' && isVideo() && Number.isFinite(video.duration)) video.currentTime = video.duration;
    else if (key === 'i') setRangePoint('in');
    else if (key === 'o') setRangePoint('out');
    else if (key === 'f') toggleFullscreen();
    else if (key === 'q') toggleHud();
    else if (key === 'h') resetView();
  });
  document.addEventListener('keyup', event => { if (event.key.toLowerCase() === 'z') { state.zHeld = false; $('#reviewsStage').classList.remove('is-zooming'); } });
  window.addEventListener('blur', () => { state.zHeld = false; $('#reviewsStage').classList.remove('is-zooming'); });
  function togglePlayback() { if (!video.paused) { video.pause(); return; } if (Number.isFinite(state.active?.inPoint) && (currentTime() < state.active.inPoint || (Number.isFinite(state.active.outPoint) && currentTime() >= state.active.outPoint))) video.currentTime = state.active.inPoint; video.play().catch(() => showStatus('Este navegador no puede reproducir el formato del video.')); }
  $('#reviewsPlayBtn').addEventListener('click', togglePlayback);
  $('#reviewsMuteBtn').addEventListener('click', () => { video.muted = !video.muted; updateClock(); });
  video.addEventListener('click', () => { if (state.drawing || state.zHeld) return; togglePlayback(); });
  $('#reviewsSeek').addEventListener('input', event => { if (!Number.isFinite(video.duration)) return; video.currentTime = video.duration * Number(event.target.value) / 1000; state.activeCommentId = null; redraw(); updateClock(); renderCommentList(); });
  video.addEventListener('loadedmetadata', () => { $('#reviewsMediaSurface').style.setProperty('--review-aspect', String((video.videoWidth || 16) / (video.videoHeight || 9))); renderPlaybackSettings(); renderMarkers(); fitSurface(); });
  image.addEventListener('load', () => { $('#reviewsMediaSurface').style.setProperty('--review-aspect', String((image.naturalWidth || 16) / (image.naturalHeight || 9))); fitSurface(); });
  video.addEventListener('timeupdate', () => { if (!video.paused && Number.isFinite(state.active?.outPoint) && currentTime() >= state.active.outPoint) { video.pause(); video.currentTime = state.active.outPoint; } updateClock(); });
  video.addEventListener('play', () => { state.activeCommentId = null; state.scratch = []; state.sketchMode = false; state.drawing = false; canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); $('#reviewsSketchBtn').classList.remove('is-active'); $('#reviewsSketchBtn').setAttribute('aria-pressed', 'false'); redraw(); renderCommentList(); updateClock(); });
  video.addEventListener('pause', updateClock);
  const mediaError = () => { if (state.active?.source === 'dropbox') { $('#reviewsMediaError').hidden = false; showStatus('No se pudo abrir el enlace de Dropbox. Revisá el acceso y el formato del archivo.'); } else showStatus('El formato no se puede reproducir en este navegador. Probá con MP4 (H.264), WebM o una foto compatible.'); };
  video.addEventListener('error', mediaError);
  image.addEventListener('error', mediaError);
  $('#reviewsDrawBtn').addEventListener('click', () => { if (!state.active) return; video.pause(); state.activeCommentId = null; state.sketchMode = false; state.drawing = !state.drawing; canvas.classList.toggle('is-drawing', state.drawing); $('#reviewsDrawBtn').classList.toggle('is-active', state.drawing); $('#reviewsDrawBtn').setAttribute('aria-pressed', String(state.drawing)); $('#reviewsSketchBtn').classList.remove('is-active'); $('#reviewsSketchBtn').setAttribute('aria-pressed', 'false'); redraw(); });
  $('#reviewsSketchBtn').addEventListener('click', () => { if (!state.active) return; video.pause(); state.activeCommentId = null; state.sketchMode = !state.sketchMode; state.drawing = state.sketchMode; canvas.classList.toggle('is-drawing', state.drawing); $('#reviewsSketchBtn').classList.toggle('is-active', state.sketchMode); $('#reviewsSketchBtn').setAttribute('aria-pressed', String(state.sketchMode)); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); redraw(); });
  $('#reviewsUndoBtn').addEventListener('click', () => { (state.sketchMode ? state.scratch : state.draft).pop(); redraw(); });
  $('#reviewsClearBtn').addEventListener('click', clearAnnotation);
  canvas.addEventListener('pointerdown', event => { if (!state.drawing || !state.active || state.zHeld) return; event.preventDefault(); state.activeCommentId = null; state.pointerId = event.pointerId; canvas.setPointerCapture(event.pointerId); (state.sketchMode ? state.scratch : state.draft).push({ color: $('#reviewsColor').value, points: [pointerPoint(event)] }); redraw(); });
  canvas.addEventListener('pointermove', event => { const strokes = state.sketchMode ? state.scratch : state.draft; if (state.pointerId !== event.pointerId || !strokes.length) return; const stroke = strokes.at(-1); const point = pointerPoint(event); const last = stroke.points.at(-1); if (Math.hypot((point[0] - last[0]) * canvas.clientWidth, (point[1] - last[1]) * canvas.clientHeight) > 2) { stroke.points.push(point); redraw(); } });
  const endStroke = event => { if (state.pointerId !== event.pointerId) return; state.pointerId = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke);
  $('#reviewsCommentForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.active || state.saving) return;
    const text = $('#reviewsCommentText').value.trim(); if (!text && (!state.draft.length || state.sketchMode)) { $('#reviewsCommentText').focus(); return; }
    const comment = { id: crypto.randomUUID(), text, time: currentTime(), strokes: state.sketchMode ? [] : structuredClone(state.draft), resolved: false, createdAt: new Date().toISOString() };
    state.saving = true; $('#reviewsCommentForm button[type=submit]').disabled = true;
    const wasEphemeral = Boolean(state.active.ephemeral);
    if (wasEphemeral) delete state.active.ephemeral;
    state.active.comments.push(comment); state.active.updatedAt = comment.createdAt;
    try {
      await saveRecord(state.active); $('#reviewsCommentText').value = ''; state.draft = []; if (!state.sketchMode) { state.activeCommentId = comment.id; state.drawing = false; canvas.classList.remove('is-drawing'); $('#reviewsDrawBtn').classList.remove('is-active'); $('#reviewsDrawBtn').setAttribute('aria-pressed', 'false'); }
      renderCommentList(); renderMarkers(); renderList(); redraw();
    } catch (error) { state.active.comments.pop(); if (wasEphemeral) state.active.ephemeral = true; showStatus('No se pudo guardar el comentario. Revisá el espacio disponible.'); console.error(error); }
    finally { state.saving = false; $('#reviewsCommentForm button[type=submit]').disabled = false; }
  });
  new ResizeObserver(resizeCanvas).observe($('#reviewsMediaSurface'));
  new ResizeObserver(fitSurface).observe($('#reviewsStage'));
  initialize();
})();
