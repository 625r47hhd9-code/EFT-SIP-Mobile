const EPS = 0.035;

export const roundCoord = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

export function roomPoints(room) {
  if (Array.isArray(room?.points) && room.points.length >= 3) return room.points;
  return [
    { x: room.x, y: room.y }, { x: room.x + room.w, y: room.y },
    { x: room.x + room.w, y: room.y + room.h }, { x: room.x, y: room.y + room.h }
  ];
}

export function boundsOf(points = []) {
  const xs = points.map((point) => Number(point.x) || 0);
  const ys = points.map((point) => Number(point.y) || 0);
  return {
    x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys)
  };
}

export function withRoomBounds(room) {
  return { ...room, ...boundsOf(roomPoints(room)) };
}

export function rectanglePoints(a, b) {
  const x1 = Math.min(a.x, b.x); const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y); const y2 = Math.max(a.y, b.y);
  return [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
}

export function dimensionOutsideHouse(line, house, offset = 0.8) {
  const next = { ...line };
  const horizontal = Math.abs(next.x2 - next.x1) >= Math.abs(next.y2 - next.y1);
  if (horizontal) {
    const y = (next.y1 + next.y2) / 2 < house.h / 2 ? -offset : house.h + offset;
    next.y1 = y; next.y2 = y;
  } else {
    const x = (next.x1 + next.x2) / 2 < house.w / 2 ? -offset : house.w + offset;
    next.x1 = x; next.x2 = x;
  }
  return next;
}

export function collectSnapAxes(plan, excludeRoomId) {
  const wall = Number(plan.wallThickness) || 0.174;
  const xs = new Set([0, wall, plan.house.w - wall, plan.house.w]);
  const ys = new Set([0, wall, plan.house.h - wall, plan.house.h]);
  const points = new Map();
  const addPoint = (point) => {
    const next = { x: roundCoord(point.x), y: roundCoord(point.y) };
    xs.add(next.x); ys.add(next.y); points.set(`${next.x}:${next.y}`, next);
  };
  [0, wall, plan.house.w - wall, plan.house.w].forEach((x) => {
    [0, wall, plan.house.h - wall, plan.house.h].forEach((y) => addPoint({ x, y }));
  });
  for (const room of plan.rooms || []) {
    if (room.id === excludeRoomId) continue;
    for (const point of roomPoints(room)) addPoint(point);
  }
  for (const wallLine of plan.walls || []) { addPoint({ x: wallLine.x1, y: wallLine.y1 }); addPoint({ x: wallLine.x2, y: wallLine.y2 }); }
  for (const row of plan.pileRows || []) {
    const count = Math.max(2, Math.round(Number(row.count) || 2));
    for (let index = 0; index < count; index += 1) {
      const ratio = index / (count - 1);
      addPoint({ x: row.x1 + (row.x2 - row.x1) * ratio, y: row.y1 + (row.y2 - row.y1) * ratio });
    }
  }
  for (const binding of plan.bindingLines || []) { addPoint({ x: binding.x1, y: binding.y1 }); addPoint({ x: binding.x2, y: binding.y2 }); }
  for (const dimension of plan.dimensions || []) { addPoint({ x: dimension.x1, y: dimension.y1 }); addPoint({ x: dimension.x2, y: dimension.y2 }); }
  for (const platform of plan.platforms || []) {
    addPoint({ x: platform.x, y: platform.y }); addPoint({ x: platform.x + platform.w, y: platform.y });
    addPoint({ x: platform.x + platform.w, y: platform.y + platform.h }); addPoint({ x: platform.x, y: platform.y + platform.h });
  }
  for (const pile of plan.piles || []) addPoint(pile);
  return { xs: [...xs], ys: [...ys], points: [...points.values()] };
}

export function snapPointDetails(point, axes, options = {}) {
  const hasGridOption = Object.prototype.hasOwnProperty.call(options, 'grid');
  const requestedGrid = Number(options.grid);
  const grid = hasGridOption ? (Number.isFinite(requestedGrid) && requestedGrid > 0 ? requestedGrid : null) : 0.1;
  const tolerance = Number(options.tolerance) || 0.16;
  const pointTolerance = Number(options.pointTolerance) || tolerance * 1.5;
  let closestPoint = null; let closestDistance = pointTolerance;
  for (const candidate of axes.points || []) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= closestDistance) { closestPoint = candidate; closestDistance = distance; }
  }
  if (closestPoint) {
    const snapped = { x: roundCoord(closestPoint.x), y: roundCoord(closestPoint.y) };
    return { point: snapped, snap: { kind: 'node', ...snapped, distance: roundCoord(closestDistance) } };
  }
  const snapValue = (value, candidates) => {
    let best = grid ? Math.round(value / grid) * grid : value;
    let distance = tolerance;
    let matched = false;
    for (const candidate of candidates) {
      const next = Math.abs(candidate - value);
      if (next <= distance) { best = candidate; distance = next; matched = true; }
    }
    return { value: roundCoord(best), matched };
  };
  const x = snapValue(point.x, axes.xs || []);
  const y = snapValue(point.y, axes.ys || []);
  const snapped = { x: x.value, y: y.value };
  return {
    point: snapped,
    snap: x.matched || y.matched ? { kind: x.matched && y.matched ? 'intersection' : 'axis', ...snapped } : null
  };
}

export function snapPoint(point, axes, options = {}) {
  return snapPointDetails(point, axes, options).point;
}

export function pileRowAlignment(row, exactTolerance = 0.015, warningAngle = 7) {
  const dx = Math.abs((Number(row.x2) || 0) - (Number(row.x1) || 0));
  const dy = Math.abs((Number(row.y2) || 0) - (Number(row.y1) || 0));
  const length = Math.hypot(dx, dy);
  if (length <= exactTolerance) return { state: 'aligned', axis: 'point', offset: 0, angle: 0 };
  const horizontal = dx >= dy;
  const offset = horizontal ? dy : dx;
  const angle = Math.atan2(offset, Math.max(dx, dy)) * 180 / Math.PI;
  if (offset <= exactTolerance) return { state: 'aligned', axis: horizontal ? 'horizontal' : 'vertical', offset, angle: 0 };
  if (angle <= warningAngle) return { state: 'warning', axis: horizontal ? 'horizontal' : 'vertical', offset, angle };
  return { state: 'diagonal', axis: 'diagonal', offset, angle };
}

export function shouldClosePolygon(points, point, tolerance = 0.35) {
  if (!Array.isArray(points) || points.length < 3 || !point) return false;
  const first = points[0];
  return Math.hypot((Number(point.x) || 0) - (Number(first.x) || 0), (Number(point.y) || 0) - (Number(first.y) || 0)) <= tolerance;
}

export function movePoints(points, dx, dy, plan, axes) {
  const moved = points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  const movedBounds = boundsOf(moved);
  const snappedOrigin = snapPoint({ x: movedBounds.x, y: movedBounds.y }, axes);
  return moved.map((point) => ({
    x: roundCoord(point.x + snappedOrigin.x - movedBounds.x),
    y: roundCoord(point.y + snappedOrigin.y - movedBounds.y)
  }));
}

const axialSegment = (a, b, source = {}) => {
  if (Math.abs(a.y - b.y) <= EPS) return { axis: 'h', fixed: roundCoord((a.y + b.y) / 2), start: Math.min(a.x, b.x), end: Math.max(a.x, b.x), ...source };
  if (Math.abs(a.x - b.x) <= EPS) return { axis: 'v', fixed: roundCoord((a.x + b.x) / 2), start: Math.min(a.y, b.y), end: Math.max(a.y, b.y), ...source };
  return { axis: 'd', a: { ...a }, b: { ...b }, start: 0, end: Math.hypot(b.x - a.x, b.y - a.y), ...source };
};

export function roomWallSegments(plan) {
  const wall = Number(plan.wallThickness) || 0.174;
  const width = Number(plan.house?.w) || 0;
  const height = Number(plan.house?.h) || 0;
  const segments = [];
  for (const room of plan.rooms || []) {
    const points = roomPoints(room);
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      const segment = axialSegment(point, next, { roomId: room.id });
      const outerFace = segment.axis === 'v'
        ? (segment.fixed >= -EPS && segment.fixed <= wall + EPS) || (segment.fixed >= width - wall - EPS && segment.fixed <= width + EPS)
        : segment.axis === 'h'
          ? (segment.fixed >= -EPS && segment.fixed <= wall + EPS) || (segment.fixed >= height - wall - EPS && segment.fixed <= height + EPS)
          : false;
      if (!outerFace) segments.push(segment);
    });
  }
  return segments;
}

export function unifiedWallSegments(plan) {
  const axial = roomWallSegments(plan).filter((segment) => segment.axis !== 'd');
  const diagonal = roomWallSegments(plan).filter((segment) => segment.axis === 'd');
  const groups = new Map();
  for (const segment of axial) {
    const key = `${segment.axis}:${roundCoord(segment.fixed, 2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(segment);
  }
  const merged = [];
  for (const list of groups.values()) {
    list.sort((left, right) => left.start - right.start);
    for (const segment of list) {
      const last = merged.at(-1);
      if (last && last.axis === segment.axis && Math.abs(last.fixed - segment.fixed) <= EPS && segment.start <= last.end + EPS) last.end = Math.max(last.end, segment.end);
      else merged.push({ ...segment });
    }
  }
  return [...merged, ...diagonal];
}

export function allOpeningSegments(plan) {
  const segments = [
    { axis: 'v', fixed: 0, start: 0, end: plan.house.h, outer: true },
    { axis: 'v', fixed: plan.house.w, start: 0, end: plan.house.h, outer: true },
    { axis: 'h', fixed: 0, start: 0, end: plan.house.w, outer: true },
    { axis: 'h', fixed: plan.house.h, start: 0, end: plan.house.w, outer: true },
    ...unifiedWallSegments(plan).filter((segment) => segment.axis !== 'd').map((segment) => ({ ...segment, outer: false })),
    ...(plan.walls || []).map((wall) => ({ ...axialSegment({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }), outer: false })).filter((segment) => segment.axis !== 'd')
  ];
  return segments;
}

export function nearestSegment(point, segments) {
  let best = null;
  for (const segment of segments) {
    const along = segment.axis === 'v' ? point.y : point.x;
    const across = segment.axis === 'v' ? point.x : point.y;
    const projected = Math.max(segment.start, Math.min(segment.end, along));
    const distance = Math.hypot(across - segment.fixed, along - projected);
    if (!best || distance < best.distance) best = { ...segment, projected, distance };
  }
  return best;
}

export function projectOpeningToWall(opening, point, plan, options = {}) {
  const lockDoorType = options.lockDoorType === true;
  const isDoor = opening?.type === 'door';
  const doorType = opening?.doorType;
  let segments = allOpeningSegments(plan);
  if (isDoor && (doorType === 'garage' || (lockDoorType && doorType === 'entrance'))) {
    segments = segments.filter((segment) => segment.outer);
  } else if (isDoor && lockDoorType && doorType === 'interior') {
    segments = segments.filter((segment) => !segment.outer);
  }
  const segment = nearestSegment(point, segments);
  if (!segment) return { ...opening };
  const halfWidth = Math.min(Math.max(0, Number(opening?.width) || 0) / 2, Math.max(0, segment.end - segment.start) / 2);
  const projected = Math.max(segment.start + halfWidth, Math.min(segment.end - halfWidth, segment.projected));
  const result = {
    ...opening,
    orientation: segment.axis,
    outer: segment.outer,
    x: segment.axis === 'v' ? segment.fixed : projected,
    y: segment.axis === 'v' ? projected : segment.fixed
  };
  if (isDoor) {
    if (doorType === 'garage') result.doorType = 'garage';
    else if (!lockDoorType) result.doorType = segment.outer ? 'entrance' : 'interior';
  }
  return result;
}

const pointOnBoundary = (point, polygon) => polygon.some((a, index) => {
  const b = polygon[(index + 1) % polygon.length];
  const cross = Math.abs((point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y));
  return cross <= EPS && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS;
});

export function pointInPolygon(point, polygon) {
  if (pointOnBoundary(point, polygon)) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function planIssues(plan) {
  const wall = Number(plan.wallThickness) || 0.174;
  const issues = [];
  for (const room of plan.rooms || []) {
    const points = roomPoints(room);
    if (points.some((point) => point.x < wall - EPS || point.x > plan.house.w - wall + EPS || point.y < wall - EPS || point.y > plan.house.h - wall + EPS)) {
      issues.push({ type: 'outside', roomIds: [room.id], message: `${room.name}: выходит за внутренний контур дома` });
    }
  }
  for (let i = 0; i < (plan.rooms || []).length; i += 1) {
    for (let j = i + 1; j < plan.rooms.length; j += 1) {
      const left = plan.rooms[i]; const right = plan.rooms[j];
      const a = roomPoints(left); const b = roomPoints(right);
      if (a.some((point) => pointInPolygon(point, b)) || b.some((point) => pointInPolygon(point, a))) {
        issues.push({ type: 'overlap', roomIds: [left.id, right.id], message: `${left.name} и ${right.name}: помещения пересекаются` });
      }
    }
  }
  const internalEdges = roomWallSegments(plan).filter((edge) => edge.axis !== 'd');
  const gapRooms = new Set();
  for (let i = 0; i < internalEdges.length; i += 1) {
    for (let j = i + 1; j < internalEdges.length; j += 1) {
      const left = internalEdges[i]; const right = internalEdges[j];
      if (left.roomId === right.roomId || left.axis !== right.axis) continue;
      const separation = Math.abs(left.fixed - right.fixed);
      const overlap = Math.min(left.end, right.end) - Math.max(left.start, right.start);
      // Two almost-parallel room faces indicate a drawing gap. A deliberately
      // open zone has no close opposing face and therefore remains valid.
      if (separation > EPS && separation <= 0.35 && overlap > 0.2) {
        gapRooms.add(left.roomId); gapRooms.add(right.roomId);
      }
    }
  }
  for (const roomId of gapRooms) {
    const room = (plan.rooms || []).find((candidate) => candidate.id === roomId);
    issues.push({ type: 'gap', roomIds: [roomId], message: `${room?.name || 'Комната'}: стена не состыкована с соседним помещением` });
  }
  return issues;
}

export function lineEndpoints(segment) {
  if (segment.axis === 'h') return [{ x: segment.start, y: segment.fixed }, { x: segment.end, y: segment.fixed }];
  if (segment.axis === 'v') return [{ x: segment.fixed, y: segment.start }, { x: segment.fixed, y: segment.end }];
  return [segment.a, segment.b];
}


export function snapPlatformToHouse(platform, house, tolerance = 0.35) {
  const next = { ...platform };
  const w = Math.max(0, Number(next.w) || 0);
  const h = Math.max(0, Number(next.h) || 0);
  const houseW = Math.max(0, Number(house?.w) || 0);
  const houseH = Math.max(0, Number(house?.h) || 0);
  const tol = Math.max(0.08, Number(tolerance) || 0.35);
  const candidates = [
    { d: Math.abs((next.x + w) - 0), side: 'left', apply: () => { next.x = -w; } },
    { d: Math.abs(next.x - houseW), side: 'right', apply: () => { next.x = houseW; } },
    { d: Math.abs((next.y + h) - 0), side: 'top', apply: () => { next.y = -h; } },
    { d: Math.abs(next.y - houseH), side: 'bottom', apply: () => { next.y = houseH; } }
  ].sort((a, b) => a.d - b.d);
  const best = candidates[0];
  if (best && best.d <= tol) {
    best.apply();
    next.attachmentSide = best.side;
  }
  next.x = roundCoord(next.x);
  next.y = roundCoord(next.y);
  return next;
}

export function scalePlanToHouse(plan, nextWidth, nextHeight) {
  const oldW = Math.max(0.001, Number(plan?.house?.w) || 0.001);
  const oldH = Math.max(0.001, Number(plan?.house?.h) || 0.001);
  const newW = Math.max(3, Number(nextWidth) || oldW);
  const newH = Math.max(3, Number(nextHeight) || oldH);
  const sx = newW / oldW; const sy = newH / oldH;
  const px = (x) => roundCoord((Number(x) || 0) * sx);
  const py = (y) => roundCoord((Number(y) || 0) * sy);

  (plan.rooms || []).forEach((room) => {
    room.points = roomPoints(room).map((point) => ({ x: px(point.x), y: py(point.y) }));
    Object.assign(room, boundsOf(room.points));
  });
  (plan.walls || []).forEach((item) => { item.x1=px(item.x1); item.x2=px(item.x2); item.y1=py(item.y1); item.y2=py(item.y2); });
  (plan.dimensions || []).forEach((item) => { item.x1=px(item.x1); item.x2=px(item.x2); item.y1=py(item.y1); item.y2=py(item.y2); });
  (plan.pileRows || []).forEach((item) => { item.x1=px(item.x1); item.x2=px(item.x2); item.y1=py(item.y1); item.y2=py(item.y2); });
  (plan.bindingLines || []).forEach((item) => { item.x1=px(item.x1); item.x2=px(item.x2); item.y1=py(item.y1); item.y2=py(item.y2); });
  (plan.piles || []).forEach((item) => { item.x=px(item.x); item.y=py(item.y); });
  (plan.wallGaps || []).forEach((item) => { item.x=px(item.x); item.y=py(item.y); });
  (plan.openings || []).forEach((item) => { item.x=px(item.x); item.y=py(item.y); });
  (plan.platforms || []).forEach((item) => { item.x=px(item.x); item.y=py(item.y); item.w=roundCoord((Number(item.w)||0)*sx); item.h=roundCoord((Number(item.h)||0)*sy); });
  plan.house.w = roundCoord(newW); plan.house.h = roundCoord(newH);
  return plan;
}
