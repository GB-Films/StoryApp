/* Shared geometry for the editor, thumbnails and exports. No DOM dependencies. */
(function (root) {
  'use strict';
  const bounded = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };

  function arrangeGrid(ratios, options) {
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
    const horizontal = ratios.filter(ratio => ratio > 1.15).length;
    const vertical = ratios.filter(ratio => ratio < .85).length;
    const slotAspect = horizontal > vertical ? 16 / 9 : vertical > horizontal ? 9 / 16 : 1;
    const pageAspect = pageWidth / pageHeight;
    const targetGridAspect = pageAspect / slotAspect;
    let columns = 1;
    let bestGrid = null;
    for (let candidate = 1; candidate <= count; candidate++) {
      const candidateRows = Math.ceil(count / candidate);
      const emptySlots = candidate * candidateRows - count;
      const gridAspect = candidate / candidateRows;
      const aspectError = Math.abs(Math.log(gridAspect / targetGridAspect));
      const landscapeTieBreak = pageAspect >= 1 ? -candidate * .0001 : candidate * .0001;
      const score = aspectError + emptySlots * .12 + landscapeTieBreak;
      if (!bestGrid || score < bestGrid.score) bestGrid = { columns: candidate, score };
    }
    columns = bestGrid.columns;
    const rows = Math.ceil(count / columns);
    const cellWidth = Math.min((width - gap * (columns - 1)) / columns, (height - gap * (rows - 1)) * slotAspect / rows);
    const cellHeight = cellWidth / slotAspect;
    const gridWidth = cellWidth * columns + gap * (columns - 1);
    const gridHeight = cellHeight * rows + gap * (rows - 1);
    const startX = insetX + (width - gridWidth) / 2;
    const startY = insetY + (height - gridHeight) / 2;
    const captionRatio = options.captions ? (options.captionRatios?.length ? Math.max(...options.captionRatios) : options.captionRatio ?? .15) : 0;
    const percent = rect => ({ x: rect.x / pageWidth * 100, y: rect.y, width: rect.width / pageWidth * 100, height: rect.height });
    return ratios.map((ratio, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const itemsInRow = Math.min(columns, count - row * columns);
      const rowWidth = cellWidth * itemsInRow + gap * (itemsInRow - 1);
      const rowStartX = insetX + (width - rowWidth) / 2;
      const cardX = rowStartX + column * (cellWidth + gap);
      const cardY = startY + row * (cellHeight + gap);
      const itemCaptionRatio = options.captions ? (options.captionRatios?.[index] ?? options.captionRatio ?? captionRatio) : 0;
      const captionHeight = cellHeight * itemCaptionRatio;
      const imageBoxHeight = cellHeight - captionHeight;
      const imageWidth = Math.min(cellWidth, imageBoxHeight * ratio);
      const imageHeight = imageWidth / ratio;
      const imageX = cardX + (cellWidth - imageWidth) / 2;
      const imageY = cardY + (imageBoxHeight - imageHeight) / 2;
      return {
        card: percent({ x: cardX, y: cardY, width: cellWidth, height: cellHeight }),
        image: percent({ x: imageX, y: imageY, width: imageWidth, height: imageHeight }),
        caption: captionRatio ? percent({ x: cardX, y: cardY + imageBoxHeight, width: cellWidth, height: captionHeight }) : null
      };
    });
  }

  function arrange(aspects, options = {}) {
    if (!aspects.length) return [];
    const ratios = aspects.map(value => Number.isFinite(value) && value > 0 ? value : 16 / 9);
    if (options.engine === 'grid') return arrangeGrid(ratios, options);
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
    const captionRatio = options.captions ? (options.captionRatios?.length ? Math.max(...options.captionRatios) : options.captionRatio ?? .15) : 0;
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
