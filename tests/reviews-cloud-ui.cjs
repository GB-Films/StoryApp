const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/__blank') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Blank</title>'); return; }
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
  fs.readFile(file, (error, data) => { if (error) { response.statusCode = 404; response.end(); } else response.end(data); });
});
const fakeCloud = `
  const load = key => JSON.parse(localStorage.getItem('test-cloud-' + key) || '[]');
  const save = (key, value) => localStorage.setItem('test-cloud-' + key, JSON.stringify(value));
  const upsert = (key, value) => save(key, [...load(key).filter(item => item.id !== value.id), value]);
  export async function saveStaffProject(project) { upsert('projects', project); }
  export async function listStaffProjects() { return load('projects'); }
  export async function deleteStaffProject(id) { save('projects', load('projects').filter(item => item.id !== id)); }
  export async function saveStaffFile(file) { upsert('files', file); }
  export async function listStaffFiles() { return load('files'); }
  export async function deleteStaffFile(id) { save('files', load('files').filter(item => item.id !== id)); }
  export async function listSharedReviews() { return []; }
  export async function staffList() { return load('staff'); }
  export async function addStaff(email) { save('staff', [...load('staff'), { email }]); }
  export async function removeStaff(email) { save('staff', load('staff').filter(item => item.email !== email)); }
  export async function publishReview(project, version, records) {
    save('published', [...load('published'), { project: project.title, version: version.title, fileCount: records.length }]);
    return 'A'.repeat(43);
  }
  export async function updateShareMetadata() {}
  export async function upsertSharedFile() {}
  export function watchComments(token, file, callback) { callback([]); return () => {}; }
`;

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext();
    let page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await context.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
    await context.route('**/reviews-cloud.js?v=2', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: fakeCloud }));
    await context.route('https://www.dropbox.com/scl/fi/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>' }));
    const url = `http://127.0.0.1:${server.address().port}`;
    const authorize = async () => {
      await page.waitForTimeout(350);
      await page.evaluate(() => {
        document.body.classList.remove('auth-locked'); document.querySelector('#authGate').hidden = true;
        window.STUDIO_SIGNED_IN = true; window.STUDIO_ROLE = 'admin'; window.STUDIO_USER = { uid: 'test-admin', email: 'info@granbertafilms.com', displayName: 'Admin' };
        window.dispatchEvent(new Event('studio-auth-change'));
      });
    };
    await page.goto(url); await authorize();
    await page.locator('#reviewsNav').click();
    await page.locator('#reviewsCreateProject').click();
    await page.locator('#reviewsEntityTitle').fill('Proyecto sincronizado');
    await page.locator('#reviewsEntityClient').fill('Cliente');
    await page.locator('#reviewsEntityForm button[type=submit]').click();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Montaje · V1' }).click();
    await page.locator('#reviewsLinkBtn').click();
    await page.locator('#reviewsLinkUrl').fill('https://www.dropbox.com/scl/fi/test/foto.jpg?rlkey=test');
    await page.locator('#reviewsLinkKind').selectOption('image');
    await page.locator('#reviewsLinkForm button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#reviewsCount').textContent === '1');
    await page.locator('#reviewsBackVersions').click();
    await page.locator('.reviews-home-card-actions button[aria-label="Compartir Montaje · V1"]').click();
    await page.locator('#reviewsCopyModal').waitFor({ state: 'visible' });
    assert.match(await page.locator('#reviewsCopyInput').inputValue(), /#share=A{43}$/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-cloud-published'))[0].fileCount), 1);
    await page.locator('#reviewsCopyDone').click();
    await page.locator('#reviewsAdminBtn').click();
    await page.locator('#reviewsAdminModal').waitFor({ state: 'visible' });
    await page.locator('#reviewsStaffEmail').fill('equipo@granbertafilms.com');
    await page.locator('#reviewsStaffForm button[type=submit]').click();
    await page.locator('.reviews-staff-row').filter({ hasText: 'equipo@granbertafilms.com' }).waitFor();
    await page.locator('.reviews-staff-row button').click();
    await page.locator('#reviewsConfirmAccept').click();
    await page.waitForFunction(() => document.querySelectorAll('.reviews-staff-row').length === 0);
    await page.locator('#reviewsAdminClose').click();
    await page.close();
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}/__blank`);
    await page.evaluate(async () => { await new Promise(resolve => { const request = indexedDB.deleteDatabase('gb-studio-reviews-v1'); request.onsuccess = resolve; request.onerror = resolve; }); });
    await page.goto(url); await authorize();
    await page.locator('#reviewsNav').click();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Proyecto sincronizado' }).waitFor();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Proyecto sincronizado' }).click();
    await page.locator('#reviewsHomeGrid .reviews-home-card-open').filter({ hasText: 'Montaje · V1' }).click();
    assert.equal(await page.locator('#reviewsCount').textContent(), '1', 'an authorized team member sees a cloud project without local IndexedDB data');
    assert.deepEqual(errors, []);
    console.log('Cloud UI passed: project/file sync, share link, and restore from another local state.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
