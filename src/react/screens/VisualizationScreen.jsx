import { useMemo, useState } from 'react';
import { Box, Eye, EyeOff, Grid3X3, Home, Layers3, RotateCcw, RotateCw, Ruler, Triangle, Rows3, Waves, SlidersHorizontal } from 'lucide-react';
import { useProject } from '../state/ProjectContext.jsx';
import { calculateProject } from '../calculations/estimate-engine.js';
import { roomPoints, unifiedWallSegments, boundsOf } from '../planner/geometry.js';
import { calculatePlanMetrics, polygonArea } from '../../calculations/plan-metrics.js';
import { NumberField, SelectField, Toggle, Panel, Stat } from '../components/ui.jsx';
import { formatNumber } from '../utils/format.js';

const MODES = [
  ['3d', '3D', Box],
  ['plan', 'План', Grid3X3],
  ['roof', 'Кровля', Home]
];

const ROOF_VIEW_LAYERS = [
  ['structure', 'Несущая', Triangle],
  ['counter', 'Контробрешётка', Rows3],
  ['lath', 'Обрешётка', Grid3X3],
  ['cover', 'Кровля', Waves]
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

function HouseModel({ project, calculation, mode, roofHidden, quarter, cutaway, layers }) {
  const plan = project.plan;
  const dims = { w: Number(plan.house?.w) || 8, h: Number(plan.house?.h) || 10 };
  const wallHeight = Number(plan.wallHeight) || 2.5;
  const roof = project.settings?.roof || {};
  const floor = face([[0, 0, 0], [dims.w, 0, 0], [dims.w, dims.h, 0], [0, dims.h, 0]], dims, quarter);
  const exterior = ['north', 'east', 'south', 'west']
    .map((side) => ({ side, poly: face(sideFace(side, dims.w, dims.h, wallHeight), dims, quarter) }))
    .sort((left, right) => avgDepth(left.poly) - avgDepth(right.poly));
  const partitions = unifiedWallSegments(plan).filter((segment) => segment.axis !== 'd');
  const openings = (plan.openings || []).filter((opening) => opening.outer !== false);
  const roomPolys = (plan.rooms || []).filter((room) => room.include !== false);
  const roofOnly = mode === 'roof';

  return (
    <svg className="house-visual-svg engineering-model" viewBox="0 0 780 590" role="img" aria-label="Трёхмерная визуализация дома">
      <defs>
        <pattern id="wallTexture" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
          <rect width="18" height="18" fill="#f8fafb" />
          <line x1="0" y1="0" x2="0" y2="18" stroke="#d7dde2" strokeWidth="3" opacity="0.9" />
        </pattern>
        <linearGradient id="wallGradientSoft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e8edf2" />
        </linearGradient>
        <linearGradient id="roofGradientVisual" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6f63ba" />
          <stop offset="1" stopColor="#3e3a68" />
        </linearGradient>
        <linearGradient id="roofGradientFocus" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7ae8" />
          <stop offset="1" stopColor="#504290" />
        </linearGradient>
        <filter id="modelShadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodOpacity="0.18" />
        </filter>
      </defs>

      <rect x="0" y="0" width="780" height="590" className="visual-backdrop" />
      <ellipse cx="392" cy="515" rx="280" ry="46" className="visual-ground-shadow" />

      <g filter="url(#modelShadow)">
        {layers.foundation ? <FoundationLayer plan={plan} dims={dims} quarter={quarter} /> : null}
        <polygon points={pointsAttr(floor)} className="visual-floor" />
        <FloorGrid dims={dims} quarter={quarter} />
        {mode === '3d' ? roomPolys.map((room, index) => <RoomSurface key={room.id} room={room} index={index} dims={dims} quarter={quarter} />) : null}

        {layers.walls ? exterior.map((item, index) => {
          const near = index >= 2;
          const fade = cutaway && near;
          return (
            <polygon
              key={item.side}
              points={pointsAttr(item.poly)}
              className={`iso-wall-full ${fade ? 'cutaway' : ''} ${index < 2 ? 'rear-wall' : ''} ${roofOnly ? 'roof-context-wall' : ''}`}
            />
          );
        }) : null}

        {layers.partitions && !roofOnly ? partitions.map((segment, index) => (
          <PartitionFace key={index} segment={segment} dims={dims} wallHeight={wallHeight} quarter={quarter} />
        )) : null}

        {layers.openings && !roofOnly ? openings.map((opening) => (
          <OpeningShape key={opening.id} opening={opening} dims={dims} wallHeight={wallHeight} quarter={quarter} />
        )) : null}

        {layers.roof && !roofHidden ? (
          <RoofGeometry dims={dims} wallHeight={wallHeight} roof={roof} quarter={quarter} roofOnly={roofOnly} />
        ) : null}
      </g>

      <text x="24" y="34" className="visual-caption">
        {formatNumber(dims.w)} × {formatNumber(dims.h)} м · стены {formatNumber(wallHeight)} м
      </text>
      <text x="24" y="56" className="visual-subcaption">
        {mode === 'roof' ? 'Интерактивная крыша' : 'Главная 3D-модель'} · {roof.shape === 'flat' ? 'плоская' : 'двускатная'} кровля
      </text>
      <text x="24" y="78" className="visual-subcaption">
        Комнат: {roomPolys.length} · окна/двери: {(plan.openings || []).length} · кровля: {formatNumber(calculation?.roof?.totalArea || calculation?.roof?.geometry?.totalSlopeArea || 0)} м²
      </text>
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
  const padX = 76;
  const padY = 76;
  const svgWidth = 820;
  const svgHeight = 610;
  const scale = Math.min((svgWidth - padX * 2) / Math.max(width, 1), (svgHeight - padY * 2) / Math.max(height, 1));
  const point = (x, y) => ({ x: padX + x * scale, y: padY + y * scale });
  const roomTotal = (plan.rooms || []).reduce((sum, room) => sum + polygonArea(roomPoints(room)), 0);

  const verticalGrid = [];
  const horizontalGrid = [];
  for (let x = 0; x <= Math.ceil(width); x += 1) {
    const p1 = point(x, 0);
    const p2 = point(x, height);
    verticalGrid.push(<line key={`vx-${x}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="plan-grid-line" />);
  }
  for (let y = 0; y <= Math.ceil(height); y += 1) {
    const p1 = point(0, y);
    const p2 = point(width, y);
    horizontalGrid.push(<line key={`hy-${y}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="plan-grid-line" />);
  }

  return (
    <div className="plan-preview-block">
      <svg className="house-visual-svg plan-preview-svg" viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label="Просмотр плана дома">
        <rect x="0" y="0" width={svgWidth} height={svgHeight} className="plan-sheet-bg" />
        {verticalGrid}
        {horizontalGrid}

        {platforms.map((platform) => {
          const p = point(Number(platform.x) || 0, Number(platform.y) || 0);
          return (
            <g key={platform.id}>
              <rect x={p.x} y={p.y} width={(Number(platform.w) || 0) * scale} height={(Number(platform.h) || 0) * scale} className={`plan-platform ${platform.kind === 'porch' ? 'porch' : 'terrace'}`} />
              <text x={p.x + ((Number(platform.w) || 0) * scale) / 2} y={p.y + ((Number(platform.h) || 0) * scale) / 2 - 4} className="plan-platform-label">
                {platform.kind === 'porch' ? 'Крыльцо' : 'Терраса'}
              </text>
              <text x={p.x + ((Number(platform.w) || 0) * scale) / 2} y={p.y + ((Number(platform.h) || 0) * scale) / 2 + 12} className="plan-platform-area">
                {formatNumber((Number(platform.w) || 0) * (Number(platform.h) || 0))} м²
              </text>
            </g>
          );
        })}

        <rect x={padX} y={padY} width={width * scale} height={height * scale} className="plan-house-shell" />
        <rect x={padX + 8} y={padY + 8} width={Math.max(0, width * scale - 16)} height={Math.max(0, height * scale - 16)} className="plan-house-core" />

        {(plan.rooms || []).filter((room) => room.include !== false).map((room, index) => {
          const points = roomPoints(room);
          const mapped = points.map((item) => point(Number(item.x) || 0, Number(item.y) || 0));
          const roomBounds = boundsOf(points);
          const center = point(roomBounds.x + roomBounds.w / 2, roomBounds.y + roomBounds.h / 2);
          return (
            <g key={room.id}>
              <polygon points={pointsAttr(mapped)} className="plan-room" style={{ '--plan-room-fill': ROOM_SWATCHES[index % ROOM_SWATCHES.length] }} />
              <text x={center.x} y={center.y - 10} className="plan-label">{room.name}</text>
              <text x={center.x} y={center.y + 6} className="plan-room-meta">{formatNumber(roomBounds.w)} × {formatNumber(roomBounds.h)} м</text>
              <text x={center.x} y={center.y + 22} className="plan-room-meta">{formatNumber(polygonArea(points))} м²</text>
            </g>
          );
        })}

        {openings.map((opening) => {
          const seg = planOpeningSegments(opening, plan);
          const a = point(seg.x1, seg.y1);
          const b = point(seg.x2, seg.y2);
          return <line key={opening.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={opening.type === 'window' ? 'plan-opening-window' : 'plan-opening-door'} />;
        })}

        <line x1={padX} y1={padY - 28} x2={padX + width * scale} y2={padY - 28} className="plan-dimension-line" />
        <line x1={padX - 28} y1={padY} x2={padX - 28} y2={padY + height * scale} className="plan-dimension-line" />
        <text x={padX + (width * scale) / 2} y={padY - 36} className="plan-dimension-text">Ширина дома {formatNumber(width)} м</text>
        <text x={padX - 38} y={padY + (height * scale) / 2} className="plan-dimension-text vertical">Длина {formatNumber(height)} м</text>
        <text x={svgWidth - 24} y={36} className="plan-sheet-title">Просмотр плана</text>
        <text x={svgWidth - 24} y={58} className="plan-sheet-subtitle">Редактирование отключено · только просмотр</text>
      </svg>

      <div className="visual-facts plan-facts-grid">
        <article><span>Габарит</span><strong>{formatNumber(width)} × {formatNumber(height)} м</strong></article>
        <article><span>Пятно дома</span><strong>{formatNumber(metrics.floorArea)} м²</strong></article>
        <article><span>Комнат всего</span><strong>{(plan.rooms || []).length}</strong></article>
        <article><span>Площадь комнат</span><strong>{formatNumber(roomTotal)} м²</strong></article>
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

function RoofPlanEditor({ project, calculation, setRoof }) {
  const [layer, setLayer] = useState('structure');
  const roof = project.settings?.roof || {};
  const plan = project.plan;
  const structure = calculation.roof.rafterStructure || {};
  const houseW = Math.max(0.1, Number(plan.house?.w) || 8);
  const houseH = Math.max(0.1, Number(plan.house?.h) || 10);
  const gableOverhang = Math.max(0, Number(roof.gableOverhang) || 0);
  const eaveOverhang = Math.max(0, Number(roof.eaveOverhang) || 0);
  const roofW = houseW + gableOverhang * 2;
  const roofH = houseH + eaveOverhang * 2;
  const svgW = 820;
  const svgH = 570;
  const padX = 72;
  const padY = 82;
  const scale = Math.min((svgW - padX * 2) / roofW, (svgH - padY * 2) / roofH);
  const px = (x) => padX + (x + gableOverhang) * scale;
  const py = (y) => padY + (y + eaveOverhang) * scale;
  const roofLeft = px(-gableOverhang);
  const roofTop = py(-eaveOverhang);
  const roofWidth = roofW * scale;
  const roofHeight = roofH * scale;
  const houseLeft = px(0);
  const houseTop = py(0);
  const houseWidth = houseW * scale;
  const houseHeight = houseH * scale;
  const ridgeY = py(houseH / 2);
  const pairCount = Math.max(2, Number(structure.pairCount) || Math.ceil(houseW / Math.max(.3, Number(roof.rafterStep) || .6)) + 1);
  const system = structure.system || roof.rafterSystem || 'hanging';
  const activeStep = Number(structure.step) || Number(roof.rafterStep) || .6;
  const lathStep = Math.max(.1, Number(roof.lathStep) || .35);
  const slopeLength = Math.max(.1, Number(calculation.roof.geometry?.slopeLength) || houseH / 2);
  const horizontalRun = Math.max(.1, roofH / 2);
  const projectedLathStep = Math.max(.05, lathStep * horizontalRun / slopeLength);
  const coverModule = 1.05;

  const rafterXs = Array.from({ length: pairCount }, (_, index) => {
    const ratio = pairCount <= 1 ? 0 : index / (pairCount - 1);
    return px(ratio * houseW);
  });

  const lathYs = [];
  for (let y = -eaveOverhang; y <= houseH / 2 + .001; y += projectedLathStep) lathYs.push(py(y));
  for (let y = houseH + eaveOverhang; y >= houseH / 2 - .001; y -= projectedLathStep) lathYs.push(py(y));

  const coverXs = [];
  for (let x = -gableOverhang; x <= houseW + gableOverhang + .001; x += coverModule) coverXs.push(px(x));

  const gridLines = [];
  for (let x = Math.floor(-gableOverhang); x <= Math.ceil(houseW + gableOverhang); x += 1) {
    gridLines.push(<line key={`rgx-${x}`} x1={px(x)} y1={roofTop} x2={px(x)} y2={roofTop + roofHeight} className="roof-editor-grid-line" />);
  }
  for (let y = Math.floor(-eaveOverhang); y <= Math.ceil(houseH + eaveOverhang); y += 1) {
    gridLines.push(<line key={`rgy-${y}`} x1={roofLeft} y1={py(y)} x2={roofLeft + roofWidth} y2={py(y)} className="roof-editor-grid-line" />);
  }

  const structureLines = rafterXs.map((x, index) => {
    if (system === 'truss') {
      return <g key={`truss-${index}`} className="roof-truss-top"><line x1={x} y1={roofTop} x2={x} y2={roofTop + roofHeight} /><circle cx={x} cy={ridgeY} r="4" /><circle cx={x} cy={houseTop} r="3" /><circle cx={x} cy={houseTop + houseHeight} r="3" /></g>;
    }
    return <g key={`rafter-${index}`} className="roof-rafter-top"><line x1={x} y1={roofTop} x2={x} y2={ridgeY} /><line x1={x} y1={ridgeY} x2={x} y2={roofTop + roofHeight} /></g>;
  });

  const layerDescription = layer === 'structure'
    ? (system === 'truss' ? 'Расстановка стропильных ферм по длине дома' : 'Расстановка пар стропил и линия конька')
    : layer === 'counter'
      ? 'Контробрешётка идёт по стропилам от карниза к коньку'
      : layer === 'lath'
        ? `Обрешётка поперёк стропил · шаг ${Math.round(lathStep * 1000)} мм`
        : 'Финишное покрытие · профлист С-21, направление от карниза к коньку';

  return <div className="roof-editor-shell">
    <div className="roof-editor-layer-tabs">{ROOF_VIEW_LAYERS.map(([id, label, Icon]) => <button key={id} type="button" className={layer === id ? 'active' : ''} onClick={() => setLayer(id)}><Icon /><span>{label}</span></button>)}</div>
    <div className="roof-editor-canvas-card">
      <div className="roof-editor-canvas-head"><div><strong>{ROOF_VIEW_LAYERS.find((item) => item[0] === layer)?.[1]}</strong><span>{layerDescription}</span></div><em>{RAFTER_SYSTEM_LABELS[system] || system}</em></div>
      <svg className="roof-editor-svg" viewBox={`0 0 ${svgW} ${svgH}`} role="img" aria-label="Схема кровли сверху">
        <defs>
          <pattern id="roofCoverPattern" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#6660a7"/><line x1="2" y1="0" x2="2" y2="12" stroke="#8c86c7" strokeWidth="1"/><line x1="7" y1="0" x2="7" y2="12" stroke="#514b8a" strokeWidth="1"/></pattern>
        </defs>
        <rect x="0" y="0" width={svgW} height={svgH} className="roof-editor-bg" />
        <rect x={roofLeft} y={roofTop} width={roofWidth} height={roofHeight} className={`roof-editor-roof-surface layer-${layer}`} />
        {gridLines}
        <rect x={houseLeft} y={houseTop} width={houseWidth} height={houseHeight} className="roof-editor-house-footprint" />
        <line x1={roofLeft} y1={ridgeY} x2={roofLeft + roofWidth} y2={ridgeY} className="roof-editor-ridge" />
        {layer === 'structure' ? structureLines : null}
        {layer === 'counter' ? <g className="roof-counter-layer">{rafterXs.map((x, index) => <line key={index} x1={x} y1={roofTop} x2={x} y2={roofTop + roofHeight} />)}</g> : null}
        {layer === 'lath' ? <g className="roof-lath-layer">{rafterXs.map((x, index) => <line key={`ghost-${index}`} x1={x} y1={roofTop} x2={x} y2={roofTop + roofHeight} className="roof-rafter-ghost" />)}{lathYs.map((y, index) => <line key={`lath-${index}`} x1={roofLeft} y1={y} x2={roofLeft + roofWidth} y2={y} />)}</g> : null}
        {layer === 'cover' ? <g className="roof-cover-layer"><rect x={roofLeft} y={roofTop} width={roofWidth} height={roofHeight} fill="url(#roofCoverPattern)" />{coverXs.map((x, index) => <line key={index} x1={x} y1={roofTop} x2={x} y2={roofTop + roofHeight} />)}</g> : null}
        <line x1={roofLeft} y1={roofTop - 30} x2={roofLeft + roofWidth} y2={roofTop - 30} className="roof-editor-dim-line" />
        <text x={roofLeft + roofWidth / 2} y={roofTop - 40} className="roof-editor-dim-text">длина кровли {formatNumber(calculation.roof.geometry?.roofLength || roofW)} м</text>
        <line x1={roofLeft - 30} y1={roofTop} x2={roofLeft - 30} y2={roofTop + roofHeight} className="roof-editor-dim-line" />
        <text x={roofLeft - 42} y={roofTop + roofHeight / 2} className="roof-editor-dim-text roof-editor-dim-vertical">пролёт {formatNumber(calculation.roof.geometry?.roofSpan || roofH)} м</text>
        <text x={svgW - 28} y={36} className="roof-editor-title">Вид сверху</text>
        <text x={svgW - 28} y={57} className="roof-editor-subtitle">схема без объёмной перспективы</text>
      </svg>
      <div className="roof-editor-legend"><span><i className="legend-house"/>контур дома</span><span><i className="legend-ridge"/>конёк</span><span><i className={`legend-layer legend-${layer}`}/>{ROOF_VIEW_LAYERS.find((item) => item[0] === layer)?.[1]}</span></div>
    </div>

    <Panel title="Конструктив кровли" description="Настройки как в основном калькуляторе, но схема сверху сразу показывает результат.">
      <div className="form-grid four">
        <SelectField label="Режим расчёта" value={roof.structureMode || 'auto'} onChange={(value) => setRoof('structureMode', value)} options={[{ value: 'auto', label: 'Автоматически по плану' }, { value: 'manual', label: 'Ручная настройка' }]} />
        <SelectField label="Стропильная система" value={(roof.structureMode || 'auto') === 'auto' ? system : (roof.rafterSystem || 'hanging')} disabled={(roof.structureMode || 'auto') === 'auto'} onChange={(value) => setRoof('rafterSystem', value)} options={[{ value: 'hanging', label: 'Висячая · без внутренней опоры' }, { value: 'layered', label: 'Наслонная · с опорой' }, { value: 'truss', label: 'Стропильные фермы' }]} />
        <NumberField label="Чистый шаг стропил / ферм" value={(roof.structureMode || 'auto') === 'auto' ? activeStep : roof.rafterStep} suffix="м" min={0.3} max={1.2} step={0.05} disabled={(roof.structureMode || 'auto') === 'auto'} onChange={(value) => setRoof('rafterStep', value)} />
        <SelectField label="Стропильная доска" value={(roof.structureMode || 'auto') === 'auto' ? (structure.section || '50x150') : (roof.rafterSection || '50x150')} disabled={(roof.structureMode || 'auto') === 'auto'} onChange={(value) => setRoof('rafterSection', value)} options={[{ value: '50x150', label: '50×150 мм' }, { value: '50x200', label: '50×200 мм' }]} />
        <SelectField label="Форма кровли" value={roof.shape || 'gable'} onChange={(value) => setRoof('shape', value)} options={[{ value: 'gable', label: 'Двускатная' }, { value: 'flat', label: 'Плоская' }]} />
        <SelectField label="Тип кровли" value={roof.type || 'cold'} onChange={(value) => setRoof('type', value)} options={[{ value: 'cold', label: 'Холодная' }, { value: 'sip', label: 'Тёплая СИП' }, { value: 'combo', label: 'Комбинированная' }]} />
        {roof.shape !== 'flat' ? <NumberField label="Высота конька" value={roof.ridgeHeight} suffix="м" min={0.1} step={0.1} onChange={(value) => setRoof('ridgeHeight', value)} /> : null}
        <NumberField label="Шаг обрешётки" value={roof.lathStep ?? .35} suffix="м" min={.1} max={1.2} step={.05} onChange={(value) => setRoof('lathStep', value)} />
        <NumberField label="Карнизный свес" value={roof.eaveOverhang ?? .5} suffix="м" min={0} max={2} step={.05} onChange={(value) => setRoof('eaveOverhang', value)} />
        <NumberField label="Торцевой свес" value={roof.gableOverhang ?? .3} suffix="м" min={0} max={2} step={.05} onChange={(value) => setRoof('gableOverhang', value)} />
        <NumberField label="Запас профлиста" value={roof.wastePercent ?? 10} suffix="%" min={0} max={50} step={1} onChange={(value) => setRoof('wastePercent', value)} />
        <div className="readout roof-readout-box"><span>Схема несущей части</span><strong>{system === 'truss' ? `${pairCount} ферм` : `${pairCount} пар стропил`} · шаг {formatNumber(activeStep)} м</strong></div>
      </div>
    </Panel>

    <Panel title="Слои кровельного пирога" description="Переключай слой сверху: геометрия дома сохраняется, меняется только показываемая система.">
      <div className="roof-layer-summary-grid">
        <article><span>Несущая система</span><strong>{RAFTER_SYSTEM_LABELS[system] || system}</strong><small>{structure.section || roof.rafterSection || '50×150'} · {pairCount} позиций</small></article>
        <article><span>Контробрешётка</span><strong>по стропилам</strong><small>{structure.legCount || pairCount * 2} направлений по скатам</small></article>
        <article><span>Обрешётка</span><strong>25×100 мм</strong><small>шаг {Math.round(lathStep * 1000)} мм · {calculation.roof.mainLathBoardCount || 0} досок × 6 м</small></article>
        <article><span>Кровельное покрытие</span><strong>Профлист С-21</strong><small>{formatNumber(calculation.roof.geometry?.totalSlopeArea || 0)} м² · запас {roof.wastePercent ?? 10}%</small></article>
      </div>
    </Panel>

    <div className="visual-facts roof-facts-grid">
      <article><span>Площадь скатов</span><strong>{formatNumber(calculation.roof.geometry?.totalSlopeArea)} м²</strong></article>
      <article><span>Стропильные ноги</span><strong>{structure.legCount || 0} шт.</strong></article>
      <article><span>Стропильная доска</span><strong>{calculation.roof.rafterBoardCount || 0} шт. × 6 м</strong></article>
      <article><span>Обрешётка</span><strong>{calculation.roof.mainLathBoardCount || 0} шт. × 6 м</strong></article>
      <article><span>Мауэрлат</span><strong>{formatNumber(calculation.roof.mauerlatLength)} м.п.</strong></article>
      <article><span>Коньковый прогон</span><strong>{formatNumber(calculation.roof.ridgeBeamLength)} м.п.</strong></article>
    </div>
  </div>;
}

function RoofControls({ project, calculation, setRoof }) {
  const roof = project.settings?.roof || {};
  return (
    <div className="roof-control-stack">
      <Panel title="Основные параметры кровли" description="Настройка прямо во вкладке визуализации. Всё изменяется сразу и отражается в модели и расчёте.">
        <div className="form-grid four">
          <SelectField
            label="Форма кровли"
            value={roof.shape || 'gable'}
            onChange={(value) => setRoof('shape', value)}
            options={[
              { value: 'gable', label: 'Двускатная' },
              { value: 'flat', label: 'Плоская' }
            ]}
          />
          <SelectField
            label="Тип"
            value={roof.type || 'cold'}
            onChange={(value) => setRoof('type', value)}
            options={[
              { value: 'cold', label: 'Холодная' },
              { value: 'sip', label: 'Тёплая СИП' },
              { value: 'combo', label: 'Комбинированная' }
            ]}
          />
          {roof.shape !== 'flat' ? (
            <NumberField
              label="Высота конька"
              value={roof.ridgeHeight}
              suffix="м"
              min={0.1}
              step={0.1}
              onChange={(value) => setRoof('ridgeHeight', value)}
            />
          ) : null}
          <NumberField
            label={roof.shape === 'flat' ? 'Длина кровли' : 'Длина конька'}
            value={roof.ridgeLength}
            suffix="м"
            min={0.1}
            step={0.1}
            onChange={(value) => setRoof('ridgeLength', value)}
          />
          <NumberField
            label="Карнизный свес"
            value={roof.eaveOverhang ?? 0.5}
            suffix="м"
            min={0}
            max={2}
            step={0.05}
            onChange={(value) => setRoof('eaveOverhang', value)}
          />
          <NumberField
            label="Торцевой свес"
            value={roof.gableOverhang ?? 0.3}
            suffix="м"
            min={0}
            max={2}
            step={0.05}
            onChange={(value) => setRoof('gableOverhang', value)}
          />
          <NumberField
            label="Шаг стропил"
            value={roof.rafterStep ?? 0.6}
            suffix="м"
            min={0.3}
            max={1.2}
            step={0.05}
            onChange={(value) => setRoof('rafterStep', value)}
          />
          <NumberField
            label="Запас покрытия"
            value={roof.wastePercent ?? 10}
            suffix="%"
            min={0}
            max={50}
            step={1}
            onChange={(value) => setRoof('wastePercent', value)}
          />
          {roof.type === 'combo' ? (
            <NumberField
              label="Тёплая часть"
              value={roof.warmPercent ?? 0}
              suffix="%"
              min={0}
              max={100}
              step={5}
              onChange={(value) => setRoof('warmPercent', value)}
            />
          ) : null}
          <SelectField
            label="Стропильная схема"
            value={roof.rafterSystem || 'hanging'}
            onChange={(value) => setRoof('rafterSystem', value)}
            options={[
              { value: 'hanging', label: 'Висячая' },
              { value: 'naslonnaya', label: 'Наслонная' }
            ]}
          />
          <SelectField
            label="Сечение стропил"
            value={roof.rafterSection || '50x150'}
            onChange={(value) => setRoof('rafterSection', value)}
            options={[
              { value: '50x150', label: '50×150' },
              { value: '50x200', label: '50×200' },
              { value: '100x150', label: '100×150' }
            ]}
          />
          <NumberField
            label="Шаг обрешётки"
            value={roof.lathStep ?? 0.35}
            suffix="м"
            min={0.1}
            max={1}
            step={0.05}
            onChange={(value) => setRoof('lathStep', value)}
          />
          <div className="readout roof-readout-box">
            <span>Габарит кровли со свесами</span>
            <strong>{formatNumber(calculation.roof.geometry?.roofLength)} × {formatNumber(calculation.roof.geometry?.roofSpan)} м</strong>
          </div>
        </div>
      </Panel>

      <Panel title="Комплектация кровли" description="Эти опции включаются прямо здесь, как в калькуляторе, но в одном интерактивном блоке.">
        <div className="roof-toggle-grid">
          <Toggle label="Карнизные планки" checked={roof.includeEaveTrim !== false} onChange={(value) => setRoof('includeEaveTrim', value)} />
          <Toggle label="Ветровые планки" checked={roof.includeVergeTrim !== false} onChange={(value) => setRoof('includeVergeTrim', value)} />
          <Toggle label="Уплотнитель конька" checked={roof.includeRidgeSeal !== false} onChange={(value) => setRoof('includeRidgeSeal', value)} />
          <Toggle label="Водосток" checked={roof.includeGutter === true} onChange={(value) => setRoof('includeGutter', value)} />
        </div>
      </Panel>

      <div className="visual-facts roof-facts-grid">
        <article><span>Основная кровля</span><strong>{formatNumber(calculation.roof.geometry?.totalSlopeArea)} м²</strong></article>
        <article><span>Итого с пристройками</span><strong>{formatNumber(calculation.roof.totalArea)} м²</strong></article>
        <article><span>Стропила</span><strong>{formatNumber(calculation.roof.rafterLength || calculation.roof.raftersLength || 0)} м.п.</strong></article>
        <article><span>Мауэрлат</span><strong>{formatNumber(calculation.roof.mauerlatLength)} м.п.</strong></article>
        <article><span>СИП-панели кровли</span><strong>{calculation.roof.sipCutting?.panels || 0} шт.</strong></article>
        <article><span>Конёк</span><strong>{formatNumber(roof.ridgeLength)} м</strong></article>
      </div>
    </div>
  );
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
  const [roofHidden, setRoofHidden] = useState(false);
  const [quarter, setQuarter] = useState(0);
  const [cutaway, setCutaway] = useState(false);
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
        <span className="eyebrow">Инженерная визуализация · M7.7.2</span>
        <h1>3D-вид, обзорный план и редактор кровли</h1>
        <p>
          Основной упор теперь на главный красивый 3D-блок, отдельный план только для просмотра
          и отдельный редактор кровли сверху по слоям конструкции.
        </p>
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
        ) : mode === 'roof' ? (
          <RoofPlanEditor project={project} calculation={calculation} setRoof={setRoof} />
        ) : (
          <HouseModel
            project={project}
            calculation={calculation}
            mode={mode}
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
              <span>{cutaway ? 'Разрез включён' : 'Разрез'}</span>
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

        <div className="visual-stage-badge">
          <RotateCcw />
          <span>{mode === 'plan' ? 'Только просмотр' : mode === 'roof' ? 'Схема кровли сверху' : 'Связано с основным планом'}</span>
        </div>
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
