// Optional integration check against a disposable Firestore share document.
// Set REVIEW_LIVE_SHARE_TOKEN to an existing temporary share before running.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const token = process.env.REVIEW_LIVE_SHARE_TOKEN;
if (!token) { console.error('Set REVIEW_LIVE_SHARE_TOKEN to run this integration check.'); process.exit(2); }
const root = path.join(__dirname, '..');
const server = http.createServer((request, response) => {
  const file = path.join(root, new URL(request.url, 'http://localhost').pathname === '/' ? 'index.html' : new URL(request.url, 'http://localhost').pathname);
  response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
  fs.readFile(file, (error, data) => { if (error) { response.statusCode = 404; response.end(); } else response.end(data); });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const url = `http://127.0.0.1:${server.address().port}`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#4d6474"/></svg>';
  const openGuest = async name => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('https://www.dropbox.com/scl/fi/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
    await page.goto(`${url}/#share=${token}`);
    await page.waitForFunction(() => document.querySelector('#reviewsImage')?.naturalWidth === 640, { timeout: 30000 });
    assert.equal(await page.locator('#authGate').isVisible(), false);
    assert.equal(await page.locator('#storyboardsNav').isVisible(), false);
    assert.equal(await page.locator('#reviewsGuestPrompt').isVisible(), true);
    if (name) {
      await page.locator('#reviewsGuestName').fill(name);
      await page.locator('#reviewsGuestLogin').click();
      await page.locator('#reviewsCommentForm').waitFor({ state: 'visible' });
    }
    assert.deepEqual(errors, []);
    return { context, page, errors };
  };
  try {
    const first = await openGuest('Roberto');
    const canvas = await first.page.locator('#reviewsCanvas').boundingBox();
    await first.page.locator('#reviewsDrawBtn').click();
    await first.page.mouse.move(canvas.x + canvas.width * .2, canvas.y + canvas.height * .2);
    await first.page.mouse.down();
    await first.page.mouse.move(canvas.x + canvas.width * .6, canvas.y + canvas.height * .6, { steps: 6 });
    await first.page.mouse.up();
    await first.page.locator('#reviewsCommentText').fill('Ajustar el plano');
    await first.page.locator('#reviewsCommentForm button[type=submit]').click();
    await first.page.waitForFunction(() => document.querySelector('#reviewsCommentCount').textContent === '1', null, { timeout: 10000 }).catch(async error => {
      console.error('Review status:', await first.page.locator('#reviewsCommentContext').textContent());
      console.error('Browser errors:', first.errors);
      throw error;
    });
    assert.match(await first.page.locator('.reviews-comment-meta').textContent(), /Roberto/);
    const second = await openGuest();
    await second.page.waitForFunction(() => document.querySelector('#reviewsCommentCount').textContent === '1');
    assert.match(await second.page.locator('.reviews-comment-text').textContent(), /Ajustar el plano/);
    await second.page.locator('.reviews-comment-open').click();
    assert.equal(await second.page.locator('.reviews-comment.is-selected').count(), 1);
    const anonymousIdToken = await first.page.evaluate(async () => {
      const { getAuth } = await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js');
      return getAuth().currentUser.getIdToken();
    });
    const collectionResponse = await first.page.request.get('https://firestore.googleapis.com/v1/projects/gb-studio-260bc/databases/(default)/documents/reviewShares', { headers: { Authorization: `Bearer ${anonymousIdToken}` } });
    assert.equal(collectionResponse.status(), 403, 'an anonymous guest cannot enumerate reviews');
    await second.page.goto(url);
    await second.page.locator('#authGate').waitFor({ state: 'visible' });
    await first.context.close(); await second.context.close();
    console.log('Live sharing passed: scoped guest view, named drawing/comment, cross-browser sync, and denied share listing.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
