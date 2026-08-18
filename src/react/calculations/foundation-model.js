import { terraceAttachmentSide } from '../../calculations/terrace-model.js';
import { lineEndpoints, unifiedWallSegments } from '../planner/geometry.js';

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

function rowPoints(row) {
  const count = Math.max(2, Math.round(row.count) || 2);
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    return { x: row.x1 + (row.x2 - row.x1) * ratio, y: row.y1 + (row.y2 - row.y1) * ratio, source: row.group || 'house' };
  });
}

function perimeterRows(platform, spacing) {
  const x1 = Number(platform.x) || 0;
  const y1 = Number(platform.y) || 0;
  const x2 = x1 + (Number(platform.w) || 0);
  const y2 = y1 + (Number(platform.h) || 0);
  const count = (length) => Math.max(2, Math.ceil(length / spacing) + 1);
  return [
    { x1, y1, x2, y2: y1, count: count(x2 - x1), group: 'platform' },
    { x1: x2, y1, x2, y2, count: count(y2 - y1), group: 'platform' },
    { x1, y1: y2, x2, y2, count: count(x2 - x1), group: 'platform' },
    { x1, y1, x2: x1, y2, count: count(y2 - y1), group: 'platform' }
  ];
}

function uniquePoints(groups, tolerance = 0.12) {
  const points = [];
  groups.flat().forEach((point) => {
    const existing = points.find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= tolerance);
    if (existing) {
      if (existing.source !== point.source) existing.source = 'shared';
    } else points.push({ ...point });
  });
  return points;
}

function platformBindingLength(platform, house) {
  if (platform.binding?.mode === 'none') return 0;
  const perimeter = 2 * ((Number(platform.w) || 0) + (Number(platform.h) || 0));
  if (platform.binding?.mode !== 'shared') return perimeter;
  const side = terraceAttachmentSide(platform, house);
  const attachment = side === 'left' || side === 'right' ? Number(platform.h) || 0 : Number(platform.w) || 0;
  return Math.max(0, perimeter - attachment);
}

export function bindingLinesFromPileRows(rows = []) {
  return rows.filter((row) => row.group !== 'platform').map((row, index) => ({
    id: `binding-${row.id || index + 1}`,
    name: `Обвязка ${index + 1}`,
    x1: Number(row.x1) || 0,
    y1: Number(row.y1) || 0,
    x2: Number(row.x2) || 0,
    y2: Number(row.y2) || 0,
    group: 'house',
    include: true,
    auto: true
  }));
}

export function generateAutoBindingLines(plan, verticalRows = 4, horizontalRows = 5) {
  const w = Math.max(0.5, Number(plan?.house?.w) || 0.5);
  const h = Math.max(0.5, Number(plan?.house?.h) || 0.5);
  const vCount = Math.max(2, Math.min(24, Math.round(Number(verticalRows) || 4)));
  const hCount = Math.max(2, Math.min(24, Math.round(Number(horizontalRows) || 5)));
  const lines = [];
  for (let index = 0; index < vCount; index += 1) {
    const x = vCount === 1 ? 0 : w * index / (vCount - 1);
    lines.push({ id: `auto-binding-v-${index + 1}`, name: `Авто · вертикаль ${index + 1}`, x1: round(x, 3), y1: 0, x2: round(x, 3), y2: round(h, 3), group: 'house', include: true, auto: true, axis: 'vertical' });
  }
  for (let index = 0; index < hCount; index += 1) {
    const y = hCount === 1 ? 0 : h * index / (hCount - 1);
    lines.push({ id: `auto-binding-h-${index + 1}`, name: `Авто · горизонталь ${index + 1}`, x1: 0, y1: round(y, 3), x2: round(w, 3), y2: round(y, 3), group: 'house', include: true, auto: true, axis: 'horizontal' });
  }
  return lines;
}


export function generatePileGrid(plan, columns = 5, rows = 6) {
  const w = Math.max(0.5, Number(plan?.house?.w) || 0.5);
  const h = Math.max(0.5, Number(plan?.house?.h) || 0.5);
  const xCount = Math.max(2, Math.min(24, Math.round(Number(columns) || 5)));
  const yCount = Math.max(2, Math.min(24, Math.round(Number(rows) || 6)));
  const result = [];
  for (let row = 0; row < yCount; row += 1) {
    const y = yCount === 1 ? 0 : h * row / (yCount - 1);
    result.push({
      id: `grid-row-${row + 1}`,
      name: `Сетка · ряд ${row + 1}`,
      x1: 0, y1: round(y, 3), x2: round(w, 3), y2: round(y, 3),
      count: xCount, group: 'house', auto: true, grid: true
    });
  }
  return result;
}
export function generateAutoPileRows(plan, spacing = 2.5) {
  const safeSpacing = Math.max(0.5, Number(spacing) || 2.5);
  const createRow = (id, name, a, b, group = 'house') => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      id, name, x1: round(a.x, 3), y1: round(a.y, 3), x2: round(b.x, 3), y2: round(b.y, 3),
      count: Math.max(2, Math.ceil(length / safeSpacing) + 1), group, auto: true
    };
  };
  const rows = [
    createRow('auto-top', 'Авто · верх', { x: 0, y: 0 }, { x: plan.house.w, y: 0 }),
    createRow('auto-right', 'Авто · справа', { x: plan.house.w, y: 0 }, { x: plan.house.w, y: plan.house.h }),
    createRow('auto-bottom', 'Авто · низ', { x: 0, y: plan.house.h }, { x: plan.house.w, y: plan.house.h }),
    createRow('auto-left', 'Авто · слева', { x: 0, y: 0 }, { x: 0, y: plan.house.h })
  ];
  unifiedWallSegments(plan).forEach((segment, index) => {
    const [a, b] = lineEndpoints(segment);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const inside = midpoint.x >= 0 && midpoint.x <= plan.house.w && midpoint.y >= 0 && midpoint.y <= plan.house.h;
    const first = { x: Math.max(0, Math.min(plan.house.w, a.x)), y: Math.max(0, Math.min(plan.house.h, a.y)) };
    const second = { x: Math.max(0, Math.min(plan.house.w, b.x)), y: Math.max(0, Math.min(plan.house.h, b.y)) };
    if (inside && Math.hypot(second.x - first.x, second.y - first.y) >= 0.5) rows.push(createRow(`auto-inner-${index + 1}`, `Авто · под стеной ${index + 1}`, first, second));
  });
  (plan.walls || []).forEach((wall, index) => {
    const a = { x: wall.x1, y: wall.y1 }; const b = { x: wall.x2, y: wall.y2 };
    if (Math.hypot(b.x - a.x, b.y - a.y) >= 0.5) rows.push(createRow(`auto-wall-${index + 1}`, `Авто · отдельная стена ${index + 1}`, a, b));
  });
  return rows;
}

export function calculateFoundation(plan, settings = {}) {
  const spacing = Math.max(0.5, Number(settings.spacing) || 2.5);
  const houseRows = (plan.pileRows || []).filter((row) => row.group !== 'platform');
  const housePoints = uniquePoints([houseRows.flatMap(rowPoints).concat((plan.piles || []).map((pile) => ({ ...pile, source: 'house' })))], 0.05);
  const platforms = (plan.platforms || []).filter((platform) => platform.include !== false && platform.foundation?.mode !== 'none');
  const platformPoints = platforms.flatMap((platform) => perimeterRows(platform, spacing).flatMap(rowPoints));
  // Опора террасы/крыльца рядом с домовой опорой считается общей, даже если геометрически точки не совпали идеально.
  // Это убирает бессмысленные дубли свай вдоль примыкания площадки к дому.
  const sharedReuseDistance = Math.max(0.18, Math.min(0.6, Number(settings.sharedPileReuseDistance) || spacing * 0.2));
  const points = housePoints.map((point) => ({ ...point }));
  platformPoints.forEach((point) => {
    const nearbyHouse = points.find((candidate) => (candidate.source === 'house' || candidate.source === 'shared') && Math.hypot(candidate.x - point.x, candidate.y - point.y) <= sharedReuseDistance);
    if (nearbyHouse) { nearbyHouse.source = 'shared'; return; }
    const nearbyPlatform = points.find((candidate) => candidate.source === 'platform' && Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 0.05);
    if (!nearbyPlatform) points.push({ ...point, source: 'platform' });
  });
  const sharedPiles = points.filter((point) => point.source === 'shared').length;
  const housePiles = points.filter((point) => point.source === 'house' || point.source === 'shared').length;
  const platformPiles = points.filter((point) => point.source === 'platform' || point.source === 'shared').length;
  const bindingLines = Array.isArray(plan.bindingLines) ? plan.bindingLines : bindingLinesFromPileRows(houseRows);
  const houseBindingLength = bindingLines.filter((line) => line.include !== false).reduce((sum, line) => sum + Math.hypot(line.x2 - line.x1, line.y2 - line.y1), 0);
  const platformBinding = (plan.platforms || []).filter((platform) => platform.include !== false).reduce((sum, platform) => sum + platformBindingLength(platform, plan.house), 0);
  const bindingLength = houseBindingLength + platformBinding;
  const boardWidth = Math.max(0.01, (Number(settings.bindingBoardWidthMm) || 50) / 1000);
  const boardHeight = Math.max(0.01, (Number(settings.bindingBoardHeightMm) || 150) / 1000);
  const bindingLayers = Math.max(1, Math.round(Number(settings.bindingLayers) || Math.round((Number(settings.boardVolumePerMeter) || 0.0225) / (boardWidth * boardHeight)) || 3));
  const boardStockLength = 6;
  const requiredBoardLength = bindingLength * bindingLayers;
  const boardCount = requiredBoardLength ? Math.ceil(requiredBoardLength / boardStockLength) : 0;
  const purchaseBoardLength = boardCount * boardStockLength;
  return {
    points,
    totalPiles: points.length,
    housePiles,
    platformPiles,
    sharedPiles,
    sharedReuseDistance: round(sharedReuseDistance, 2),
    houseBindingLength: round(houseBindingLength),
    platformBindingLength: round(platformBinding),
    bindingLength: round(bindingLength),
    bindingLayers,
    boardStockLength,
    requiredBoardLength: round(requiredBoardLength, 3),
    boardCount,
    purchaseBoardLength: round(purchaseBoardLength, 3),
    boardWasteLength: round(Math.max(0, purchaseBoardLength - requiredBoardLength), 3),
    boardVolume: round(purchaseBoardLength * boardWidth * boardHeight, 3)
  };
}
