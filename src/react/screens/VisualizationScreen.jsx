import { useMemo, useState } from 'react';
import { Box, Eye, EyeOff, Grid3X3, Layers3, RotateCcw, RotateCw, Triangle, Hammer, MoveUpRight, Check, Settings2 } from 'lucide-react';
import { useProject } from '../state/ProjectContext.jsx';
import { calculateProject } from '../calculations/estimate-engine.js';
import { roomPoints, unifiedWallSegments, boundsOf } from '../planner/geometry.js';
import { calculatePlanMetrics, polygonArea } from '../../calculations/plan-metrics.js';
import { NumberField, SelectField, Toggle, Panel, Stat } from '../components/ui.jsx';
import { formatNumber } from '../utils/format.js';

const MODES = [
  ['3d', '3D', Box],
  ['plan', 'План', Grid3X3],
  ['rafters', 'Стропильная система', Triangle]
];

const RAFTER_SYSTEM_LABELS = {
  hanging: 'Висячая стропильная система',
  layered: 'Наслонная стропильная система',
  truss: 'Стропильные фермы',
  flat: 'Плоская кровля'
};

const ROOM_SWATCHES = ['#f4eefc', '#eef7ff', '#eef8f1', '#fff6e8', '#f7eef6', '#edf2ff'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pointsAttr = (points) => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
const pointKey = (p) => `${Number(p.x || 0).toFixed(3)}:${Number(p.y || 0).toFixed(3)}`;

function rotateXY(x, y, dims, quarter) {
  const dx = x - dims.w / 2;
  const dy = y - dims.h / 2;
  if (quarter === 1) return { x: -dy, y: dx };
  if (quarter === 2) return { x: -dx, y: -dy };
  if (quarter === 3) return { x: dy, y: -dx };
  return { x: dx, y: dy };
}

function projectIso(x, y, z, dims, quarter = 0) {
  const q = rotateXY(x, y, dims, quarter);
  const sx = 29;
  const sy = 16.5;
  const sz = 36;
  return {
    x: 390 + (q.x - q.y) * sx,
    y: 332 + (q.x + q.y) * sy - z * sz,
    depth: q.x + q.y
  };
}

function face(points3d, dims, quarter) {
  return points3d.map(([x, y, z]) => projectIso(x, y, z, dims, quarter));
}

function avgDepth(points) {
  return points.reduce((sum, point) => sum + (point.depth || 0), 0) / Math.max(1, points.length);
}

function sideFace(side, w, h, wallHeight) {
  if (side === 'north') return [[0, 0, 0], [w, 0, 0], [w, 0, wallHeight], [0, 0, wallHeight]];
  if (side === 'south') return [[w, h, 0], [0, h, 0], [0, h, wallHeight], [w, h, wallHeight]];
  if (side === 'west') return [[0, h, 0], [0, 0, 0], [0, 0, wallHeight], [0, h, wallHeight]];
  return [[w, 0, 0], [w, h, 0], [w, h, wallHeight], [w, 0, wallHeight]];
}

function wallPoint(side, along, z, w, h) {
  if (side === 'north') return [along, 0, z];
  if (side === 'south') return [w - along, h, z];
  if (side === 'west') return [0, h - along, z];
  return [w, along, z];
}

function wallLength(side, w, h) {
  return side === 'north' || side === 'south' ? w : h;
}


function ExteriorWall({ side, dims, wallHeight, quarter, faded = false }) {
  const wall = face(sideFace(side, dims.w, dims.h, wallHeight), dims, quarter);
  const length = wallLength(side, dims.w, dims.h);
  const seams = [];
  const panelStep = 1.25;
  for (let at = panelStep; at < length - 0.08; at += panelStep) {
    const bottom = projectIso(...wallPoint(side, at, 0, dims.w, dims.h), dims, quarter);
    const top = projectIso(...wallPoint(side, at, wallHeight, dims.w, dims.h), dims, quarter);
    seams.push(<line key={`${side}-${at}`} x1={bottom.x} y1={bottom.y} x2={top.x} y2={top.y} className="wall-panel-seam" />);
  }
  const startTop = projectIso(...wallPoint(side, 0, wallHeight, dims.w, dims.h), dims, quarter);
  const endTop = projectIso(...wallPoint(side, length, wallHeight, dims.w, dims.h), dims, quarter);
  const startBottom = projectIso(...wallPoint(side, 0, 0, dims.w, dims.h), dims, quarter);
  const endBottom = projectIso(...wallPoint(side, length, 0, dims.w, dims.h), dims, quarter);
  return <g className={faded ? 'visual-cut-wall' : ''}>
    <polygon points={pointsAttr(wall)} className="iso-wall-full" />
    {seams}
    <line x1={startTop.x} y1={startTop.y} x2={endTop.x} y2={endTop.y} className="wall-top-cap" />
    <line x1={startBottom.x} y1={startBottom.y} x2={endBottom.x} y2={endBottom.y} className="wall-bottom-cap" />
  </g>;
}

function FloorGrid({ dims, quarter }) {
  const lines = [];
  const xCount = Math.floor(dims.w) + 1;
  const yCount = Math.floor(dims.h) + 1;
  for (let x = 0; x <= xCount; x += 1) {
    const pointA = projectIso(Math.min(dims.w, x), 0, 0.01, dims, quarter);
    const pointB = projectIso(Math.min(dims.w, x), dims.h, 0.01, dims, quarter);
    lines.push(<line key={`gx-${x}`} x1={pointA.x} y1={pointA.y} x2={pointB.x} y2={pointB.y} className="floor-grid-line" />);
  }
  for (let y = 0; y <= yCount; y += 1) {
    const pointA = projectIso(0, Math.min(dims.h, y), 0.01, dims, quarter);
    const pointB = projectIso(dims.w, Math.min(dims.h, y), 0.01, dims, quarter);
    lines.push(<line key={`gy-${y}`} x1={pointA.x} y1={pointA.y} x2={pointB.x} y2={pointB.y} className="floor-grid-line" />);
  }
  return <g className="floor-grid">{lines}</g>;
}

function OpeningShape({ opening, dims, wallHeight, quarter }) {
  const width = Number(opening.width) || 0.9;
  const openingHeight = Number(opening.height) || (opening.type === 'window' ? 1.35 : 2.05);
  const sillHeight = opening.type === 'window' ? Math.max(0.7, Number(opening.sillHeight) || 0.9) : 0;
  let side = 'south';
  let center = Number(opening.x) || dims.w / 2;

  if (opening.orientation === 'h') {
    side = Number(opening.y) < dims.h / 2 ? 'north' : 'south';
    center = Number(opening.x) || dims.w / 2;
  } else {
    side = Number(opening.x) < dims.w / 2 ? 'west' : 'east';
    center = Number(opening.y) || dims.h / 2;
  }

  const length = wallLength(side, dims.w, dims.h);
  const start = clamp(center - width / 2, 0, length);
  const end = clamp(center + width / 2, 0, length);
  const poly = face([
    wallPoint(side, start, sillHeight, dims.w, dims.h),
    wallPoint(side, end, sillHeight, dims.w, dims.h),
    wallPoint(side, end, Math.min(wallHeight, sillHeight + openingHeight), dims.w, dims.h),
    wallPoint(side, start, Math.min(wallHeight, sillHeight + openingHeight), dims.w, dims.h)
  ], dims, quarter);
  return <polygon points={pointsAttr(poly)} className={opening.type === 'window' ? 'iso-window' : 'iso-door'} />;
}

function PartitionFace({ segment, dims, wallHeight, quarter }) {
  let first;
  let second;
  if (segment.axis === 'h') {
    first = [segment.start, segment.fixed, 0];
    second = [segment.end, segment.fixed, 0];
  } else if (segment.axis === 'v') {
    first = [segment.fixed, segment.start, 0];
    second = [segment.fixed, segment.end, 0];
  } else {
    return null;
  }
  const poly = face([first, second, [second[0], second[1], wallHeight], [first[0], first[1], wallHeight]], dims, quarter);
  return <polygon points={pointsAttr(poly)} className="partition-wall" />;
}

function RoofGeometry({ dims, wallHeight, roof, quarter, roofOnly = false }) {
  const ridge = Number(roof.ridgeHeight) || 1.8;
  if (roof.shape === 'flat') {
    const plane = face([
      [-Number(roof.gableOverhang) || 0, -Number(roof.eaveOverhang) || 0, wallHeight + 0.12],
      [dims.w + (Number(roof.gableOverhang) || 0), -Number(roof.eaveOverhang) || 0, wallHeight + 0.12],
      [dims.w + (Number(roof.gableOverhang) || 0), dims.h + (Number(roof.eaveOverhang) || 0), wallHeight + 0.12],
      [-Number(roof.gableOverhang) || 0, dims.h + (Number(roof.eaveOverhang) || 0), wallHeight + 0.12]
    ], dims, quarter);
    return <polygon points={pointsAttr(plane)} className={roofOnly ? 'roof-plane-focus' : 'iso-roof'} />;
  }

  const eave = Number(roof.eaveOverhang) || 0;
  const gable = Number(roof.gableOverhang) || 0;
  const ridgeLength = clamp(Number(roof.ridgeLength) || dims.w, 0.1, dims.w + gable * 2);
  const ridgeStart = (dims.w - ridgeLength) / 2;
  const ridgeEnd = ridgeStart + ridgeLength;
  const ridgeZ = wallHeight + ridge;

  const northPlane = face([
    [0 - gable, 0 - eave, wallHeight],
    [dims.w + gable, 0 - eave, wallHeight],
    [ridgeEnd, dims.h / 2, ridgeZ],
    [ridgeStart, dims.h / 2, ridgeZ]
  ], dims, quarter);
  const southPlane = face([
    [dims.w + gable, dims.h + eave, wallHeight],
    [0 - gable, dims.h + eave, wallHeight],
    [ridgeStart, dims.h / 2, ridgeZ],
    [ridgeEnd, dims.h / 2, ridgeZ]
  ], dims, quarter);
  const ridgeA = projectIso(ridgeStart, dims.h / 2, ridgeZ, dims, quarter);
  const ridgeB = projectIso(ridgeEnd, dims.h / 2, ridgeZ, dims, quarter);
  const planes = [northPlane, southPlane].sort((left, right) => avgDepth(left) - avgDepth(right));

  return (
    <g>
      {planes.map((plane, index) => (
        <polygon key={index} points={pointsAttr(plane)} className={roofOnly ? 'roof-plane-focus' : 'iso-roof'} />
      ))}
      <line x1={ridgeA.x} y1={ridgeA.y} x2={ridgeB.x} y2={ridgeB.y} className="roof-ridge-line" />
    </g>
  );
}

function FoundationLayer({ plan, dims, quarter }) {
  const piles = [];
  const seen = new Set();
  const add = (x, y) => {
    const key = `${Number(x).toFixed(2)}:${Number(y).toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    piles.push({ x: Number(x), y: Number(y) });
  };
  (plan.pileRows || []).forEach((row) => {
    const count = Math.max(2, Number(row.count) || 2);
    for (let index = 0; index < count; index += 1) {
      const ratio = count === 1 ? 0 : index / (count - 1);
      add(Number(row.x1) + (Number(row.x2) - Number(row.x1)) * ratio, Number(row.y1) + (Number(row.y2) - Number(row.y1)) * ratio);
    }
  });
  (plan.piles || []).forEach((pile) => add(pile.x, pile.y));
  return (
    <g className="visual-foundation">
      {piles.map((pile, index) => {
        const pointA = projectIso(pile.x, pile.y, -0.35, dims, quarter);
        const pointB = projectIso(pile.x, pile.y, 0, dims, quarter);
        return <line key={index} x1={pointA.x} y1={pointA.y} x2={pointB.x} y2={pointB.y} />;
      })}
    </g>
  );
}

function RoomSurface({ room, index, dims, quarter }) {
  const points = roomPoints(room);
  const floorPoly = points.map((point) => projectIso(Number(point.x) || 0, Number(point.y) || 0, 0.025, dims, quarter));
  const roomBounds = boundsOf(points);
  const labelPoint = projectIso(roomBounds.x + roomBounds.w / 2, roomBounds.y + roomBounds.h / 2, 0.03, dims, quarter);
  const area = polygonArea(points);
  return (
    <g>
      <polygon points={pointsAttr(floorPoly)} className="visual-room-surface" style={{ '--room-fill': ROOM_SWATCHES[index % ROOM_SWATCHES.length] }} />
      <text x={labelPoint.x} y={labelPoint.y - 2} className="visual-room-label">{room.name}</text>
      <text x={labelPoint.x} y={labelPoint.y + 13} className="visual-room-area">{formatNumber(area)} м²</text>
    </g>
  );
}

function HouseModel({ project, calculation, roofHidden, quarter, cutaway, layers }) {
  const plan = project.plan;
  const dims = { w: Number(plan.house?.w) || 8, h: Number(plan.house?.h) || 10 };
  const wallHeight = Number(plan.wallHeight) || 2.5;
  const roof = project.settings?.roof || {};
  const floor = face([[0, 0, 0], [dims.w, 0, 0], [dims.w, dims.h, 0], [0, dims.h, 0]], dims, quarter);
  const exterior = ['north', 'east', 'south', 'west']
    .map((side) => ({ side, depth: avgDepth(face(sideFace(side, dims.w, dims.h, wallHeight), dims, quarter)) }))
    .sort((left, right) => left.depth - right.depth);
  const partitions = unifiedWallSegments(plan).filter((segment) => segment.axis !== 'd');
  const openings = (plan.openings || []).filter((opening) => opening.outer !== false);
  const roomPolys = (plan.rooms || []).filter((room) => room.include !== false);

  return (
    <svg className="house-visual-svg engineering-model polished-house-model" viewBox="0 0 780 560" role="img" aria-label="Трёхмерная визуализация дома">
      <defs>
        <pattern id="osbWallTexture" width="34" height="24" patternUnits="userSpaceOnUse">
          <rect width="34" height="24" fill="#efe1c6" />
          <path d="M2 6l9-3m-4 12l12-5m2-7l8 4m-10 10l11-3M1 21l7-5M25 2l6 3" stroke="#c8a879" strokeWidth="1.2" opacity=".42" />
          <path d="M3 10l6 2m9-8l4 2m2 13l7 2" stroke="#fff" strokeWidth="1" opacity=".42" />
        </pattern>
        <pattern id="floorWoodTexture" width="46" height="18" patternUnits="userSpaceOnUse">
          <rect width="46" height="18" fill="#e9dcc5" />
          <path d="M0 1h46M0 17h46M15 1v16M34 1v16" stroke="#c8b89d" strokeWidth=".8" opacity=".55" />
        </pattern>
        <linearGradient id="roofGradientVisual" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6558aa" />
          <stop offset="1" stopColor="#37325f" />
        </linearGradient>
        <filter id="modelShadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="16" stdDeviation="14" floodOpacity="0.16" />
        </filter>
      </defs>

      <rect x="0" y="0" width="780" height="560" className="visual-backdrop" />
      <ellipse cx="392" cy="492" rx="272" ry="38" className="visual-ground-shadow" />

      <g filter="url(#modelShadow)">
        {layers.foundation ? <FoundationLayer plan={plan} dims={dims} quarter={quarter} /> : null}
        <polygon points={pointsAttr(floor)} className="visual-floor polished-floor" />
        <FloorGrid dims={dims} quarter={quarter} />
        {roomPolys.map((room, index) => <RoomSurface key={room.id} room={room} index={index} dims={dims} quarter={quarter} />)}

        {layers.walls ? exterior.map((item, index) => {
          const near = index >= 2;
          return <ExteriorWall key={item.side} side={item.side} dims={dims} wallHeight={wallHeight} quarter={quarter} faded={cutaway && near} />;
        }) : null}

        {layers.partitions ? partitions.map((segment, index) => (
          <PartitionFace key={index} segment={segment} dims={dims} wallHeight={wallHeight} quarter={quarter} />
        )) : null}

        {layers.openings ? openings.map((opening) => (
          <OpeningShape key={opening.id} opening={opening} dims={dims} wallHeight={wallHeight} quarter={quarter} />
        )) : null}

        {layers.roof && !roofHidden ? (
          <RoofGeometry dims={dims} wallHeight={wallHeight} roof={roof} quarter={quarter} />
        ) : null}
      </g>

      <text x="24" y="32" className="visual-caption">{formatNumber(dims.w)} × {formatNumber(dims.h)} м · стены {formatNumber(wallHeight)} м</text>
      <text x="24" y="53" className="visual-subcaption">Главная 3D-модель · {roof.shape === 'flat' ? 'плоская' : 'двускатная'} кровля</text>
      <text x="24" y="73" className="visual-subcaption">Комнат: {roomPolys.length} · окна/двери: {(plan.openings || []).length} · кровля: {formatNumber(calculation?.roof?.totalArea || 0)} м²</text>
    </svg>
  );
}
function planOpeningSegments(opening, plan) {
  const width = Number(opening.width) || 0.9;
  if (opening.orientation === 'h') {
    return {
      x1: (Number(opening.x) || 0) - width / 2,
      x2: (Number(opening.x) || 0) + width / 2,
      y1: Number(opening.y) || 0,
      y2: Number(opening.y) || 0
    };
  }
  return {
    x1: Number(opening.x) || 0,
    x2: Number(opening.x) || 0,
    y1: (Number(opening.y) || 0) - width / 2,
    y2: (Number(opening.y) || 0) + width / 2
  };
}

function PlanPreview({ project, metrics }) {
  const plan = project.plan;
  const width = Number(plan.house?.w) || 8;
  const height = Number(plan.house?.h) || 10;
  const platforms = (plan.platforms || []).filter((item) => item.include !== false);
  const openings = plan.openings || [];
  const svgWidth = 820;
  const svgHeight = 610;
  const dimensionMargin = 0.95;

  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = height;
  platforms.forEach((platform) => {
    minX = Math.min(minX, Number(platform.x) || 0);
    minY = Math.min(minY, Number(platform.y) || 0);
    maxX = Math.max(maxX, (Number(platform.x) || 0) + (Number(platform.w) || 0));
    maxY = Math.max(maxY, (Number(platform.y) || 0) + (Number(platform.h) || 0));
  });
  const worldMinX = minX - dimensionMargin;
  const worldMinY = minY - dimensionMargin;
  const worldMaxX = maxX + dimensionMargin;
  const worldMaxY = maxY + dimensionMargin;
  const worldW = Math.max(1, worldMaxX - worldMinX);
  const worldH = Math.max(1, worldMaxY - worldMinY);
  const pad = 28;
  const scale = Math.min((svgWidth - pad * 2) / worldW, (svgHeight - pad * 2) / worldH);
  const point = (x, y) => ({ x: pad + (x - worldMinX) * scale, y: pad + (y - worldMinY) * scale });
  const houseA = point(0, 0);
  const houseB = point(width, height);
  const roomTotal = (plan.rooms || []).reduce((sum, room) => sum + polygonArea(roomPoints(room)), 0);
  const wallStroke = clamp(scale * (Number(plan.wallThickness) || 0.174), 5, 12);

  const verticalGrid = [];
  const horizontalGrid = [];
  for (let x = Math.ceil(minX); x <= Math.floor(maxX); x += 1) {
    const p1 = point(x, minY);
    const p2 = point(x, maxY);
    verticalGrid.push(<line key={`vx-${x}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="plan-grid-line" />);
  }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y += 1) {
    const p1 = point(minX, y);
    const p2 = point(maxX, y);
    horizontalGrid.push(<line key={`hy-${y}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="plan-grid-line" />);
  }

  const topDimY = point(0, 0).y - 24;
  const leftDimX = point(0, 0).x - 24;

  return (
    <div className="plan-preview-block polished-plan-preview">
      <div className="plan-preview-title"><span><Eye/>Просмотр плана</span><small>Редактирование отключено · только просмотр</small></div>
      <svg className="house-visual-svg plan-preview-svg" viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label="Просмотр плана дома">
        <rect x="0" y="0" width={svgWidth} height={svgHeight} className="plan-sheet-bg" />
        {verticalGrid}{horizontalGrid}

        {platforms.map((platform) => {
          const p = point(Number(platform.x) || 0, Number(platform.y) || 0);
          const w = (Number(platform.w) || 0) * scale;
          const h = (Number(platform.h) || 0) * scale;
          return <g key={platform.id}>
            <rect x={p.x} y={p.y} width={w} height={h} className={`plan-platform ${platform.kind === 'porch' ? 'porch' : 'terrace'}`} />
            <text x={p.x + w / 2} y={p.y + h / 2 - 3} className="plan-platform-label">{platform.kind === 'porch' ? 'Крыльцо' : 'Терраса'}</text>
            <text x={p.x + w / 2} y={p.y + h / 2 + 13} className="plan-platform-area">{formatNumber((Number(platform.w) || 0) * (Number(platform.h) || 0))} м²</text>
          </g>;
        })}

        {(plan.rooms || []).filter((room) => room.include !== false).map((room, index) => {
          const points = roomPoints(room);
          const mapped = points.map((item) => point(Number(item.x) || 0, Number(item.y) || 0));
          const roomBounds = boundsOf(points);
          const center = point(roomBounds.x + roomBounds.w / 2, roomBounds.y + roomBounds.h / 2);
          return <g key={room.id}>
            <polygon points={pointsAttr(mapped)} className="plan-room" style={{ '--plan-room-fill': ROOM_SWATCHES[index % ROOM_SWATCHES.length] }} />
            <text x={center.x} y={center.y - 9} className="plan-label">{room.name}</text>
            <text x={center.x} y={center.y + 7} className="plan-room-meta">{formatNumber(roomBounds.w)} × {formatNumber(roomBounds.h)} м</text>
            <text x={center.x} y={center.y + 23} className="plan-room-meta">{formatNumber(polygonArea(points))} м²</text>
          </g>;
        })}

        <rect x={houseA.x} y={houseA.y} width={houseB.x - houseA.x} height={houseB.y - houseA.y} className="plan-house-shell" style={{ strokeWidth: wallStroke }} />

        {openings.map((opening) => {
          const seg = planOpeningSegments(opening, plan);
          const a = point(seg.x1, seg.y1);
          const b = point(seg.x2, seg.y2);
          return <line key={opening.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={opening.type === 'window' ? 'plan-opening-window' : 'plan-opening-door'} />;
        })}

        <line x1={houseA.x} y1={topDimY} x2={houseB.x} y2={topDimY} className="plan-dimension-line" />
        <line x1={houseA.x} y1={topDimY - 7} x2={houseA.x} y2={topDimY + 7} className="plan-dimension-tick" />
        <line x1={houseB.x} y1={topDimY - 7} x2={houseB.x} y2={topDimY + 7} className="plan-dimension-tick" />
        <text x={(houseA.x + houseB.x) / 2} y={topDimY - 10} className="plan-dimension-text">{formatNumber(width)} м</text>
        <line x1={leftDimX} y1={houseA.y} x2={leftDimX} y2={houseB.y} className="plan-dimension-line" />
        <line x1={leftDimX - 7} y1={houseA.y} x2={leftDimX + 7} y2={houseA.y} className="plan-dimension-tick" />
        <line x1={leftDimX - 7} y1={houseB.y} x2={leftDimX + 7} y2={houseB.y} className="plan-dimension-tick" />
        <text x={leftDimX - 12} y={(houseA.y + houseB.y) / 2} transform={`rotate(-90 ${leftDimX - 12} ${(houseA.y + houseB.y) / 2})`} className="plan-dimension-text">{formatNumber(height)} м</text>
      </svg>

      <div className="visual-facts plan-facts-grid compact-plan-facts">
        <article><span>Габарит</span><strong>{formatNumber(width)} × {formatNumber(height)} м</strong></article>
        <article><span>Пятно дома</span><strong>{formatNumber(metrics.floorArea)} м²</strong></article>
        <article><span>Перегородки</span><strong>{formatNumber(metrics.partitionLength)} м</strong></article>
        <article><span>Террасы/крыльцо</span><strong>{formatNumber(metrics.platformArea)} м²</strong></article>
      </div>
    </div>
  );
}
function PlanReadout({ project, metrics }) {
  const plan = project.plan;
  const rooms = (plan.rooms || []).filter((room) => room.include !== false);
  const platforms = (plan.platforms || []).filter((item) => item.include !== false);
  const openings = plan.openings || [];
  return (
    <>
      <Panel title="Характеристики плана" description="Это обзорный план рядом с 3D, без редактирования. Все размеры и площади берутся из основного редактора.">
        <div className="stats-row plan-stats-row">
          <Stat label="Пятно дома" value={`${formatNumber(metrics.floorArea)} м²`} />
          <Stat label="Полезная площадь" value={`${formatNumber(metrics.roomArea)} м²`} />
          <Stat label="Не занято комнатами" value={`${formatNumber(metrics.unassignedArea)} м²`} tone={metrics.unassignedArea > 0.1 ? 'accent' : ''} />
          <Stat label="Периметр" value={`${formatNumber(metrics.perimeter)} м`} />
          <Stat label="Наружные стены" value={`${formatNumber(metrics.exteriorWallNetArea)} м²`} />
          <Stat label="Окна и двери" value={`${openings.length} шт`} />
        </div>
      </Panel>

      <Panel title="Помещения" description="Состав комнат, их размеры и площади для быстрого просмотра.">
        <div className="plan-room-card-grid">
          {rooms.map((room, index) => {
            const points = roomPoints(room);
            const area = polygonArea(points);
            const roomBounds = boundsOf(points);
            return (
              <article key={room.id} className="plan-room-card">
                <i>{index + 1}</i>
                <div>
                  <strong>{room.name}</strong>
                  <span>{formatNumber(roomBounds.w)} × {formatNumber(roomBounds.h)} м</span>
                </div>
                <em>{formatNumber(area)} м²</em>
              </article>
            );
          })}
        </div>
      </Panel>

      <div className="plan-readout-split">
        <Panel title="Проёмы" description="Окна и двери, которые присутствуют на плане.">
          <div className="plan-listing">
            {openings.length ? openings.map((opening, index) => (
              <div key={opening.id} className="plan-list-row">
                <span>{opening.type === 'window' ? `Окно ${index + 1}` : `Дверь ${index + 1}`}</span>
                <strong>{formatNumber(opening.width || 0.9)} × {formatNumber(opening.height || (opening.type === 'window' ? 1.35 : 2.05))} м</strong>
              </div>
            )) : <div className="inspector-note">На плане пока нет окон и дверей.</div>}
          </div>
        </Panel>

        <Panel title="Террасы и крыльцо" description="Все пристройки показываются здесь отдельно для быстрого контроля.">
          <div className="plan-listing">
            {platforms.length ? platforms.map((platform) => (
              <div key={platform.id} className="plan-list-row">
                <span>{platform.kind === 'porch' ? 'Крыльцо' : 'Терраса'}</span>
                <strong>{formatNumber(platform.w)} × {formatNumber(platform.h)} м</strong>
              </div>
            )) : <div className="inspector-note">Пристроек на плане пока нет.</div>}
          </div>
        </Panel>
      </div>
    </>
  );
}

function RafterMini({ type }) {
  return <svg viewBox="0 0 120 58" className="rafter-mini" aria-hidden="true">
    <line x1="12" y1="47" x2="60" y2="12"/><line x1="60" y1="12" x2="108" y2="47"/>
    {type === 'hanging' ? <line x1="18" y1="45" x2="102" y2="45"/> : null}
    {type === 'layered' ? <><line x1="60" y1="14" x2="60" y2="47"/><line x1="60" y1="40" x2="39" y2="31"/><line x1="60" y1="40" x2="81" y2="31"/></> : null}
    {type === 'truss' ? <><line x1="18" y1="45" x2="102" y2="45"/><line x1="60" y1="13" x2="60" y2="45"/><line x1="18" y1="45" x2="44" y2="31"/><line x1="44" y1="31" x2="60" y2="45"/><line x1="60" y1="45" x2="76" y2="31"/><line x1="76" y1="31" x2="102" y2="45"/></> : null}
  </svg>;
}

function RafterSystemEditor({ project, calculation, setRoof }) {
  const roof = project.settings?.roof || {};
  const plan = project.plan;
  const structure = calculation.roof.rafterStructure || {};
  const automatic = (roof.structureMode || 'auto') === 'auto';
  const system = structure.system || roof.rafterSystem || 'hanging';
  const section = structure.section || roof.rafterSection || '50x150';
  const step = Number(structure.step) || Number(roof.rafterStep) || 0.6;
  const span = Math.max(1, Number(plan.house?.h) || 8);
  const ridgeHeight = Math.max(0.4, Number(roof.ridgeHeight) || 1.8);
  const hasBearingSupport = (plan.rooms || []).some((room) => room.include !== false && room.bearing) || (plan.walls || []).some((wall) => wall.bearing);

  const svgW = 820;
  const svgH = 520;
  const wallTopY = 386;
  const floorY = 456;
  const leftWallX = 142;
  const rightWallX = 678;
  const centerX = (leftWallX + rightWallX) / 2;
  const roofRisePx = clamp(142 + ridgeHeight * 32, 158, 228);
  const ridgeY = wallTopY - roofRisePx;
  const eave = Math.max(0, Number(roof.eaveOverhang) || .5);
  const eavePx = clamp(20 + eave * 20, 24, 52);
  const leftEaveX = leftWallX - eavePx;
  const rightEaveX = rightWallX + eavePx;
  const bottomChordY = wallTopY - 16;
  const collarY = ridgeY + (wallTopY - ridgeY) * .50;
  const rafterLeftMid = { x: (leftEaveX + centerX) / 2, y: (wallTopY + ridgeY) / 2 };
  const rafterRightMid = { x: (rightEaveX + centerX) / 2, y: (wallTopY + ridgeY) / 2 };
  const postBaseY = floorY - 4;
  const braceHubY = bottomChordY + 18;
  const structuralRidgeLength = Number(calculation.roof.structuralRidgeBeamLength ?? calculation.roof.ridgeBeamLength) || 0;

  const setSystem = (value) => {
    setRoof('structureMode', 'manual');
    setRoof('rafterSystem', value);
  };

  const systems = [
    ['hanging', 'Висячая', 'Без внутренних опор'],
    ['layered', 'Наслонная', 'С внутренней опорой'],
    ['truss', 'Ферма', 'Пояса и решётка']
  ];
  const systemTitle = system === 'truss' ? 'Стропильная ферма' : system === 'layered' ? 'Наслонная стропильная пара' : 'Висячая стропильная пара';
  const ridgeLabel = system === 'layered' ? 'Коньковый прогон' : system === 'hanging' ? 'Коньковая доска' : null;

  const nodes = [
    { id: 'left-support', x: leftWallX, y: wallTopY, label: 1 },
    { id: 'right-support', x: rightWallX, y: wallTopY, label: 1 },
    { id: 'ridge', x: centerX, y: ridgeY, label: 2 }
  ];
  if (system === 'hanging') nodes.push({ id: 'tie', x: centerX, y: bottomChordY, label: 3 });
  if (system === 'layered') {
    nodes.push({ id: 'post', x: centerX, y: bottomChordY, label: 3 });
    nodes.push({ id: 'brace-left', x: rafterLeftMid.x, y: rafterLeftMid.y, label: 4 });
    nodes.push({ id: 'brace-right', x: rafterRightMid.x, y: rafterRightMid.y, label: 4 });
  }
  if (system === 'truss') {
    nodes.push({ id: 'bottom', x: centerX, y: bottomChordY, label: 3 });
    nodes.push({ id: 'king', x: centerX, y: (ridgeY + bottomChordY) / 2, label: 4 });
    nodes.push({ id: 'web-left', x: rafterLeftMid.x, y: rafterLeftMid.y, label: 5 });
    nodes.push({ id: 'web-right', x: rafterRightMid.x, y: rafterRightMid.y, label: 5 });
  }

  return <div className="rafter-editor-shell polished-rafter-editor">
    <div className="rafter-auto-row">
      <button type="button" className={automatic ? 'active' : ''} onClick={() => setRoof('structureMode', automatic ? 'manual' : 'auto')}>
        <Settings2/><span><strong>Автоматически по плану</strong><small>{automatic ? `выбрано: ${system === 'layered' ? 'наслонная' : system === 'truss' ? 'ферма' : 'висячая'}` : 'ручной выбор'}</small></span><i className={automatic ? 'on' : ''}/>
      </button>
    </div>

    <div className="rafter-system-choice three-cards">
      {systems.map(([id, label, note]) => <button key={id} type="button" className={system === id ? 'active' : ''} onClick={() => setSystem(id)}>
        <span className="rafter-choice-graphic"><RafterMini type={id}/>{system === id ? <b><Check/></b> : null}</span>
        <strong>{label}</strong><small>{note}</small>
      </button>)}
    </div>

    {system === 'layered' && !hasBearingSupport ? <div className="rafter-tech-warning"><strong>Для наслонной схемы нужна внутренняя несущая опора.</strong><span>На плане такая опора сейчас не отмечена. Добавьте или отметьте несущую стену, чтобы автоматический расчёт использовал эту схему корректно.</span></div> : null}
    {system === 'hanging' && span >= 9 ? <div className="rafter-tech-warning"><strong>Большой пролёт: {formatNumber(span)} м.</strong><span>Простую висячую пару на таком пролёте нельзя принимать только по геометрии. В автоматическом режиме для пролёта от 9 м без внутренней опоры выбирается ферма; окончательное сечение требует расчёта по снеговой и ветровой нагрузке.</span></div> : null}

    <div className="rafter-canvas-card">
      <div className="rafter-canvas-head">
        <div><strong>{systemTitle}</strong><span>Рабочий поперечный разрез · опоры и соединительные узлы</span></div>
        <em>{section.replace('x', '×')} мм · шаг {formatNumber(step)} м</em>
      </div>
      <svg className="rafter-editor-svg" viewBox={`0 0 ${svgW} ${svgH}`} role="img" aria-label="Схема стропильной системы в разрезе">
        <defs>
          <linearGradient id="rafterWood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d5a267"/><stop offset="1" stopColor="#a26b35"/></linearGradient>
          <pattern id="rafterGrid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#edf0f4" strokeWidth="1"/></pattern>
          <pattern id="masonryPattern" width="22" height="12" patternUnits="userSpaceOnUse"><rect width="22" height="12" fill="#eef1f2"/><path d="M0 0h22M0 12h22M0 6h22M11 0v6M5.5 6v6M16.5 6v6" stroke="#c5cbd0" strokeWidth=".7"/></pattern>
        </defs>
        <rect width={svgW} height={svgH} className="rafter-bg"/><rect width={svgW} height={svgH} fill="url(#rafterGrid)"/>

        <rect x={leftWallX - 30} y={wallTopY} width="60" height={floorY - wallTopY} fill="url(#masonryPattern)" className="rafter-wall"/>
        <rect x={rightWallX - 30} y={wallTopY} width="60" height={floorY - wallTopY} fill="url(#masonryPattern)" className="rafter-wall"/>
        <line x1={leftWallX - 54} y1={floorY} x2={rightWallX + 54} y2={floorY} className="rafter-floor-line"/>
        <rect x={leftWallX - 43} y={wallTopY - 11} width="86" height="16" rx="3" className="mauerlat-beam"/>
        <rect x={rightWallX - 43} y={wallTopY - 11} width="86" height="16" rx="3" className="mauerlat-beam"/>

        <line x1={leftEaveX} y1={wallTopY + 3} x2={centerX} y2={ridgeY} className="main-rafter"/>
        <line x1={centerX} y1={ridgeY} x2={rightEaveX} y2={wallTopY + 3} className="main-rafter"/>

        {system !== 'truss' ? <rect x={centerX - 7} y={ridgeY - 12} width="14" height="28" rx="3" className="ridge-beam"/> : null}

        {system === 'hanging' ? <>
          <line x1={leftWallX} y1={bottomChordY} x2={rightWallX} y2={bottomChordY} className="rafter-tie"/>
          <line x1={centerX - 84} y1={collarY} x2={centerX + 84} y2={collarY} className="rafter-collar"/>
        </> : null}

        {system === 'layered' ? <>
          <rect x={centerX - 24} y={postBaseY - 18} width="48" height="18" rx="3" className="bearing-bed"/>
          <rect x={centerX - 30} y={postBaseY} width="60" height={floorY - postBaseY + 2} fill="url(#masonryPattern)" className="inner-bearing-wall"/>
          <line x1={centerX} y1={postBaseY - 18} x2={centerX} y2={ridgeY + 16} className="rafter-post"/>
          <line x1={centerX} y1={braceHubY} x2={rafterLeftMid.x} y2={rafterLeftMid.y} className="rafter-brace"/>
          <line x1={centerX} y1={braceHubY} x2={rafterRightMid.x} y2={rafterRightMid.y} className="rafter-brace"/>
          <line x1={centerX - 108} y1={collarY} x2={centerX + 108} y2={collarY} className="rafter-collar"/>
        </> : null}

        {system === 'truss' ? <>
          <line x1={leftWallX} y1={bottomChordY} x2={rightWallX} y2={bottomChordY} className="truss-bottom-chord"/>
          <line x1={centerX} y1={ridgeY} x2={centerX} y2={bottomChordY} className="truss-web"/>
          <line x1={leftWallX} y1={bottomChordY} x2={rafterRightMid.x} y2={rafterRightMid.y} className="truss-web"/>
          <line x1={rightWallX} y1={bottomChordY} x2={rafterLeftMid.x} y2={rafterLeftMid.y} className="truss-web"/>
          <line x1={centerX} y1={bottomChordY} x2={rafterLeftMid.x} y2={rafterLeftMid.y} className="truss-web secondary"/>
          <line x1={centerX} y1={bottomChordY} x2={rafterRightMid.x} y2={rafterRightMid.y} className="truss-web secondary"/>
        </> : null}

        {nodes.map((node) => <g key={node.id} className="rafter-node"><circle cx={node.x} cy={node.y} r="9"/><text x={node.x} y={node.y + 3}>{node.label}</text></g>)}

        <line x1={leftWallX} y1="486" x2={rightWallX} y2="486" className="rafter-dim-line"/><line x1={leftWallX} y1="478" x2={leftWallX} y2="494" className="rafter-dim-tick"/><line x1={rightWallX} y1="478" x2={rightWallX} y2="494" className="rafter-dim-tick"/><text x={centerX} y="510" className="rafter-dim-text">пролёт {formatNumber(span)} м</text>
        <line x1="742" y1={wallTopY} x2="742" y2={ridgeY} className="rafter-dim-line"/><line x1="734" y1={wallTopY} x2="750" y2={wallTopY} className="rafter-dim-tick"/><line x1="734" y1={ridgeY} x2="750" y2={ridgeY} className="rafter-dim-tick"/><text x="762" y={(wallTopY + ridgeY) / 2} transform={`rotate(-90 762 ${(wallTopY + ridgeY) / 2})`} className="rafter-dim-text">конёк {formatNumber(ridgeHeight)} м</text>

        <g className="rafter-callout"><path d={`M${leftWallX - 8} ${wallTopY - 4} L74 346 L24 346`}/><text x="24" y="337">Мауэрлат 100×150</text></g>
        <g className="rafter-callout"><path d={`M${rafterLeftMid.x} ${rafterLeftMid.y} L158 208 L36 208`}/><text x="32" y="198">Стропильная нога {section.replace('x','×')}</text></g>
        {ridgeLabel ? <g className="rafter-callout"><path d={`M${centerX + 6} ${ridgeY} L566 ${ridgeY - 38} L694 ${ridgeY - 38}`}/><text x="698" y={ridgeY - 42}>{ridgeLabel}</text></g> : null}
        {system === 'hanging' ? <g className="rafter-callout"><path d={`M${centerX - 106} ${bottomChordY} L176 432 L30 432`}/><text x="26" y="423">Затяжка / балка перекрытия</text></g> : null}
        {system === 'layered' ? <>
          <g className="rafter-callout"><path d={`M${centerX} ${braceHubY} L590 354 L716 354`}/><text x="720" y="349">Стойка под прогон</text></g>
          <g className="rafter-callout"><path d={`M${rafterRightMid.x} ${rafterRightMid.y} L628 265 L718 265`}/><text x="722" y="260">Подкос</text></g>
          <g className="rafter-callout"><path d={`M${centerX} ${postBaseY} L586 430 L718 430`}/><text x="722" y="425">Внутренняя несущая опора</text></g>
        </> : null}
        {system === 'truss' ? <>
          <g className="rafter-callout"><path d={`M${centerX + 62} ${bottomChordY} L590 428 L714 428`}/><text x="718" y="423">Нижний пояс</text></g>
          <g className="rafter-callout"><path d={`M${rafterRightMid.x} ${rafterRightMid.y} L625 276 L718 276`}/><text x="722" y="271">Раскосы фермы</text></g>
        </> : null}
      </svg>

      <div className="rafter-node-legend">
        <span><i>1</i>опирание на мауэрлат</span><span><i>2</i>коньковый узел</span>
        {system === 'hanging' ? <span><i>3</i>затяжка</span> : null}
        {system === 'layered' ? <><span><i>3</i>стойка</span><span><i>4</i>подкос</span></> : null}
        {system === 'truss' ? <><span><i>3</i>нижний пояс</span><span><i>4</i>стойка</span><span><i>5</i>раскос</span></> : null}
      </div>
    </div>

    <Panel title="Параметры стропильной системы" description="Настройки связаны с тем же расчётом, который используется в основном калькуляторе.">
      <div className="rafter-param-summary">
        <article><span>Режим расчёта</span><strong>{automatic ? 'Автоматический' : 'Ручной'}</strong></article>
        <article><span>Выбранная система</span><strong>{system === 'layered' ? 'Наслонная' : system === 'truss' ? 'Ферма' : 'Висячая'}</strong></article>
        <article><span>Сечение</span><strong>{section.replace('x','×')} мм</strong></article>
        <article><span>Шаг</span><strong>{Math.round(step * 1000)} мм</strong></article>
        <article><span>Количество</span><strong>{structure.pairCount || 0} {system === 'truss' ? 'ферм' : 'пар'}</strong></article>
        <article><span>{system === 'layered' ? 'Коньковый прогон' : system === 'hanging' ? 'Коньковая доска' : 'Коньковый элемент'}</span><strong>{system === 'truss' ? 'не требуется' : `${formatNumber(structuralRidgeLength)} м.п.`}</strong></article>
      </div>
      <div className="form-grid four rafter-edit-fields">
        <NumberField label="Высота конька" value={roof.ridgeHeight} suffix="м" min={0.4} step={0.1} onChange={(value) => setRoof('ridgeHeight', value)} />
        <NumberField label="Чистый шаг" value={step} suffix="м" min={0.3} max={1.2} step={0.05} disabled={automatic} onChange={(value) => setRoof('rafterStep', value)} />
        <SelectField label="Сечение" value={section} disabled={automatic} onChange={(value) => setRoof('rafterSection', value)} options={[{ value: '50x150', label: '50×150 мм' }, { value: '50x200', label: '50×200 мм' }]} />
        <div className="readout roof-readout-box"><span>Внутренняя опора</span><strong>{hasBearingSupport ? 'задана на плане' : 'не задана'}</strong></div>
      </div>
    </Panel>
  </div>;
}
export default function VisualizationScreen() {
  const { project, commit } = useProject();
  const [mode, setModeState] = useState(() => {
    const saved = sessionStorage.getItem('eft-visual-mode');
    return MODES.some((item) => item[0] === saved) ? saved : '3d';
  });
  const setMode = (nextMode) => {
    sessionStorage.setItem('eft-visual-mode', nextMode);
    setModeState(nextMode);
  };
  const [roofHidden, setRoofHidden] = useState(true);
  const [quarter, setQuarter] = useState(0);
  const [cutaway, setCutaway] = useState(true);
  const [showLayers, setShowLayers] = useState(false);
  const [layers, setLayers] = useState({ walls: true, partitions: true, openings: true, roof: true, foundation: true });

  const calculation = useMemo(() => calculateProject(project), [project]);
  const metrics = useMemo(() => calculatePlanMetrics(project.plan), [project.plan]);

  const toggleLayer = (key) => setLayers((current) => ({ ...current, [key]: !current[key] }));
  const setRoof = (key, value) => commit((next) => {
    next.settings.roof[key] = value;
    return next;
  });

  const plan = project.plan;
  const roomsCount = (plan.rooms || []).filter((room) => room.include !== false).length;
  const platformsCount = (plan.platforms || []).filter((item) => item.include !== false).length;
  const openingsCount = (plan.openings || []).length;

  return (
    <section className="visualization-screen engineering-visualization m771-visualization">
      <div className="mobile-screen-intro visualization-intro">
        <span className="eyebrow">Инженерная визуализация · M7.7.4</span>
        <h1>3D-вид, план и стропильная система</h1><p>Рабочая визуализация проекта.</p>
      </div>

      <nav className="visual-mode-tabs visual-mode-tabs-three" aria-label="Режим визуализации">
        {MODES.map(([id, label, Icon]) => (
          <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <article className="visual-stage engineering-stage enhanced-stage">
        {mode === 'plan' ? (
          <PlanPreview project={project} metrics={metrics} />
        ) : mode === 'rafters' ? (
          <RafterSystemEditor project={project} calculation={calculation} setRoof={setRoof} />
        ) : (
          <HouseModel
            project={project}
            calculation={calculation}
            roofHidden={roofHidden}
            quarter={quarter}
            cutaway={cutaway}
            layers={layers}
          />
        )}

        {mode === '3d' ? (
          <div className="visual-orbit-controls">
            <button type="button" onClick={() => setQuarter((current) => (current + 3) % 4)} title="Повернуть влево">
              <RotateCcw />
            </button>
            <span>{quarter * 90}°</span>
            <button type="button" onClick={() => setQuarter((current) => (current + 1) % 4)} title="Повернуть вправо">
              <RotateCw />
            </button>
          </div>
        ) : null}

        {mode === '3d' ? (
          <div className="visual-stage-actions">
            <button type="button" className={cutaway ? 'active' : ''} onClick={() => setCutaway((current) => !current)}>
              <Eye />
              <span>{cutaway ? 'Открытый вид' : 'Все стены'}</span>
            </button>
            <button type="button" className={showLayers ? 'active' : ''} onClick={() => setShowLayers((current) => !current)}>
              <Layers3 />
              <span>Слои</span>
            </button>
            {mode !== 'roof' ? (
              <button type="button" onClick={() => setRoofHidden((current) => !current)}>
                {roofHidden ? <Eye /> : <EyeOff />}
                <span>{roofHidden ? 'Показать крышу' : 'Снять крышу'}</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {showLayers && mode === '3d' ? (
          <div className="visual-layer-panel">
            <strong>Слои модели</strong>
            {[
              ['walls', 'Наружные стены'],
              ['partitions', 'Перегородки'],
              ['openings', 'Окна и двери'],
              ['roof', 'Кровля'],
              ['foundation', 'Сваи']
            ].map(([key, label]) => (
              <button key={key} type="button" className={layers[key] ? 'on' : ''} onClick={() => toggleLayer(key)}>
                <span>{label}</span>
                <i />
              </button>
            ))}
          </div>
        ) : null}

        {mode === '3d' ? <div className="visual-stage-badge">
          <RotateCcw />
          <span>Связано с основным планом</span>
        </div> : null}
      </article>

      {mode === '3d' ? (
        <>
          <div className="visual-facts overview-facts-grid">
            <article><span>Комнаты</span><strong>{roomsCount}</strong></article>
            <article><span>Кровля</span><strong>{formatNumber(calculation.roof.totalArea)} м²</strong></article>
            <article><span>Окна и двери</span><strong>{openingsCount} шт.</strong></article>
            <article><span>Террасы/крыльцо</span><strong>{platformsCount}</strong></article>
            <article><span>Перегородки</span><strong>{formatNumber(metrics.partitionLength)} м</strong></article>
            <article><span>Периметр</span><strong>{formatNumber(metrics.perimeter)} м</strong></article>
          </div>
          <div className="visual-note engineering-note enhanced-note">
            <strong>Главный блок визуализации</strong>
            <span>
              3D сделан основным: стены, комнаты, проёмы, крыша и сваи показаны на одной модели.
              Можно вращать дом, включать разрез и быстро скрывать слои для контроля конструкции.
            </span>
          </div>
        </>
      ) : null}

      {mode === 'plan' ? <PlanReadout project={project} metrics={metrics} /> : null}
    </section>
  );
}
