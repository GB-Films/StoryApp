/* Shared geometry for the editor, thumbnails and exports. No DOM dependencies. */
(function (root) {
  'use strict';
  const bounded = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };

  function arrange(aspects, options = {}) {
    if (!aspects.length) return [];
    const ratios = aspects.map(value => Number.isFinite(value) && value > 0 ? value : 16 / 9);
    // Work in physical units so horizontal and vertical spacing are identical.
    const pageHeight = 100;
    const pageWidth = pageHeight * bounded(options.aspect, 16 / 9, .1, 10);
    const padding = bounded(options.padding, 6, 6, 12);
    const insetX = pageWidth * padding / 100;
    const insetY = pageHeight * padding / 100;
    const width = pageWidth - 2 * insetX;
    const height = pageHeight - 2 * insetY;
    const count = ratios.length;
    const gap = Math.min((1.6 + bounded(options.gap, 16, 0, 48) / 10) * Math.min(pageWidth, pageHeight) / 100,
      Math.min(width, height) / (4 * Math.ceil(Math.sqrt(count))));
    const captionRatio = options.captions ? .24 : 0;
    const sums = [0];
    ratios.forEach(ratio => sums.push(sums[sums.length - 1] + ratio));
    let best = null;

    function evaluate(rows) {
      const imageHeights = rows.map(([start, end]) =>
        (width - gap * (end - start - 1)) / (sums[end] - sums[start]));
      if (imageHeights.some(value => value <= 0)) return;
      const availableHeight = height - gap * (rows.length - 1);
      if (availableHeight <= 0) return;
      const scale = Math.min(1, availableHeight / imageHeights.reduce((sum, h) => sum + h * (1 + captionRatio), 0));
      const heights = imageHeights.map(h => h * scale);
      // Geometric mean rewards usable size for every image, not one huge frame.
      let score = 0;
      rows.forEach(([start, end], row) => {
        for (let index = start; index < end; index++) score += Math.log(ratios[index] * heights[row] ** 2);
      });
      if (!best || score > best.score) best = { rows, heights, score };
    }

    // Try balanced rows as well as aspect-aware partitions. Sequence never changes.
    const rowCounts = new Set([1, count, Math.ceil(Math.sqrt(count))]);
    for (let index = 1; index <= Math.min(count, 48); index++) {
      rowCounts.add(Math.max(1, Math.round(index * count / Math.min(count, 48))));
    }
    for (const rowCount of rowCounts) {
      const targetHeight = (height - gap * (rowCount - 1)) / (rowCount * (1 + captionRatio));
      if (targetHeight <= 0) continue;
      const balanced = [];
      for (let row = 0; row < rowCount; row++) balanced.push([Math.floor(row * count / rowCount), Math.floor((row + 1) * count / rowCount)]);
      evaluate(balanced);
      const costs = new Array(count + 1).fill(Infinity);
      const previous = new Array(count + 1);
      costs[0] = 0;
      for (let end = 1; end <= count; end++) {
        for (let start = end - 1; start >= 0; start--) {
          const imageWidth = width - gap * (end - start - 1);
          if (imageWidth <= 0) break;
          const rowHeight = imageWidth / (sums[end] - sums[start]);
          const cost = costs[start] + (end - start) * Math.log(rowHeight / targetHeight) ** 2;
          if (cost < costs[end]) { costs[end] = cost; previous[end] = start; }
        }
      }
      const rows = [];
      for (let end = count; end > 0; end = previous[end]) rows.unshift([previous[end], end]);
      evaluate(rows);
    }
    const totalHeight = best.heights.reduce((sum, h) => sum + h * (1 + captionRatio), 0) + gap * (best.rows.length - 1);
    let y = insetY + (height - totalHeight) / 2;
    const result = [];
    const percent = rect => ({ x: rect.x / pageWidth * 100, y: rect.y, width: rect.width / pageWidth * 100, height: rect.height });
    best.rows.forEach(([start, end], row) => {
      const imageHeight = best.heights[row];
      const captionHeight = imageHeight * captionRatio;
      const rowWidth = (sums[end] - sums[start]) * imageHeight + gap * (end - start - 1);
      let x = insetX + (width - rowWidth) / 2;
      for (let index = start; index < end; index++) {
        const w = ratios[index] * imageHeight;
        result.push({
          card: percent({ x, y, width: w, height: imageHeight + captionHeight }),
          image: percent({ x, y, width: w, height: imageHeight }),
          caption: captionRatio ? percent({ x, y: y + imageHeight, width: w, height: captionHeight }) : null
        });
        x += w + gap;
      }
      y += imageHeight + captionHeight + gap;
    });
    return result;
  }
  const api = { arrange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StoryboardLayout = api;
})(globalThis);
