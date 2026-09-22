const { test } = require('node:test');
const assert = require('node:assert/strict');
const { arrange } = require('../layout.js');

function checkLayout(aspects, options) {
  const rects = arrange(aspects, options);
  const pad = Math.max(6, options.padding || 6);
  const epsilon = 1e-8;
  assert.equal(rects.length, aspects.length);
  rects.forEach(({ card, image, caption }, index) => {
    for (const value of Object.values(card)) assert.ok(Number.isFinite(value));
    assert.ok(card.width > 0 && card.height > 0);
    assert.ok(card.x >= pad - epsilon && card.y >= pad - epsilon);
    assert.ok(card.x + card.width <= 100 - pad + epsilon);
    assert.ok(card.y + card.height <= 100 - pad + epsilon);
    assert.ok(Math.abs(image.width * options.aspect / image.height - aspects[index]) < epsilon, 'original ratio');
    if (options.captions) {
      assert.ok(caption.height > 0);
      assert.ok(Math.abs(caption.y + caption.height - card.y - card.height) < epsilon);
    } else assert.equal(caption, null);
    if (index > 0) {
      const previous = rects[index - 1].card;
      assert.ok(card.y > previous.y + epsilon || (Math.abs(card.y - previous.y) < epsilon && card.x > previous.x), 'reading order');
    }
    for (let other = index + 1; other < rects.length; other++) {
      const b = rects[other].card;
      assert.ok(card.x + card.width < b.x || b.x + b.width < card.x || card.y + card.height < b.y || b.y + b.height < card.y, 'positive gap, including captions');
    }
  });
  return rects;
}

test('mixed orientations keep proportions, sequence and safe margins in every format', () => {
  for (const aspect of [16 / 9, 9 / 16, 1]) {
    for (const captions of [true, false]) {
      for (const gap of [0, 16, 48]) {
        for (const count of [1, 2, 5, 6, 7, 9, 13, 30, 75]) {
          const aspects = Array.from({ length: count }, (_, index) => [9 / 16, 16 / 9, 1, 2.4, .3][index % 5]);
          checkLayout(aspects, { aspect, captions, gap, padding: gap === 48 ? 12 : 0 });
        }
      }
    }
  }
});

test('six square photos balance as three per row on a landscape storyboard', () => {
  const rects = checkLayout(Array(6).fill(1), { aspect: 16 / 9, captions: true });
  const rows = Map.groupBy(rects, rect => rect.card.y);
  assert.deepEqual([...rows.values()].map(row => row.length), [3, 3]);
});

test('layout adapts to the actual assets, and removing a photo reclaims space', () => {
  const options = { aspect: 16 / 9, captions: false };
  const squares = arrange(Array(6).fill(1), options);
  const vertical = arrange(Array(6).fill(9 / 16), options);
  assert.notDeepEqual(squares, vertical);
  const before = arrange(Array(12).fill(1), options)[0].image;
  const after = arrange(Array(2).fill(1), options)[0].image;
  assert.ok(after.width * after.height > before.width * before.height);
});

test('equal grid keeps stable cells and leaves the next slot empty', () => {
  const options = { engine: 'grid', aspect: 16 / 9, captions: true, padding: 6, gap: 16 };
  const three = arrange([16 / 9, 16 / 9, 16 / 9], options);
  const four = arrange([16 / 9, 16 / 9, 16 / 9, 16 / 9], options);
  assert.equal(three.length, 3);
  assert.equal(four.length, 4);
  three.forEach((rect, index) => {
    assert.equal(rect.card.width, four[index].card.width);
    assert.equal(rect.card.height, four[index].card.height);
    assert.equal(rect.card.x, four[index].card.x);
    assert.equal(rect.card.y, four[index].card.y);
  });
  assert.ok(four[3].card.x > four[2].card.x);
  assert.ok(Math.abs(four[3].card.y - four[2].card.y) < 1e-8);
});

test('empty pages, invalid dimensions and dense pages remain usable', () => {
  assert.deepEqual(arrange([]), []);
  assert.equal(arrange([NaN, -1, Infinity, 0]).length, 4);
  checkLayout(Array(200).fill(1), { aspect: 1, captions: true, gap: 48 });
});
