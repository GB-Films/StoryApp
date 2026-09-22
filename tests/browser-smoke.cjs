// Run with Playwright available in NODE_PATH. Uses an isolated browser profile.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const fixture = () => {
  const assets = Array.from({ length: 15 }, (_, index) => {
    const [width, height] = index < 6 ? [900, 900] : [[900, 1600], [1600, 900], [900, 900]][index % 3];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${['#578e89', '#ce8b51', '#56698c'][index % 3]}"/><circle cx="${width / 2}" cy="${height / 2}" r="${width / 3}" fill="#ffffff" opacity=".15"/><text x="50%" y="50%" text-anchor="middle" fill="white" font-size="90" font-family="sans-serif">${index + 1}</text></svg>`;
    return { id: `asset-${index}`, name: `Toma ${index + 1}`, width, height, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
  });
  return { version: 2, title: 'Prueba · secuencia automática', ratio: 'landscape', padding: 0, gap: 0, showDescriptions: true, showProjectFrame: true, showPageNumber: true, assets,
    pages: [{ id: 'page-1', photosPerPage: 4, layoutDirection: 'columns', items: assets.slice(0, 6).map((asset, slot) => ({ id: `item-${slot}`, assetId: asset.id, slot, fit: 'contain', title: `Escena ${slot + 1}`, description: `Descripción conservada ${slot + 1}`, shotType: 'PP', focusX: 50, focusY: 50 })) }] };
};

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname === '/' ? 'index.html' : new URL(req.url, 'http://localhost').pathname);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
    fs.readFile(file, (error, bytes) => { if (error) { res.statusCode = 404; res.end(); } else res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    // The production app requires Google authentication before exposing the
    // workspace. The smoke test supplies its own fixture, so unlock that
    // workspace after Firebase's signed-out state has settled.
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.body.classList.remove('auth-locked'); document.querySelector('#authGate').hidden = true; });
    const original = fixture();
    await page.evaluate(data => { project = normalizeProject(data); currentProjectId = project.id; currentPageIndex = 0; selectedItemId = null; activeInspector = 'page'; showEditor(); render(); saveProject(); }, original);
    await page.waitForFunction(() => document.querySelectorAll('#canvasPage .design-item').length === 6);
    const squarePhoto = await page.locator('#canvasPage .design-item').first().locator('.design-photo').boundingBox();
    assert.ok(Math.abs(squarePhoto.width / squarePhoto.height - 1) < .03, 'original square photos stay inside square frames');
    assert.equal(await page.locator('#canvasPage .storyboard-meta-page').textContent(), '01');
    await page.locator('#showProjectFrame').uncheck({ force: true });
    const viewportLayout = await page.evaluate(() => {
      const workspace = document.querySelector('#canvasWorkspace').getBoundingClientRect();
      const carousel = document.querySelector('#pageCarousel').getBoundingClientRect();
      const inspector = document.querySelector('.inspector-panel');
      return { workspaceScrolls: document.querySelector('#canvasWorkspace').scrollHeight > document.querySelector('#canvasWorkspace').clientHeight + 1, carouselInside: carousel.bottom <= workspace.bottom + 1, inspectorCanScroll: inspector.scrollHeight >= inspector.clientHeight };
    });
    await page.locator('#showDescriptions').uncheck({ force: true });
    const noInfoLayout = await page.evaluate(() => { const workspace = document.querySelector('#canvasWorkspace').getBoundingClientRect(); const canvas = document.querySelector('#canvasPage').getBoundingClientRect(); const carousel = document.querySelector('#pageCarousel').getBoundingClientRect(); return { workspace, canvas, carousel }; });
    await page.locator('#showDescriptions').check({ force: true });
    const withInfoLayout = await page.evaluate(() => { const workspace = document.querySelector('#canvasWorkspace').getBoundingClientRect(); const canvas = document.querySelector('#canvasPage').getBoundingClientRect(); const carousel = document.querySelector('#pageCarousel').getBoundingClientRect(); return { workspace, canvas, carousel }; });
    assert.ok(Math.abs(noInfoLayout.workspace.top - withInfoLayout.workspace.top) < 1);
    assert.ok(Math.abs(noInfoLayout.carousel.bottom - withInfoLayout.carousel.bottom) < 1, 'page thumbnails stay fixed when photo information changes');
    assert.ok(withInfoLayout.carousel.bottom <= withInfoLayout.workspace.bottom + 1);
    assert.equal(viewportLayout.workspaceScrolls, false, 'canvas workspace does not need page scrolling');
    assert.equal(viewportLayout.carouselInside, true, 'page thumbnails stay inside the fixed canvas area');
    assert.equal(viewportLayout.inspectorCanScroll, true, 'long inspector content scrolls independently');
    assert.equal(await page.locator('#photosPerPage').count(), 0);
    assert.equal(await page.locator('#layoutDirection').count(), 0);
    assert.equal(await page.locator('#addPageBtn').count(), 0);
    assert.equal(await page.locator('#importBtn').count(), 0);
    assert.equal(await page.locator('#newProjectBtn').count(), 0);
    assert.equal(await page.locator('#accountButton').count(), 1);
    assert.equal(await page.locator('.fit-btn').count(), 4);
    assert.equal(await page.locator('.fit-default-btn').count(), 4);
    assert.equal(await page.locator('#pageTotal').textContent(), '1');
    const screenshot = path.join(os.tmpdir(), 'storyapp-adaptive-six.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log('Screenshot:', screenshot);
    // A saved project with holes must keep visual order and user-chosen crop/focus.
    const migration = await page.evaluate(() => {
      const old = { ...project, layoutEngine: undefined, photosPerPage: 4, layoutDirection: 'grid', pages: [
        { id: 'old-1', items: [{ id: 'b', slot: 7, fit: 'cover', focusX: 20, focusY: 80, title: 'Encuadre propio', shotType: 'PD' }, { id: 'a', slot: 2, fit: 'contain' }] },
        { id: 'old-2', items: [{ id: 'c', slot: 0, fit: 'contain' }] }
      ] };
      const migrated = normalizeProject(old);
      return { pages: migrated.pages.length, items: migrated.pages[0].items, roundtrip: JSON.stringify(normalizeProject(migrated)) === JSON.stringify(migrated) };
    });
    assert.equal(migration.pages, 2);
    assert.deepEqual(migration.items.map(item => item.id), ['a', 'b']);
    assert.deepEqual(migration.items.map(item => item.slot), [0, 1]);
    assert.ok(migration.items[1].cropAspect > 0);
    assert.equal(migration.items[1].focusX, 20);
    assert.ok(migration.roundtrip);

    await page.locator('#canvasPage .design-item').first().click();
    assert.equal(await page.locator('.fit-btn:visible').count(), 3);
    assert.equal(await page.locator('.fit-btn[data-frame="square"]').isHidden(), true);
    for (const mode of ['horizontal', 'vertical', 'original']) {
      await page.locator(`.fit-btn[data-frame="${mode}"]`).click();
      const frame = await page.evaluate(() => { const item = findItem(selectedItemId); return { frame: item.frame, fit: item.fit, cropAspect: item.cropAspect }; });
      assert.equal(frame.frame, mode);
      assert.equal(frame.fit, mode === 'original' ? 'contain' : 'cover');
      if (mode === 'original') assert.equal(frame.cropAspect, null);
      else assert.ok(frame.cropAspect > 0);
    }
    await page.locator('#photoTitle').fill('Título que debe conservarse');
    await page.locator('#photoShotType').selectOption('PD');
    await page.locator('#autoArrangeBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 15);
    assert.equal(await page.locator('#pageTotal').textContent(), '1');
    await page.locator('#autoArrangeBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 15);
    await page.locator('#duplicatePhotoBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    await page.locator('#deletePhotoBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 15);
    await page.locator('[data-asset-id="asset-14"]').dragTo(page.locator('#canvasPage'), { targetPosition: { x: 500, y: 300 } });
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    // Dragging an existing shot outside the artboard removes it; a deliberate duplicate restores it.
    const removable = page.locator('#canvasPage .design-item').last();
    const removableBox = await removable.boundingBox();
    const boardBox = await page.locator('#canvasPage').boundingBox();
    await page.mouse.move(removableBox.x + removableBox.width / 2, removableBox.y + removableBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(boardBox.x - 80, boardBox.y - 80, { steps: 10 });
    await page.mouse.up();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 15);
    await page.locator('#canvasPage .design-item').first().click();
    await page.locator('#duplicatePhotoBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    const first = await page.locator('#canvasPage .design-item').first().boundingBox();
    const last = await page.locator('#canvasPage .design-item').last().boundingBox();
    const firstItemId = await page.locator('#canvasPage .design-item').first().getAttribute('data-item-id');
    const firstItemText = await page.locator('#canvasPage .design-item').first().locator('.description-box').textContent();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 3);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 3, { steps: 10 });
    await page.mouse.up();
    assert.equal(await page.locator('#canvasPage .design-item').last().getAttribute('data-item-id'), firstItemId);
    assert.equal(await page.locator('#canvasPage .design-item').last().locator('.description-box').textContent(), firstItemText);
    const expectedLastTitle = await page.evaluate(() => currentPage().items.at(-1).title);

    await page.locator('[data-inspector="page"]').click();
    assert.equal(await page.locator('[data-inspector="info"]').count(), 1);
    await page.locator('#backgroundPattern').selectOption('dots');
    assert.match(await page.locator('#canvasPage').evaluate(node => getComputedStyle(node).backgroundImage), /radial-gradient/);
    await page.locator('#backgroundImageInput').setInputFiles({ name: 'fondo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#d8d8d8"/></svg>') });
    await page.waitForFunction(() => Boolean(project.backgroundImage));
    assert.match(await page.locator('#canvasPage').evaluate(node => getComputedStyle(node).backgroundImage), /url\(/);
    assert.equal(await page.locator('#removeBackgroundImageBtn').isDisabled(), false);
    const inspectorWidth = () => page.evaluate(() => {
      const panel = document.querySelector('.inspector-panel').getBoundingClientRect();
      const editor = document.querySelector('.editor-area').getBoundingClientRect();
      return { panel: panel.width, editor: editor.width };
    });
    const pageInspectorLayout = await inspectorWidth();
    await page.locator('[data-inspector="photo"]').click();
    const photoInspectorLayout = await inspectorWidth();
    await page.locator('[data-inspector="info"]').click();
    const infoInspectorLayout = await inspectorWidth();
    assert.ok(Math.abs(pageInspectorLayout.panel - photoInspectorLayout.panel) < 1 && Math.abs(pageInspectorLayout.panel - infoInspectorLayout.panel) < 1, 'inspector width stays stable across tabs');
    assert.ok(Math.abs(pageInspectorLayout.editor - photoInspectorLayout.editor) < 1 && Math.abs(pageInspectorLayout.editor - infoInspectorLayout.editor) < 1, 'editor width stays stable across tabs');
    assert.equal(await page.locator('#projectTitle').isVisible(), true);
    assert.equal(await page.locator('#showClientMeta').isVisible(), false);
    await page.locator('#projectProducer').fill('GB Films');
    await page.locator('[data-inspector="page"]').click();
    await page.locator('#infoStyle').selectOption('light');
    assert.equal(await page.locator('#canvasPage .description-style-light').count(), 16);
    assert.deepEqual(await page.locator('#canvasPage .description-style-light').first().evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]), ['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
    await page.locator('#infoPlacement').selectOption('overlay');
    assert.equal(await page.locator('#canvasPage .description-overlay').count(), 16);
    assert.equal(await page.locator('#infoStyle').isDisabled(), false);
    assert.equal(await page.locator('#canvasPage .description-overlay.description-style-light').count(), 16);
    assert.deepEqual(await page.locator('#canvasPage .description-overlay.description-style-light').first().evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]), ['rgba(255, 255, 255, 0.92)', 'rgb(0, 0, 0)']);
    await page.locator('#infoPlacement').selectOption('below');
    assert.equal(await page.locator('#canvasPage .description-overlay').count(), 0);
    await page.locator('#showProducerBranding').check({ force: true });
    await page.locator('#producerLogoInput').setInputFiles({ name: 'gb-films.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="black"/></svg>') });
    await page.waitForSelector('#canvasPage .storyboard-meta-frame');
    await page.waitForSelector('#canvasPage .storyboard-meta-producer img');
    assert.equal(await page.locator('#canvasPage .storyboard-meta-producer img').count(), 1);
    assert.match(await page.locator('#canvasPage .storyboard-meta-producer').textContent(), /GB Films/);
    assert.equal(await page.locator('#canvasPage .storyboard-meta-frame').evaluate(node => node.classList.contains('is-frame-hidden')), true);
    // No image/caption may extend beyond its assigned card or beyond the safe area.
    const check = await page.evaluate(() => {
      const board = document.querySelector('#canvasPage').getBoundingClientRect();
      return [...document.querySelectorAll('#canvasPage .design-item')].every(node => {
        const card = node.getBoundingClientRect();
        const photo = node.querySelector('.design-photo').getBoundingClientRect();
        const caption = node.querySelector('.description-box').getBoundingClientRect();
        return card.left >= board.left + board.width * .06 - 1 && card.right <= board.right - board.width * .06 + 1 && card.top >= board.top + board.height * .06 - 1 && card.bottom <= board.bottom - board.height * .06 + 1 && photo.bottom <= card.bottom + 1 && caption.bottom <= card.bottom + 1;
      });
    });
    assert.ok(check, 'DOM photos and captions respect safe layout');
    for (const type of ['png', 'jpg', 'json']) {
      await page.locator('#exportBtn').click();
      const downloadPromise = page.waitForEvent('download');
      await page.locator(`[data-export="${type}"]`).click();
      const download = await downloadPromise;
      assert.ok((await fs.promises.stat(await download.path())).size > 100);
      if (type === 'png') await download.saveAs(path.join(os.tmpdir(), 'storyapp-adaptive-export.png'));
      if (type === 'json') {
        const saved = JSON.parse(await fs.promises.readFile(await download.path(), 'utf8'));
        assert.equal(saved.pages.length, 1);
        assert.equal(saved.pages[0].items.length, 16);
        assert.equal(saved.pages[0].items.at(-1).title, expectedLastTitle);
      }
    }
    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('#exportBtn').click();
    await page.locator('[data-export="print"]').click();
    assert.equal(await page.locator('.print-page .design-item').count(), 16);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('Guardado local'));
    await page.reload();
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.body.classList.remove('auth-locked'); document.querySelector('#authGate').hidden = true; });
    assert.equal(await page.locator('.project-card-arrow').count(), 0);
    assert.equal(await page.locator('[data-edit-project]').count(), 1);
    assert.equal(await page.locator('[data-delete-project]').count(), 1);
    assert.equal(await page.locator('.project-card-edit-row').count(), 0);
    const dashboardCard = await page.locator('.project-card').first().boundingBox();
    const dashboardEdit = await page.locator('[data-edit-project]').first().boundingBox();
    assert.ok(dashboardEdit.y > dashboardCard.y + dashboardCard.height - 60, 'dashboard actions stay in the bottom area');
    await page.locator('[data-edit-project]').click();
    assert.equal(await page.locator('[data-project-title]').isVisible(), true);
    assert.equal(await page.locator('.project-card-edit-row').count(), 0);
    const editingAction = await page.locator('[data-edit-project]').first().boundingBox();
    const editingCard = await page.locator('.project-card').first().boundingBox();
    assert.ok(editingAction.y > editingCard.y + editingCard.height - 60, 'dashboard actions stay at the bottom while editing');
    await page.locator('[data-project-title]').press('Enter');
    await page.locator('[data-open-project]').first().click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    assert.match(await page.locator('#canvasPage .design-item').last().textContent(), new RegExp(expectedLastTitle));
    await page.locator('[data-add-page]').click();
    assert.equal(await page.locator('#pageTotal').textContent(), '2');
    assert.equal(await page.locator('#canvasPage .design-item').count(), 0);
    const pageSource = page.locator('[data-page-index="0"]');
    const pageTarget = page.locator('[data-page-index="1"]');
    const pageTargetBox = await pageTarget.boundingBox();
    await page.keyboard.down('Alt');
    const pageSourceBox = await pageSource.boundingBox();
    await page.mouse.move(pageSourceBox.x + pageSourceBox.width / 2, pageSourceBox.y + pageSourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pageTargetBox.x + pageTargetBox.width * .8, pageTargetBox.y + pageTargetBox.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    assert.equal(await page.locator('#pageTotal').textContent(), '3');
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    await page.locator('[data-page-menu]').nth(2).click();
    await page.locator('[data-delete-page-menu="2"]').click();
    assert.equal(await page.locator('#pageTotal').textContent(), '2');
    await page.keyboard.press('Control+Z');
    assert.equal(await page.locator('#pageTotal').textContent(), '3');
    assert.equal(await page.locator('#deletePageConfirmModal').isVisible(), false);
    assert.equal(await page.locator('#deletePageBtn').count(), 0);
    await page.locator('#clearPageBtn').click();
    assert.equal(await page.locator('#clearPageConfirmModal').isVisible(), true);
    await page.locator('#cancelClearPageBtn').click();
    assert.equal(await page.locator('#clearPageConfirmModal').isVisible(), false);
    await page.locator('#clearPageBtn').click();
    await page.locator('#confirmClearPageBtn').click();
    assert.equal(await page.locator('#canvasPage .design-item').count(), 0);
    await page.keyboard.press('Control+Z');
    assert.equal(await page.locator('#canvasPage .design-item').count(), 16);
    // Check real-browser layout for mixed orientations on vertical and square pages too.
    for (const ratio of ['portrait', 'square']) {
      await page.evaluate(ratio => {
        project.ratio = ratio;
        currentPage().items = createAutoItems(project.assets.slice(6));
        render();
      }, ratio);
      const inside = await page.locator('#canvasPage').evaluate(board => {
        const rect = board.getBoundingClientRect();
        return [...board.querySelectorAll('.design-item')].every(item => {
          const card = item.getBoundingClientRect();
          return card.left > rect.left && card.right < rect.right && card.top > rect.top && card.bottom < rect.bottom;
        });
      });
      assert.ok(inside, ratio);
      await page.locator('#canvasPage').screenshot({ path: path.join(os.tmpdir(), `storyapp-adaptive-${ratio}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: migration, unlimited add, duplicate, delete, drag/reorder, overlay, export, persistence and manual pages.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
