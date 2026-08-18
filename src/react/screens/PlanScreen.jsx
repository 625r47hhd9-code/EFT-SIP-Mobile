import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BrickWall, CircleDot, DoorOpen, Download, Fence, HousePlus, Layers3, ListTree,
  MoreHorizontal, MousePointer2, PanelsTopLeft, Pentagon, Plus, Redo2, Ruler, Save, Scissors, Share2, Sparkles,
  SquareDashed, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut, ChevronLeft, ChevronDown, Grid3X3, Box, Hammer, Home, Check, Minus
} from 'lucide-react';
import { calculatePlanMetrics, chooseDimensionSides, polygonArea } from '../../calculations/plan-metrics.js';
import { calculateTerraceRoof, normalizeTerracePlatform } from '../../calculations/terrace-model.js';
import { bindingLinesFromPileRows, calculateFoundation, generateAutoBindingLines, generateAutoPileRows, generatePileGrid } from '../calculations/foundation-model.js';
import { Field, NumberField, ScreenHeader, SelectField, Stat, Toggle } from '../components/ui.jsx';
import { createCompactPlan, createDefaultPlan, createEmptyPlan } from '../state/project-model.js';
import { useProject } from '../state/ProjectContext.jsx';
import { formatNumber, uid } from '../utils/format.js';
import { applyPlanTransfer, downloadPlanTransfer, sharePlanTransfer } from '../storage/plan-transfer.js';
import {
  allOpeningSegments, boundsOf, collectSnapAxes, dimensionOutsideHouse, lineEndpoints, movePoints, nearestSegment,
  pileRowAlignment, planIssues, projectOpeningToWall, rectanglePoints, roomPoints, roundCoord, shouldClosePolygon,
  snapPoint, snapPointDetails, unifiedWallSegments, withRoomBounds, scalePlanToHouse, snapPlatformToHouse
} from '../planner/geometry.js';

const VIEW = { width: 1100, height: 760 };
const MOBILE_RELEASE_LABEL = 'M7.7.4';
const SKETCHES_KEY = 'eft-react-plan-sketches-v47';
const DRAW_TOOLS = new Set(['room', 'wall', 'dimension', 'pileRow', 'bindingLine', 'terrace', 'porch']);
const TOOLS = [
  ['select', 'Выбор', MousePointer2], ['room', 'Прямоугольная комната', SquareDashed], ['polygon', 'Комната свободной формы', Pentagon],
  ['wall', 'Стена', BrickWall], ['gap', 'Разрыв стены', Scissors], ['window', 'Окно', PanelsTopLeft], ['door', 'Дверь / ворота', DoorOpen],
  ['dimension', 'Размер', Ruler], ['pile', 'Отдельная свая', CircleDot], ['pileRow', 'Ряд свай', ListTree], ['bindingLine', 'Обвязка', Layers3],
  ['terrace', 'Терраса', Fence], ['porch', 'Крыльцо', HousePlus], ['delete', 'Удалить', Trash2]
];

const getStoredSketches = () => {
  try { return JSON.parse(localStorage.getItem(SKETCHES_KEY) || '[]'); } catch { return []; }
};

function layoutFor(plan) {
  const sides = chooseDimensionSides(plan);
  const roomBounds = (plan.rooms || []).reduce((result, room) => {
    const bounds = boundsOf(roomPoints(room));
    return { minX: Math.min(result.minX, bounds.x), minY: Math.min(result.minY, bounds.y), maxX: Math.max(result.maxX, bounds.x2), maxY: Math.max(result.maxY, bounds.y2) };
  }, { ...sides.bounds });
  const bounds = roomBounds;
  const margin = 1.5;
  const minX = Math.min(0, bounds.minX) - margin;
  const minY = Math.min(0, bounds.minY) - margin;
  const maxX = Math.max(plan.house.w, bounds.maxX) + margin;
  const maxY = Math.max(plan.house.h, bounds.maxY) + margin;
  const scale = Math.min(980 / (maxX - minX), 660 / (maxY - minY)) * Math.max(0.35, Math.min(20, (plan.zoom || 100) / 100));
  return { scale, ox: VIEW.width / 2 - ((minX + maxX) / 2) * scale, oy: VIEW.height / 2 - ((minY + maxY) / 2) * scale, sides };
}

function previewPlan(source, gesture) {
  if (!gesture || gesture.kind === 'draw') return source;
  const plan = structuredClone(source);
  const end = gesture.end;
  const dx = end.x - gesture.start.x; const dy = end.y - gesture.start.y;
  const axes = collectSnapAxes(plan, gesture.type === 'room' ? gesture.id : null);
  const itemFor = (key) => plan[key].find((item) => item.id === gesture.id);
  if (gesture.kind === 'vertex') {
    const room = itemFor('rooms');
    if (room?.points?.[gesture.index]) {
      room.points[gesture.index] = snapPoint(end, axes);
      Object.assign(room, boundsOf(room.points));
    }
    return plan;
  }
  if (gesture.kind === 'endpoint') {
    const key = gesture.type === 'wall' ? 'walls' : gesture.type === 'dimension' ? 'dimensions' : gesture.type === 'bindingLine' ? 'bindingLines' : 'pileRows';
    const item = itemFor(key); const point = snapPoint(end, axes);
    if (item) { item[`x${gesture.index + 1}`] = point.x; item[`y${gesture.index + 1}`] = point.y; }
    return plan;
  }
  if (gesture.type === 'room') {
    const room = itemFor('rooms');
    room.points = movePoints(roomPoints(room), dx, dy, plan, axes);
    Object.assign(room, boundsOf(room.points));
  } else if (gesture.type === 'platform') {
    const item = itemFor('platforms'); const origin = snapPoint({ x: item.x + dx, y: item.y + dy }, axes);
    item.x = origin.x; item.y = origin.y;
    Object.assign(item, snapPlatformToHouse(item, plan.house));
  } else if (gesture.type === 'opening') {
    const item = itemFor('openings');
    if (item) Object.assign(item, projectOpeningToWall(item, end, plan, { lockDoorType: item.doorType === 'garage' }));
  } else if (gesture.type === 'pile') {
    const item = itemFor('piles'); Object.assign(item, snapPoint(end, axes));
  } else if (gesture.type === 'gap') {
    const item = itemFor('wallGaps'); const segment = nearestSegment(end, allOpeningSegments(plan));
    if (segment) { item.orientation = segment.axis; item.outer = segment.outer; item.x = segment.axis === 'v' ? segment.fixed : segment.projected; item.y = segment.axis === 'v' ? segment.projected : segment.fixed; }
  } else {
    const key = gesture.type === 'wall' ? 'walls' : gesture.type === 'dimension' ? 'dimensions' : gesture.type === 'bindingLine' ? 'bindingLines' : 'pileRows';
    const item = itemFor(key);
    if (item) {
      const first = snapPoint({ x: item.x1 + dx, y: item.y1 + dy }, axes);
      const delta = { x: first.x - item.x1, y: first.y - item.y1 };
      item.x1 = first.x; item.y1 = first.y; item.x2 = roundCoord(item.x2 + delta.x); item.y2 = roundCoord(item.y2 + delta.y);
    }
  }
  return plan;
}

function stairGeometry(platform, p) {
  const steps = Math.max(0, Math.round(platform.steps) || 0);
  if (!steps) return null;
  const visibleSteps = 3;
  const depth = steps * (Number(platform.tread) || 0.3);
  const vertical = platform.stairSide === 'left' || platform.stairSide === 'right';
  const width = Math.min(Number(platform.stairWidth) || 1.2, vertical ? platform.h : platform.w);
  const cx = platform.x + platform.w / 2; const cy = platform.y + platform.h / 2;
  let points;
  if (platform.stairSide === 'top') points = [[cx - width / 2, platform.y], [cx + width / 2, platform.y], [cx + width / 2, platform.y - depth], [cx - width / 2, platform.y - depth]];
  else if (platform.stairSide === 'left') points = [[platform.x, cy - width / 2], [platform.x, cy + width / 2], [platform.x - depth, cy + width / 2], [platform.x - depth, cy - width / 2]];
  else if (platform.stairSide === 'right') points = [[platform.x + platform.w, cy - width / 2], [platform.x + platform.w, cy + width / 2], [platform.x + platform.w + depth, cy + width / 2], [platform.x + platform.w + depth, cy - width / 2]];
  else points = [[cx - width / 2, platform.y + platform.h], [cx + width / 2, platform.y + platform.h], [cx + width / 2, platform.y + platform.h + depth], [cx - width / 2, platform.y + platform.h + depth]];
  const screen = points.map(([x, y]) => p(x, y));
  const dividers = Array.from({ length: visibleSteps - 1 }, (_, index) => {
    const ratio = (index + 1) / visibleSteps;
    if (vertical) {
      const x = screen[0].x + (screen[2].x - screen[0].x) * ratio;
      return { x1: x, y1: screen[0].y, x2: x, y2: screen[1].y };
    }
    const y = screen[0].y + (screen[2].y - screen[0].y) * ratio;
    return { x1: screen[0].x, y1: y, x2: screen[1].x, y2: y };
  });
  const center = { x: (screen[0].x + screen[2].x) / 2, y: (screen[0].y + screen[2].y) / 2 };
  const arrow = vertical
    ? { x1: center.x + (platform.stairSide === 'left' ? 10 : -10), y1: center.y, x2: center.x + (platform.stairSide === 'left' ? -10 : 10), y2: center.y }
    : { x1: center.x, y1: center.y + (platform.stairSide === 'top' ? 10 : -10), x2: center.x, y2: center.y + (platform.stairSide === 'top' ? -10 : 10) };
  return { points: screen.map((point) => `${point.x},${point.y}`).join(' '), dividers, arrow };
}

function TerraceStairs({ platform, p }) {
  const geometry = stairGeometry(platform, p);
  if (!geometry) return null;
  return <g className="stairs"><polygon points={geometry.points} />{geometry.dividers.map((line, index) => <line key={index} {...line} />)}<line className="stair-direction" {...geometry.arrow} markerEnd="url(#planner-arrow)" /></g>;
}

function DoorLeaf({ opening, q, size, plan }) {
  const left = opening.hinge === 'left';
  if (opening.orientation === 'h') {
    const hingeX = q.x + (left ? -size / 2 : size / 2); const closedX = q.x + (left ? size / 2 : -size / 2);
    const inward = opening.outer ? (opening.y < plan.house.h / 2 ? 1 : -1) : 1;
    const direction = opening.swing === 'out' ? -inward : inward; const leafY = q.y + direction * size;
    return <g className="door-swing"><line x1={hingeX} y1={q.y} x2={hingeX} y2={leafY} /><path d={`M ${closedX} ${q.y} A ${size} ${size} 0 0 ${left === (direction > 0) ? 1 : 0} ${hingeX} ${leafY}`} /></g>;
  }
  const hingeY = q.y + (left ? -size / 2 : size / 2); const closedY = q.y + (left ? size / 2 : -size / 2);
  const inward = opening.outer ? (opening.x < plan.house.w / 2 ? 1 : -1) : 1;
  const direction = opening.swing === 'out' ? -inward : inward; const leafX = q.x + direction * size;
  return <g className="door-swing"><line x1={q.x} y1={hingeY} x2={leafX} y2={hingeY} /><path d={`M ${q.x} ${closedY} A ${size} ${size} 0 0 ${left === (direction < 0) ? 1 : 0} ${leafX} ${hingeY}`} /></g>;
}

function GarageGate({ opening, q, size, plan }) {
  const offsets = [-0.25, 0, 0.25];
  const half = size / 2;
  if (opening.orientation === 'v') {
    const inward = opening.outer ? (opening.x < plan.house.w / 2 ? 1 : -1) : 1;
    const direction = opening.swing === 'out' ? -inward : inward;
    const leafX = q.x + direction * half;
    return <g className="garage-gate" aria-label="Двустворчатое открывание гаражных ворот">
      {offsets.map((offset) => <line className="gate-mark" key={offset} x1={q.x - 6} y1={q.y + size * offset} x2={q.x + 6} y2={q.y + size * offset} />)}
      <g className="door-swing garage-door-swing"><line x1={q.x} y1={q.y - half} x2={leafX} y2={q.y - half} /><line x1={q.x} y1={q.y + half} x2={leafX} y2={q.y + half} /><path d={`M ${q.x} ${q.y} A ${half} ${half} 0 0 ${direction > 0 ? 0 : 1} ${leafX} ${q.y - half}`} /><path d={`M ${q.x} ${q.y} A ${half} ${half} 0 0 ${direction > 0 ? 1 : 0} ${leafX} ${q.y + half}`} /></g>
    </g>;
  }
  const inward = opening.outer ? (opening.y < plan.house.h / 2 ? 1 : -1) : 1;
  const direction = opening.swing === 'out' ? -inward : inward;
  const leafY = q.y + direction * half;
  return <g className="garage-gate" aria-label="Двустворчатое открывание гаражных ворот">
    {offsets.map((offset) => <line className="gate-mark" key={offset} x1={q.x + size * offset} y1={q.y - 6} x2={q.x + size * offset} y2={q.y + 6} />)}
    <g className="door-swing garage-door-swing"><line x1={q.x - half} y1={q.y} x2={q.x - half} y2={leafY} /><line x1={q.x + half} y1={q.y} x2={q.x + half} y2={leafY} /><path d={`M ${q.x} ${q.y} A ${half} ${half} 0 0 ${direction > 0 ? 1 : 0} ${q.x - half} ${leafY}`} /><path d={`M ${q.x} ${q.y} A ${half} ${half} 0 0 ${direction > 0 ? 0 : 1} ${q.x + half} ${leafY}`} /></g>
  </g>;
}

function DraftRoomDimensions({ start, end, p }) {
  const bounds = boundsOf(rectanglePoints(start, end));
  if (bounds.w < 0.01 && bounds.h < 0.01) return null;
  const topLeft = p(bounds.x, bounds.y);
  const bottomRight = p(bounds.x2, bounds.y2);
  const dimensionY = Math.min(topLeft.y, bottomRight.y) - 22;
  const dimensionX = Math.min(topLeft.x, bottomRight.x) - 22;
  const widthLabel = `${Math.round(bounds.w * 1000).toLocaleString('ru-RU')} мм`;
  const heightLabel = `${Math.round(bounds.h * 1000).toLocaleString('ru-RU')} мм`;
  const summary = `${formatNumber(bounds.w)} × ${formatNumber(bounds.h)} м · ${formatNumber(bounds.w * bounds.h)} м²`;
  return <g className="draft-room-dimensions">
    <line x1={topLeft.x} y1={dimensionY} x2={bottomRight.x} y2={dimensionY} markerStart="url(#planner-arrow)" markerEnd="url(#planner-arrow)" />
    <line className="draft-extension" x1={topLeft.x} y1={topLeft.y} x2={topLeft.x} y2={dimensionY} />
    <line className="draft-extension" x1={bottomRight.x} y1={topLeft.y} x2={bottomRight.x} y2={dimensionY} />
    <text x={(topLeft.x + bottomRight.x) / 2} y={dimensionY - 7}>{widthLabel}</text>
    <line x1={dimensionX} y1={topLeft.y} x2={dimensionX} y2={bottomRight.y} markerStart="url(#planner-arrow)" markerEnd="url(#planner-arrow)" />
    <line className="draft-extension" x1={topLeft.x} y1={topLeft.y} x2={dimensionX} y2={topLeft.y} />
    <line className="draft-extension" x1={topLeft.x} y1={bottomRight.y} x2={dimensionX} y2={bottomRight.y} />
    <text transform={`translate(${dimensionX - 8} ${(topLeft.y + bottomRight.y) / 2}) rotate(-90)`}>{heightLabel}</text>
    {bounds.w >= 0.35 && bounds.h >= 0.35 ? <text className="draft-room-summary" x={(topLeft.x + bottomRight.x) / 2} y={(topLeft.y + bottomRight.y) / 2}>{summary}</text> : null}
  </g>;
}

function DraftPolygonEdge({ points, hoverPoint, p }) {
  if (!points.length || !hoverPoint) return null;
  const start = points.at(-1);
  const closing = shouldClosePolygon(points, hoverPoint);
  const target = closing ? points[0] : hoverPoint;
  const a = p(start.x, start.y); const b = p(target.x, target.y);
  const length = Math.hypot(target.x - start.x, target.y - start.y);
  if (length < 0.01) return null;
  const alignment = pileRowAlignment({ x1: start.x, y1: start.y, x2: target.x, y2: target.y });
  return <g className={`polygon-hover-edge guide-${alignment.state === 'aligned' ? 'aligned' : 'off-axis'} ${closing ? 'closing' : ''}`}>
    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8}>{Math.round(length * 1000).toLocaleString('ru-RU')} мм</text>
    {closing ? <><circle className="polygon-close-target" cx={b.x} cy={b.y} r="12" /><text className="polygon-close-label" x={b.x} y={b.y - 17}>Замкнуть</text></> : null}
  </g>;
}

function PlanCanvas({ plan, tool, selected, setSelected, commitPlan, polygonDraft, setPolygonDraft, finishPolygon, issues, viewportZoom, onViewportZoom, viewportPan = { x: 0, y: 0 }, onViewportPan, onCreated, onSelected }) {
  const svgRef = useRef(null);
  const gestureRef = useRef(null);
  const activePointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const pinchConsumedRef = useRef(false);
  const pendingTouchSelectionRef = useRef(null);
  const panGestureRef = useRef(null);
  const [gesture, setGestureState] = useState(null);
  const [hoverSnap, setHoverSnap] = useState(null);
  const [dimensionStart, setDimensionStart] = useState(null);
  const [dimensionHover, setDimensionHover] = useState(null);
  const setGesture = (value) => { gestureRef.current = typeof value === 'function' ? value(gestureRef.current) : value; setGestureState(gestureRef.current); };
  const shownPlan = useMemo(() => previewPlan(plan, gesture), [plan, gesture]);
  const selectCreated = useCallback((selection) => { if (onCreated) onCreated(selection); else setSelected(selection); }, [onCreated, setSelected]);
  const selectExisting = useCallback((selection) => { if (onSelected) onSelected(selection); else setSelected(selection); }, [onSelected, setSelected]);
  // The viewport must stay fixed during a drag; otherwise an outside terrace
  // changes the fitted bounds and the object jumps away from the pointer.
  const layoutPlan = useMemo(() => ({ ...plan, zoom: viewportZoom ?? plan.zoom }), [plan, viewportZoom]);
  const layout = useMemo(() => { const base = layoutFor(layoutPlan); return { ...base, ox: base.ox + (viewportPan?.x || 0), oy: base.oy + (viewportPan?.y || 0) }; }, [layoutPlan, viewportPan]);
  const foundation = useMemo(() => calculateFoundation(shownPlan, { spacing: 2.5, boardVolumePerMeter: 0.0225 }), [shownPlan]);
  const unifiedWalls = useMemo(() => unifiedWallSegments(shownPlan), [shownPlan]);
  const issueRooms = useMemo(() => new Set(issues.flatMap((issue) => issue.roomIds || [])), [issues]);
  const p = useCallback((x, y) => ({ x: layout.ox + x * layout.scale, y: layout.oy + y * layout.scale }), [layout]);
  const interiorBiasedPoint = useCallback((point, mode = tool) => {
    if (!['room', 'polygon'].includes(mode)) return point;
    const wall = Number(plan.wallThickness) || 0.174;
    const tol = Math.max(0.18, wall * 1.6);
    let { x, y } = point;
    if (x >= -tol && x <= wall + tol) x = wall;
    else if (x >= plan.house.w - wall - tol && x <= plan.house.w + tol) x = plan.house.w - wall;
    if (y >= -tol && y <= wall + tol) y = wall;
    else if (y >= plan.house.h - wall - tol && y <= plan.house.h + tol) y = plan.house.h - wall;
    return { x: roundCoord(x), y: roundCoord(y) };
  }, [plan, tool]);
  const rawPlanPoint = (event) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM?.();
    if (svg?.createSVGPoint && matrix) {
      const screenPoint = svg.createSVGPoint();
      screenPoint.x = event.clientX; screenPoint.y = event.clientY;
      const local = screenPoint.matrixTransform(matrix.inverse());
      return { x: (local.x - layout.ox) / layout.scale, y: (local.y - layout.oy) / layout.scale };
    }
    const rect = svg?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return { x: 0, y: 0 };
    return { x: ((event.clientX - rect.left) / rect.width * VIEW.width - layout.ox) / layout.scale, y: ((event.clientY - rect.top) / rect.height * VIEW.height - layout.oy) / layout.scale };
  };
  const resolvePlanPoint = (event) => {
    const raw = rawPlanPoint(event);
    const current = gestureRef.current;
    const axes = collectSnapAxes(plan, current?.type === 'room' ? current.id : null);
    if (tool === 'polygon' && polygonDraft.length) {
      polygonDraft.forEach((point) => { axes.xs.push(point.x); axes.ys.push(point.y); axes.points.push(point); });
    }
    if (current?.kind === 'draw' && current.start) {
      axes.xs.push(current.start.x); axes.ys.push(current.start.y);
    }
    if (current?.kind === 'endpoint') {
      const key = current.type === 'wall' ? 'walls' : current.type === 'dimension' ? 'dimensions' : current.type === 'bindingLine' ? 'bindingLines' : 'pileRows';
      const item = (plan[key] || []).find((candidate) => candidate.id === current.id);
      const other = current.index === 0 ? { x: item?.x2, y: item?.y2 } : { x: item?.x1, y: item?.y1 };
      if (Number.isFinite(other.x) && Number.isFinite(other.y)) {
        axes.xs.push(other.x); axes.ys.push(other.y); axes.points.push(other);
      }
    }
    const axisTolerance = Math.max(0.03, Math.min(0.18, 10 / layout.scale));
    const nodeTolerance = Math.max(0.05, Math.min(0.24, 16 / layout.scale));
    return snapPointDetails(raw, axes, { tolerance: axisTolerance, pointTolerance: nodeTolerance });
  };
  const toPlan = (event) => resolvePlanPoint(event).point;
  const magneticPoint = (event, mode = tool) => {
    const raw = rawPlanPoint(event);
    const current = gestureRef.current;
    const baseRaw = interiorBiasedPoint(raw, mode);
    const axes = collectSnapAxes(plan, current?.type === 'room' ? current.id : null);
    if (current?.kind === 'draw' && current.start) {
      axes.xs.push(current.start.x); axes.ys.push(current.start.y); axes.points.push(current.start);
    }
    const profiles = {
      room: { tolerance: .34, pointTolerance: .38, grid: .1 },
      polygon: { tolerance: .42, pointTolerance: .58, grid: .1 },
      wall: { tolerance: .26, pointTolerance: .32, grid: .1 },
      pile: { tolerance: .18, pointTolerance: .34, grid: .1 },
      pileRow: { tolerance: .12, pointTolerance: .28, grid: false },
      bindingLine: { tolerance: .08, pointTolerance: .16, grid: false },
      terrace: { tolerance: .22, pointTolerance: .26, grid: .1 },
      porch: { tolerance: .22, pointTolerance: .26, grid: .1 },
      dimension: { tolerance: .18, pointTolerance: .24, grid: .1 }
    };
    const profile = profiles[mode] || { tolerance: .12, pointTolerance: .18, grid: .1 };
    const options = { tolerance: profile.tolerance, pointTolerance: profile.pointTolerance };
    if (profile.grid != null) options.grid = profile.grid;
    return { raw: baseRaw, ...snapPointDetails(baseRaw, axes, options) };
  };
  const begin = (event, value) => {
    event.preventDefault(); event.stopPropagation(); window.getSelection?.()?.removeAllRanges();
    svgRef.current.setPointerCapture?.(event.pointerId);
    const resolved = magneticPoint(event, value.type);
    const freeLine = ['pileRow','bindingLine','wall','dimension'].includes(value.type);
    const start = value.type === 'pileRow'
      ? (resolved.snap ? resolved.point : resolved.raw)
      : freeLine ? resolved.raw : resolved.point;
    setGesture({ ...value, pointerId: event.pointerId, start, end: start, snap: resolved.snap || null });
  };
  const deleteObject = (type, id) => commitPlan((next) => {
    const key = type === 'room' ? 'rooms' : type === 'platform' ? 'platforms' : type === 'opening' ? 'openings' : type === 'wall' ? 'walls' : type === 'dimension' ? 'dimensions' : type === 'pileRow' ? 'pileRows' : type === 'bindingLine' ? 'bindingLines' : type === 'gap' ? 'wallGaps' : 'piles';
    next[key] = (next[key] || []).filter((item) => item.id !== id);
  });
  const objectDown = (event, type, id, extra = {}) => {
    if (tool === 'delete') { event.preventDefault(); event.stopPropagation(); deleteObject(type, id); setSelected(null); return; }
    if (tool !== 'select') return;
    event.preventDefault(); event.stopPropagation();
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      pendingTouchSelectionRef.current = null;
      if (selected?.type === type && selected?.id === id) {
        begin(event, { kind: extra.kind || 'move', type, id, index: extra.index });
        return;
      }
      selectExisting({ type, id });
      return;
    }
    selectExisting({ type, id }); begin(event, { kind: extra.kind || 'move', type, id, index: extra.index });
  };
  const addAt = (point, type) => {
    if (type === 'pile') {
      const id = uid('pile'); commitPlan((next) => next.piles.push({ id, ...point, source: 'manual' })); selectCreated({ type: 'pile', id }); return;
    }
    const segment = nearestSegment(point, allOpeningSegments(plan));
    if (!segment) return;
    const id = uid(type); const common = { id, orientation: segment.axis, outer: segment.outer, x: segment.axis === 'v' ? segment.fixed : segment.projected, y: segment.axis === 'v' ? segment.projected : segment.fixed };
    if (type === 'gap') {
      commitPlan((next) => next.wallGaps.push({ ...common, width: 1 })); selectCreated({ type: 'gap', id });
    } else {
      const isGarage = type === 'garage';
      const openingType = isGarage ? 'door' : type;
      const draft = { ...common, type: openingType, width: type === 'window' ? 1.2 : isGarage ? 2.5 : 0.86, height: type === 'window' ? 1.2 : isGarage ? 2.2 : 2.05, doorType: isGarage ? 'garage' : segment.outer ? 'entrance' : 'interior', hinge: 'right', swing: segment.outer ? 'out' : 'in' };
      const opening = isGarage ? projectOpeningToWall(draft, point, plan, { lockDoorType: true }) : draft;
      commitPlan((next) => next.openings.push(opening)); selectCreated({ type: 'opening', id });
    }
  };
  const pointerDownCapture = (event) => {
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointersRef.current.size === 2) {
      const [a, b] = [...activePointersRef.current.values()];
      pinchRef.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: viewportZoom ?? plan.zoom ?? 100, pan: { ...(viewportPan || { x: 0, y: 0 }) }, center: { x: (a.x+b.x)/2, y: (a.y+b.y)/2 } };
      pinchConsumedRef.current = true;
      pendingTouchSelectionRef.current = null;
      setGesture(null);
      setHoverSnap(null);
    }
  };
  const finishPointer = (event) => {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    if (activePointersRef.current.size === 0) window.setTimeout(() => { pinchConsumedRef.current = false; }, 0);
  };
  const canvasDown = (event) => {
    if (event.button !== 0) return;
    const rawPoint = rawPlanPoint(event);
    const point = toPlan(event);
    if (tool === 'select') { setSelected(null); onSelected?.(null); panGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: { ...(viewportPan || { x: 0, y: 0 }) }, moved: false }; return; }
    if (tool === 'polygon') {
      const polygonPoint = magneticPoint(event, 'polygon').point;
      if (shouldClosePolygon(polygonDraft, polygonPoint)) { finishPolygon(); return; }
      setPolygonDraft((current) => [...current, polygonPoint]); return;
    }
    if (tool === 'window' || tool === 'door' || tool === 'garage' || tool === 'gap') { addAt(rawPoint, tool); return; }
    if (tool === 'pile') { const resolvedPile = magneticPoint(event, 'pile'); addAt(resolvedPile.point, tool); return; }
    if (tool === 'dimension') {
      if (!dimensionStart) { setDimensionStart(point); setDimensionHover(point); return; }
      const distance = Math.hypot(point.x - dimensionStart.x, point.y - dimensionStart.y);
      if (distance >= .03) {
        const id = uid('dimension');
        commitPlan((next) => next.dimensions.push({ id, x1: dimensionStart.x, y1: dimensionStart.y, x2: point.x, y2: point.y }));
        selectCreated({ type: 'dimension', id });
      }
      setDimensionStart(null); setDimensionHover(null); return;
    }
    if (DRAW_TOOLS.has(tool)) begin(event, { kind: 'draw', type: tool });
  };
  const pointerMove = (event) => {
    if (activePointersRef.current.has(event.pointerId)) activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current && activePointersRef.current.size >= 2) {
      const [a, b] = [...activePointersRef.current.values()];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const nextZoom = Math.max(35, Math.min(2000, Math.round(pinchRef.current.zoom * distance / pinchRef.current.distance)));
      const center = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
      onViewportZoom?.(nextZoom);
      onViewportPan?.({ x: pinchRef.current.pan.x + (center.x - pinchRef.current.center.x), y: pinchRef.current.pan.y + (center.y - pinchRef.current.center.y) });
      event.preventDefault();
      return;
    }
    if (panGestureRef.current && panGestureRef.current.pointerId === event.pointerId && !gestureRef.current) {
      const dx = event.clientX - panGestureRef.current.x; const dy = event.clientY - panGestureRef.current.y;
      if (Math.hypot(dx,dy) > 4) panGestureRef.current.moved = true;
      if (panGestureRef.current.moved) onViewportPan?.({ x: panGestureRef.current.start.x + dx, y: panGestureRef.current.start.y + dy });
      event.preventDefault(); return;
    }
    const resolved = magneticPoint(event, gestureRef.current?.type || tool);
    if (dimensionStart && tool === 'dimension') setDimensionHover(resolved.point);
    setHoverSnap(resolved);
    if (!gestureRef.current || event.pointerId !== gestureRef.current.pointerId) return;
    const liveEnd = resolved.snap ? resolved.point : resolved.raw;
    setGesture((current) => ({ ...current, end: liveEnd, snap: resolved.snap || null }));
  };
  const pointerUp = (event) => {
    if (panGestureRef.current?.pointerId === event.pointerId) panGestureRef.current = null;
    if (pinchRef.current || pinchConsumedRef.current) { pendingTouchSelectionRef.current = null; finishPointer(event); return; }
    if (!gestureRef.current && pendingTouchSelectionRef.current?.pointerId === event.pointerId) {
      pendingTouchSelectionRef.current = null;
      finishPointer(event);
      return;
    }
    const current = gestureRef.current;
    if (!current || event.pointerId !== current.pointerId) { finishPointer(event); return; }
    const released = magneticPoint(event, current.type);
    const finalGesture = { ...current, end: released.snap ? released.point : released.raw, snap: released.snap || null };
    if (current.kind === 'draw') {
      const distance = Math.hypot(finalGesture.end.x - finalGesture.start.x, finalGesture.end.y - finalGesture.start.y);
      if (['room', 'terrace', 'porch'].includes(current.type)) {
        const points = rectanglePoints(finalGesture.start, finalGesture.end); const bounds = boundsOf(points);
        if (bounds.w >= 0.5 && bounds.h >= 0.5) {
          const id = uid(current.type);
          commitPlan((next) => {
            if (current.type === 'room') next.rooms.push(withRoomBounds({ id, name: `Комната ${next.rooms.length + 1}`, points, include: true, bearing: false, ceilingMode: 'flat' }));
            else {
              const platform = normalizeTerracePlatform({ id, kind: current.type, ...bounds, include: true, steps: 3, stairSide: 'bottom', stairDirection: 'outward', stairWidth: 1.2, tread: 0.3, riser: 0.18 });
              next.platforms.push(snapPlatformToHouse(platform, next.house));
            }
          });
          selectCreated({ type: current.type === 'room' ? 'room' : 'platform', id });
        }
      } else if (distance >= 0.3) {
        const id = uid(current.type);
        commitPlan((next) => {
          const line = { id, x1: finalGesture.start.x, y1: finalGesture.start.y, x2: finalGesture.end.x, y2: finalGesture.end.y };
          if (current.type === 'wall') next.walls.push({ ...line, bearing: false });
          if (current.type === 'dimension') {
            next.dimensions.push(dimensionOutsideHouse(line, next.house));
          }
          if (current.type === 'pileRow') next.pileRows.push({ ...line, name: `Ряд ${next.pileRows.length + 1}`, count: Math.max(2, Math.ceil(distance / 2.5) + 1), group: 'house' });
          if (current.type === 'bindingLine') next.bindingLines.push({ ...line, name: `Обвязка ${next.bindingLines.length + 1}`, group: 'house', include: true });
        });
        selectCreated({ type: current.type, id });
      }
    } else {
      const next = previewPlan(plan, finalGesture);
      if (JSON.stringify(next) !== JSON.stringify(plan)) commitPlan((target) => Object.assign(target, next));
    }
    svgRef.current.releasePointerCapture?.(event.pointerId); setGesture(null); finishPointer(event);
  };

  const topLeft = p(0, 0); const bottomRight = p(shownPlan.house.w, shownPlan.house.h);
  const footprint = layout.sides.bounds;
  const horizontalY = layout.sides.horizontal === 'top' ? p(0, footprint.minY).y - 30 : p(0, footprint.maxY).y + 30;
  const verticalX = layout.sides.vertical === 'left' ? p(footprint.minX, 0).x - 30 : p(footprint.maxX, 0).x + 30;
  const line = (item) => ({ a: p(item.x1, item.y1), b: p(item.x2, item.y2) });
  const zoomTextScale = Math.max(1, Math.min(7, (viewportZoom ?? plan.zoom ?? 100) / 100));
  const roomNameSize = Math.max(19, Math.min(88, 17 * zoomTextScale));
  const roomMetaSize = Math.max(15, Math.min(70, 13.2 * zoomTextScale));
  const technicalTextSize = Math.max(12.5, Math.min(52, 11.5 * zoomTextScale));
  const dimensionTextSize = Math.max(14.5, Math.min(64, 12.5 * zoomTextScale));
  const platformLabelSize = Math.max(15, Math.min(66, 13.5 * zoomTextScale));
  const platformAreaSize = Math.max(13, Math.min(56, 11.5 * zoomTextScale));
    const selectedRoom = selected?.type === 'room' ? (shownPlan.rooms || []).find((room) => room.id === selected.id) : null;
  const selectedRoomScreen = selectedRoom ? roomPoints(selectedRoom).map((point) => p(point.x, point.y)) : [];
  const drawSegment = (segment, key) => {
    const [a, b] = lineEndpoints(segment); const q1 = p(a.x, a.y); const q2 = p(b.x, b.y);
    return <g key={key} className="wall-band unified-wall-band"><line className="wall-band-base" x1={q1.x} y1={q1.y} x2={q2.x} y2={q2.y} /><line className="wall-band-core" x1={q1.x} y1={q1.y} x2={q2.x} y2={q2.y} /></g>;
  };
  const renderCut = (item, className) => { const q = p(item.x, item.y); const size = Math.max(18, item.width * layout.scale); return item.orientation === 'v' ? <line className={className} x1={q.x} y1={q.y - size / 2} x2={q.x} y2={q.y + size / 2} /> : <line className={className} x1={q.x - size / 2} y1={q.y} x2={q.x + size / 2} y2={q.y} />; };
  const renderOpeningHit = (item) => { const q = p(item.x, item.y); const size = Math.max(28, item.width * layout.scale); return item.orientation === 'v' ? <rect className="opening-hit" x={q.x - 14} y={q.y - size / 2} width="28" height={size} /> : <rect className="opening-hit" x={q.x - size / 2} y={q.y - 14} width={size} height="28" />; };
  const hasManualPileAt = (point) => (shownPlan.piles || []).some((pile) => Math.hypot(pile.x - point.x, pile.y - point.y) <= 0.02);
  const activeDraw = gesture?.kind === 'draw' ? gesture : null;
  const activeDrawStart = activeDraw ? p(activeDraw.start.x, activeDraw.start.y) : null;
  const activeDrawEnd = activeDraw ? p(activeDraw.end.x, activeDraw.end.y) : null;
  const snapLabel = activeDraw?.snap ? (activeDraw.snap.kind === 'node' ? 'Узел' : activeDraw.snap.kind === 'intersection' ? 'Пересечение' : 'Стена / ось') : null;
  return <svg ref={svgRef} className={`plan-svg tool-${tool}`} viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Редактор плана дома" onPointerDownCapture={pointerDownCapture} onPointerDown={canvasDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={() => { if (!gestureRef.current) setHoverSnap(null); }} onPointerCancel={(event) => { panGestureRef.current = null; pendingTouchSelectionRef.current = null; finishPointer(event); setGesture(null); }} onLostPointerCapture={(event) => { if (event.pointerType === 'touch') { activePointersRef.current.delete(event.pointerId); if (activePointersRef.current.size < 2) pinchRef.current = null; } }}>
    <defs>
      <pattern id="planner-minor-grid" x={((layout.ox % Math.max(4,layout.scale/10)) + Math.max(4,layout.scale/10)) % Math.max(4,layout.scale/10)} y={((layout.oy % Math.max(4,layout.scale/10)) + Math.max(4,layout.scale/10)) % Math.max(4,layout.scale/10)} width={Math.max(4,layout.scale/10)} height={Math.max(4,layout.scale/10)} patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#7b837d" fillOpacity=".22" /></pattern>
      <pattern id="planner-grid" x={((layout.ox % layout.scale) + layout.scale) % layout.scale} y={((layout.oy % layout.scale) + layout.scale) % layout.scale} width={layout.scale} height={layout.scale} patternUnits="userSpaceOnUse"><rect width={layout.scale} height={layout.scale} fill="url(#planner-minor-grid)" /><path d={`M ${layout.scale} 0 H 0 V ${layout.scale}`} fill="none" stroke="#67736b" strokeOpacity=".32" strokeWidth="1.2" /></pattern>
      <pattern id="structural-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#7d857f" strokeWidth="2" strokeOpacity=".34" /></pattern>
      <marker id="planner-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="currentColor" /></marker>
    </defs>
    <rect className="plan-grid-hit" x={-VIEW.width*8} y={-VIEW.height*8} width={VIEW.width*17} height={VIEW.height*17} fill="url(#planner-grid)" />
    {(shownPlan.platforms || []).map((platform) => { const q = p(platform.x, platform.y); return <g key={platform.id} className="planner-object" onPointerDown={(event) => objectDown(event, 'platform', platform.id)}><rect className={`platform-shape ${selected?.id === platform.id ? 'selected' : ''}`} x={q.x} y={q.y} width={platform.w * layout.scale} height={platform.h * layout.scale} /><text className="platform-label" style={{'--plan-font-size': `${platformLabelSize}px`}} x={q.x + platform.w * layout.scale / 2} y={q.y + platform.h * layout.scale / 2 - platformAreaSize*.35}>{platform.kind === 'porch' ? 'Крыльцо' : 'Терраса'}</text><text className="platform-area" style={{'--plan-font-size': `${platformAreaSize}px`}} x={q.x + platform.w * layout.scale / 2} y={q.y + platform.h * layout.scale / 2 + platformAreaSize*.9}>{formatNumber(platform.w * platform.h)} м²</text><TerraceStairs platform={platform} p={p} />{shownPlan.showBinding !== false && platform.binding?.mode !== 'none' ? <rect className="binding-guide" x={q.x} y={q.y} width={platform.w * layout.scale} height={platform.h * layout.scale} /> : null}</g>; })}
    <rect className="house-fill" x={topLeft.x} y={topLeft.y} width={shownPlan.house.w * layout.scale} height={shownPlan.house.h * layout.scale} />
    {(shownPlan.rooms || []).map((room, roomIndex) => { const points = roomPoints(room); const screen = points.map((point) => p(point.x, point.y)); const bounds = boundsOf(points); const center = p(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2); const selectedNow = selected?.type === 'room' && selected.id === room.id; return <g key={room.id} className="planner-object room-object"><polygon className={`room-fill room-tone-${roomIndex % 6} ${selectedNow ? 'selected' : ''} ${issueRooms.has(room.id) ? 'invalid' : ''} ${room.ceilingMode === 'open-rafter' ? 'open-rafter' : ''}`} points={screen.map((point) => `${point.x},${point.y}`).join(' ')} /><polygon className="room-touch-hit" points={screen.map((point) => `${point.x},${point.y}`).join(' ')} onPointerDown={(event) => objectDown(event, 'room', room.id)} /><text className="room-name" style={{'--plan-font-size': `${roomNameSize}px`}} x={center.x} y={center.y - roomMetaSize*.95}>{room.name}</text><text className="room-dimensions" style={{'--plan-font-size': `${roomMetaSize}px`}} x={center.x} y={center.y + roomMetaSize*.55}>{formatNumber(bounds.w)} × {formatNumber(bounds.h)} м</text><text className="room-area" style={{'--plan-font-size': `${roomMetaSize}px`}} x={center.x} y={center.y + roomMetaSize*1.85}>{formatNumber(polygonArea(points))} м²</text>{room.ceilingMode === 'open-rafter' ? <text className="room-ceiling-mode" style={{'--plan-font-size': `${Math.max(12,roomMetaSize)}px`}} x={center.x} y={center.y + roomMetaSize*3.0}>Второй свет</text> : null}{selectedNow ? screen.map((point, index) => <circle key={index} className="vertex-handle" cx={point.x} cy={point.y} r="7" onPointerDown={(event) => objectDown(event, 'room', room.id, { kind: 'vertex', index })} />) : null}</g>; })}
    {(() => {
      const wallBand = Math.max(10, shownPlan.wallThickness * layout.scale);
      const outerX = topLeft.x - wallBand / 2, outerY = topLeft.y - wallBand / 2;
      const outerW = shownPlan.house.w * layout.scale + wallBand, outerH = shownPlan.house.h * layout.scale + wallBand;
      const innerX = topLeft.x + wallBand / 2, innerY = topLeft.y + wallBand / 2;
      const innerW = Math.max(1, shownPlan.house.w * layout.scale - wallBand), innerH = Math.max(1, shownPlan.house.h * layout.scale - wallBand);
      const ring = `M ${outerX} ${outerY} H ${outerX + outerW} V ${outerY + outerH} H ${outerX} Z M ${innerX} ${innerY} H ${innerX + innerW} V ${innerY + innerH} H ${innerX} Z`;
      return <g className="outer-wall-structure"><path className="outer-wall-ring" d={ring} fillRule="evenodd" /><rect className="outer-wall-outer-outline" x={outerX} y={outerY} width={outerW} height={outerH} /><rect className="outer-wall-inner-outline" x={innerX} y={innerY} width={innerW} height={innerH} /></g>;
    })()}
    {unifiedWalls.map((segment, index) => drawSegment(segment, `unified-${index}`))}
    {selectedRoom ? <g className="selected-room-overlay"><polygon className="selected-room-outline" points={selectedRoomScreen.map((point) => `${point.x},${point.y}`).join(' ')} />{selectedRoomScreen.map((point, index) => <circle key={index} className="vertex-handle selected-room-handle" cx={point.x} cy={point.y} r="7" onPointerDown={(event) => objectDown(event, 'room', selectedRoom.id, { kind: 'vertex', index })} />)}</g> : null}
    {(shownPlan.walls || []).map((wall) => { const q = line(wall); const selectedNow = selected?.type === 'wall' && selected.id === wall.id; return <g key={wall.id} className="planner-object wall-band" onPointerDown={(event) => objectDown(event, 'wall', wall.id)}><line className={`wall-band-base standalone-wall ${selectedNow ? 'selected' : ''}`} x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} /><line className="wall-band-core" x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} /><line className="wide-hit" x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} />{selectedNow ? [q.a, q.b].map((point, index) => <circle key={index} className="endpoint-handle" cx={point.x} cy={point.y} r="7" onPointerDown={(event) => objectDown(event, 'wall', wall.id, { kind: 'endpoint', index })} />) : null}</g>; })}
    {(shownPlan.wallGaps || []).map((gap) => <g key={gap.id} className="planner-object" onPointerDown={(event) => objectDown(event, 'gap', gap.id)}>{renderCut(gap, `wall-gap ${selected?.id === gap.id ? 'selected' : ''}`)}</g>)}
    {(shownPlan.openings || []).map((opening) => { const q = p(opening.x, opening.y); const size = Math.max(18, opening.width * layout.scale); const selectedNow = selected?.type === 'opening' && selected.id === opening.id; const garage = opening.type === 'door' && opening.doorType === 'garage'; return <g key={opening.id} className={`planner-object ${selectedNow ? 'selected-opening' : ''}`} onPointerDown={(event) => objectDown(event, 'opening', opening.id)}>{renderCut(opening, 'opening-cut')}{renderCut(opening, `opening ${opening.type}${garage ? ' garage' : ''}`)}{garage ? <GarageGate opening={opening} q={q} size={size} plan={shownPlan} /> : opening.type === 'door' ? <DoorLeaf opening={opening} q={q} size={size} plan={shownPlan} /> : null}{opening.type === 'door' ? <text className="opening-tag" x={q.x} y={q.y - 10}>{garage ? 'ГВ' : opening.doorType === 'interior' ? 'МД' : 'ВХ'}</text> : null}</g>; })}
    {shownPlan.showPiles !== false ? foundation.points.filter((point) => !hasManualPileAt(point)).map((point, index) => { const q = p(point.x, point.y); return <circle key={`derived-${index}`} className={`pile-point ${point.source}`} cx={q.x} cy={q.y} r="6" />; }) : null}
    {shownPlan.showPiles !== false ? (shownPlan.piles || []).map((pile) => { const q = p(pile.x, pile.y); return <circle key={pile.id} className={`manual-pile ${selected?.id === pile.id ? 'selected' : ''}`} cx={q.x} cy={q.y} r="8" onPointerDown={(event) => objectDown(event, 'pile', pile.id)} />; }) : null}
    {shownPlan.showPiles !== false ? (shownPlan.pileRows || []).map((row) => { const q = line(row); const selectedNow = selected?.type === 'pileRow' && selected.id === row.id; const spacing = Math.hypot(row.x2 - row.x1, row.y2 - row.y1) / Math.max(1, (row.count || 2) - 1); const alignment = pileRowAlignment(row); return <g key={row.id} className="planner-object" onPointerDown={(event) => objectDown(event, 'pileRow', row.id)}><line className={`pile-guide axis-${alignment.state} ${selectedNow ? 'selected' : ''}`} x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} /><line className="wide-hit" x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} /><text className={`pile-spacing-text axis-${alignment.state}`} style={{'--plan-font-size': `${technicalTextSize}px`}} x={(q.a.x + q.b.x) / 2} y={(q.a.y + q.b.y) / 2 - 9}>шаг {formatNumber(spacing)} м</text>{selectedNow ? [q.a, q.b].map((point, index) => <rect key={index} className="endpoint-handle pile-row-endpoint" x={point.x - 6} y={point.y - 6} width="12" height="12" rx="2" transform={`rotate(45 ${point.x} ${point.y})`} onPointerDown={(event) => objectDown(event, 'pileRow', row.id, { kind: 'endpoint', index })} />) : null}</g>; }) : null}
    {shownPlan.showBinding !== false ? (shownPlan.bindingLines || []).map((binding) => { const q = line(binding); const selectedNow = selected?.type === 'bindingLine' && selected.id === binding.id; const length = Math.hypot(binding.x2 - binding.x1, binding.y2 - binding.y1); return <g key={binding.id} className="planner-object binding-object" onPointerDown={(event) => objectDown(event, 'bindingLine', binding.id)}><line className={`binding-guide-line ${selectedNow ? 'selected' : ''}`} x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} /><line className="wide-hit" x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} /><text className="binding-length-text" style={{'--plan-font-size': `${technicalTextSize}px`}} x={(q.a.x + q.b.x) / 2} y={(q.a.y + q.b.y) / 2 + 14}>{formatNumber(length)} м</text>{selectedNow ? [q.a, q.b].map((point, index) => <circle key={index} className="endpoint-handle binding-endpoint" cx={point.x} cy={point.y} r="7" onPointerDown={(event) => objectDown(event, 'bindingLine', binding.id, { kind: 'endpoint', index })} />) : null}</g>; }) : null}
    {shownPlan.showDimensions !== false ? (shownPlan.dimensions || []).map((dimension) => { const q = line(dimension); const length = Math.hypot(dimension.x2 - dimension.x1, dimension.y2 - dimension.y1); const selectedNow = selected?.type === 'dimension' && selected.id === dimension.id; return <g key={dimension.id} className="planner-object" onPointerDown={(event) => objectDown(event, 'dimension', dimension.id)}><line className={`custom-dimension ${selectedNow ? 'selected' : ''}`} markerStart="url(#planner-arrow)" markerEnd="url(#planner-arrow)" x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} /><line className="dimension-tick" x1={q.a.x - 6} y1={q.a.y - 6} x2={q.a.x + 6} y2={q.a.y + 6} /><line className="dimension-tick" x1={q.b.x - 6} y1={q.b.y - 6} x2={q.b.x + 6} y2={q.b.y + 6} /><text className="dimension-text" style={{'--plan-font-size': `${dimensionTextSize}px`}} x={(q.a.x + q.b.x) / 2} y={(q.a.y + q.b.y) / 2 - 8}>{Math.round(length * 1000)} мм</text>{selectedNow ? [q.a, q.b].map((point, index) => <circle key={index} className="endpoint-handle" cx={point.x} cy={point.y} r="7" onPointerDown={(event) => objectDown(event, 'dimension', dimension.id, { kind: 'endpoint', index })} />) : null}</g>; }) : null}
    {shownPlan.showDimensions !== false ? <g className="outer-dimensions" style={{'--plan-font-size': `${dimensionTextSize}px`}}><line x1={topLeft.x} y1={horizontalY} x2={bottomRight.x} y2={horizontalY} markerStart="url(#planner-arrow)" markerEnd="url(#planner-arrow)" /><line className="extension-line" x1={topLeft.x} y1={topLeft.y} x2={topLeft.x} y2={horizontalY} /><line className="extension-line" x1={bottomRight.x} y1={topLeft.y} x2={bottomRight.x} y2={horizontalY} /><text x={(topLeft.x + bottomRight.x) / 2} y={horizontalY - 9}>{Math.round(shownPlan.house.w * 1000).toLocaleString('ru-RU')} мм</text><line x1={verticalX} y1={topLeft.y} x2={verticalX} y2={bottomRight.y} markerStart="url(#planner-arrow)" markerEnd="url(#planner-arrow)" /><line className="extension-line" x1={topLeft.x} y1={topLeft.y} x2={verticalX} y2={topLeft.y} /><line className="extension-line" x1={topLeft.x} y1={bottomRight.y} x2={verticalX} y2={bottomRight.y} /><text transform={`translate(${verticalX - 10} ${(topLeft.y + bottomRight.y) / 2}) rotate(-90)`}>{Math.round(shownPlan.house.h * 1000).toLocaleString('ru-RU')} мм</text></g> : null}
    {(shownPlan.openings || []).map((opening) => <g key={`opening-hit-${opening.id}`} className={`opening-hit-layer opening-hit-${opening.type}-${opening.doorType || 'standard'}`} data-opening-id={opening.id} onPointerDown={(event) => objectDown(event, 'opening', opening.id)}>{renderOpeningHit(opening)}</g>)}
    <g className="plan-origin-marker"><circle cx={p(0,0).x} cy={p(0,0).y} r="6" /><path d={`M ${p(0,0).x-18} ${p(0,0).y} H ${p(0,0).x+18} M ${p(0,0).x} ${p(0,0).y-18} V ${p(0,0).y+18}`} /><text x={p(0,0).x+10} y={p(0,0).y-10}>0,0</text></g>
    {activeDrawStart && activeDrawEnd ? <g className={`finger-draw-guide ${activeDraw?.snap ? 'snapped' : ''}`}><circle className="draw-start-dot" cx={activeDrawStart.x} cy={activeDrawStart.y} r="8" /><circle className="draw-end-dot" cx={activeDrawEnd.x} cy={activeDrawEnd.y} r="8" /><line x1={activeDrawStart.x} y1={activeDrawStart.y} x2={activeDrawEnd.x} y2={activeDrawEnd.y} />{snapLabel ? <g className="snap-pill" transform={`translate(${activeDrawEnd.x+12} ${activeDrawEnd.y-26})`}><rect x="0" y="0" rx="8" width="88" height="22" /><text x="44" y="15">{snapLabel}</text></g> : null}</g> : null}
    {gesture?.kind === 'draw' ? (() => { const a = p(gesture.start.x, gesture.start.y); const b = p(gesture.end.x, gesture.end.y); const alignment = pileRowAlignment({ x1: gesture.start.x, y1: gesture.start.y, x2: gesture.end.x, y2: gesture.end.y }); return ['room', 'terrace', 'porch'].includes(gesture.type) ? <g><rect className="draft-shape" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} />{gesture.type === 'room' ? <DraftRoomDimensions start={gesture.start} end={gesture.end} p={p} /> : null}</g> : <line className={`draft-line guide-${alignment.state === 'aligned' ? 'aligned' : 'off-axis'}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })() : null}
    {polygonDraft.length ? <g><polyline className="polygon-draft" points={polygonDraft.map((point) => { const q = p(point.x, point.y); return `${q.x},${q.y}`; }).join(' ')} />{polygonDraft.map((point, index) => { const q = p(point.x, point.y); return <circle key={index} className="polygon-point" cx={q.x} cy={q.y} r="5" />; })}</g> : null}
    {tool === 'polygon' ? <DraftPolygonEdge points={polygonDraft} hoverPoint={hoverSnap?.point} p={p} /> : null}
    {hoverSnap?.snap && (tool !== 'select' || gesture) ? (() => { const q = p(hoverSnap.point.x, hoverSnap.point.y); return <g className={`snap-indicator snap-${hoverSnap.snap.kind}`} transform={`translate(${q.x} ${q.y})`}><circle className="snap-halo" r="11" /><circle className="snap-core" r="4" /></g>; })() : null}
  </svg>;
}

function RoomList({ plan, issues, onSelect }) {
  const issueIds = new Set(issues.flatMap((issue) => issue.roomIds || []));
  return <div className="room-summary"><header><div><h3>Помещения</h3><p>Нажмите строку, чтобы выбрать комнату на плане.</p></div><strong>{formatNumber((plan.rooms || []).reduce((sum, room) => sum + polygonArea(roomPoints(room)), 0))} м²</strong></header>{issues.length ? <div className="plan-warning"><AlertTriangle />{issues.length} несостыковок — отмечены красным</div> : <div className="plan-ok">Стыковка помещений корректна</div>}<div className="room-summary-list">{(plan.rooms || []).map((room, index) => <button key={room.id} className={issueIds.has(room.id) ? 'invalid' : ''} onClick={() => onSelect({ type: 'room', id: room.id })}><span><i>{index + 1}</i><strong>{room.name}</strong></span><em>{formatNumber(polygonArea(roomPoints(room)))} м²</em></button>)}</div></div>;
}

function Inspector({ plan, selected, commitPlan, issues, setSelected }) {
  const get = (key) => (plan[key] || []).find((item) => item.id === selected?.id);
  const update = (key, mutate) => commitPlan((next) => { const item = (next[key] || []).find((candidate) => candidate.id === selected.id); if (item) mutate(item); });
  const remove = () => {
    const key = selected.type === 'room' ? 'rooms' : selected.type === 'platform' ? 'platforms' : selected.type === 'opening' ? 'openings' : selected.type === 'wall' ? 'walls' : selected.type === 'dimension' ? 'dimensions' : selected.type === 'pileRow' ? 'pileRows' : selected.type === 'bindingLine' ? 'bindingLines' : selected.type === 'gap' ? 'wallGaps' : 'piles';
    commitPlan((next) => { next[key] = (next[key] || []).filter((item) => item.id !== selected.id); }); setSelected(null);
  };
  if (!selected) return <RoomList plan={plan} issues={issues} onSelect={setSelected} />;
  const room = selected.type === 'room' ? get('rooms') : null;
  const platform = selected.type === 'platform' ? get('platforms') : null;
  const opening = selected.type === 'opening' ? get('openings') : null;
  const pileRow = selected.type === 'pileRow' ? get('pileRows') : null;
  const bindingLine = selected.type === 'bindingLine' ? get('bindingLines') : null;
  const wall = selected.type === 'wall' ? get('walls') : null;
  const dimension = selected.type === 'dimension' ? get('dimensions') : null;
  const gap = selected.type === 'gap' ? get('wallGaps') : null;
  const pile = selected.type === 'pile' ? get('piles') : null;
  if (room) {
    const bounds = boundsOf(roomPoints(room));
    const area = polygonArea(roomPoints(room));
    const resize = (axis, value) => update('rooms', (item) => { const old = boundsOf(roomPoints(item)); const sx = axis === 'w' ? value / Math.max(.1, old.w) : 1; const sy = axis === 'h' ? value / Math.max(.1, old.h) : 1; item.points = roomPoints(item).map((point) => ({ x: roundCoord(old.x + (point.x - old.x) * sx), y: roundCoord(old.y + (point.y - old.y) * sy) })); Object.assign(item, boundsOf(item.points)); });
    return <div className="inspector-form"><h3>{room.name}</h3><Field label="Название"><input value={room.name} onChange={(event) => update('rooms', (item) => { item.name = event.target.value; })} /></Field><div className="form-grid"><NumberField label="Размер X" value={roundCoord(bounds.w)} suffix="м" min={.5} onChange={(value) => resize('w', value)} /><NumberField label="Размер Y" value={roundCoord(bounds.h)} suffix="м" min={.5} onChange={(value) => resize('h', value)} /></div><div className="readout"><span>Площадь помещения</span><strong>{formatNumber(area)} м²</strong></div><SelectField label="Верх помещения" value={room.ceilingMode || 'flat'} onChange={(value) => update('rooms', (item) => { item.ceilingMode = value; })} options={[{ value: 'flat', label: 'Горизонтальный СИП-потолок' }, { value: 'open-rafter', label: 'Второй свет · утеплённые стропила' }]} />{room.ceilingMode === 'open-rafter' ? <NumberField label="Площадь второго света" value={room.openCeilingArea == null ? roundCoord(area) : room.openCeilingArea} suffix="м²" min={0.5} max={roundCoord(area)} step={0.1} onChange={(value) => update('rooms', (item) => { item.openCeilingArea = Math.min(area, Math.max(0, value)); })} /> : null}<Toggle label="Несущие перегородки" checked={room.bearing} onChange={(value) => update('rooms', (item) => { item.bearing = value; })} /><Toggle label="Учитывать в расчёте" checked={room.include !== false} onChange={(value) => update('rooms', (item) => { item.include = value; })} /><p className="inspector-note">Можно открыть всю комнату или только указанную часть. Горизонтальный потолок вычитается, а площадь утепления переносится на скаты кровли.</p><button className="button danger-button" onClick={remove}><Trash2 />Удалить комнату</button></div>;
  }
  if (platform) {
    const roof = calculateTerraceRoof(platform, plan.house);
    const change = (mutate) => update('platforms', (item) => { mutate(item); Object.assign(item, normalizeTerracePlatform(item)); });
    return <div className="inspector-form"><h3>{platform.kind === 'porch' ? 'Крыльцо' : 'Терраса'} · {formatNumber(platform.w * platform.h)} м²</h3><div className="form-grid"><NumberField label="Размер X" value={platform.w} suffix="м" min={.5} onChange={(value) => change((item) => { item.w = value; })} /><NumberField label="Размер Y" value={platform.h} suffix="м" min={.5} onChange={(value) => change((item) => { item.h = value; })} /><NumberField label="Ступени" value={platform.steps} suffix="шт" step={1} onChange={(value) => change((item) => { item.steps = Math.round(value); })} /><NumberField label="Ширина лестницы" value={platform.stairWidth || 1.2} suffix="м" onChange={(value) => change((item) => { item.stairWidth = value; })} /><NumberField label="Проступь" value={platform.tread || .3} suffix="м" onChange={(value) => change((item) => { item.tread = value; })} /><NumberField label="Высота ступени" value={platform.riser || .18} suffix="м" onChange={(value) => change((item) => { item.riser = value; })} /></div><SelectField label="Сторона лестницы" value={platform.stairSide || 'bottom'} onChange={(value) => change((item) => { item.stairSide = value; })} options={[{ value: 'top', label: 'Сверху' }, { value: 'right', label: 'Справа' }, { value: 'bottom', label: 'Снизу' }, { value: 'left', label: 'Слева' }]} /><SelectField label="Свайное поле" value={platform.foundation.mode} onChange={(value) => change((item) => { item.foundation.mode = value; })} options={[{ value: 'shared', label: 'Общее с домом' }, { value: 'separate', label: 'Отдельное' }, { value: 'none', label: 'Без свай' }]} /><SelectField label="Обвязка" value={platform.binding.mode} onChange={(value) => change((item) => { item.binding.mode = value; })} options={[{ value: 'shared', label: 'Общая с домом' }, { value: 'separate', label: 'Отдельная' }, { value: 'none', label: 'Не учитывать' }]} /><SelectField label="Кровля" value={platform.roof.mode} onChange={(value) => change((item) => { item.roof.mode = value; })} options={[{ value: 'none', label: 'Без кровли' }, { value: 'cold', label: 'Холодная' }, { value: 'warm', label: 'Тёплая СИП' }]} />{platform.roof.mode !== 'none' ? <><SelectField label="Форма кровли" value={platform.roof.shape} onChange={(value) => change((item) => { item.roof.shape = value; })} options={[{ value: 'shed', label: 'Односкатная' }, { value: 'continuation', label: 'Продолжение основной' }, { value: 'gable', label: 'Двускатная' }]} /><div className="form-grid"><NumberField label="Высота у стены" value={platform.roof.highHeight} suffix="м" onChange={(value) => change((item) => { item.roof.highHeight = value; })} /><NumberField label="Высота края" value={platform.roof.lowHeight} suffix="м" onChange={(value) => change((item) => { item.roof.lowHeight = value; })} /></div><div className="readout"><span>Площадь кровли</span><strong>{formatNumber(roof.netArea)} м²</strong></div></> : null}<button className="button danger-button" onClick={remove}><Trash2 />Удалить пристройку</button></div>;
  }
  if (opening) {
    const garage = opening.type === 'door' && opening.doorType === 'garage';
    const changeDoorType = (value) => commitPlan((next) => {
      const item = (next.openings || []).find((candidate) => candidate.id === opening.id);
      if (!item) return;
      item.doorType = value;
      if (value === 'garage') {
        if (item.width < 1.5) item.width = 2.5;
        if (item.height < 2.1) item.height = 2.2;
      }
      Object.assign(item, projectOpeningToWall(item, { x: item.x, y: item.y }, next, { lockDoorType: true }));
    });
    return <div className="inspector-form"><h3>{opening.type === 'window' ? 'Окно' : garage ? 'Гаражные ворота' : 'Дверь'}</h3><div className="form-grid"><NumberField label="Ширина" value={opening.width * 1000} suffix="мм" step={10} onChange={(value) => update('openings', (item) => { item.width = value / 1000; })} /><NumberField label="Высота" value={opening.height * 1000} suffix="мм" step={10} onChange={(value) => update('openings', (item) => { item.height = value / 1000; })} /></div>{opening.type === 'door' ? <><SelectField label="Тип" value={opening.doorType || (opening.outer ? 'entrance' : 'interior')} onChange={changeDoorType} options={[{ value: 'entrance', label: 'Входная' }, { value: 'interior', label: 'Межкомнатная' }, { value: 'garage', label: 'Гаражные ворота' }]} />{garage ? <SelectField label="Открывание ворот" value={opening.swing || 'in'} onChange={(value) => update('openings', (item) => { item.swing = value; })} options={[{ value: 'in', label: 'Внутрь' }, { value: 'out', label: 'Наружу' }]} /> : <div className="form-grid"><SelectField label="Петли" value={opening.hinge || 'right'} onChange={(value) => update('openings', (item) => { item.hinge = value; })} options={[{ value: 'left', label: 'Слева' }, { value: 'right', label: 'Справа' }]} /><SelectField label="Открывание" value={opening.swing || 'in'} onChange={(value) => update('openings', (item) => { item.swing = value; })} options={[{ value: 'in', label: 'Внутрь' }, { value: 'out', label: 'Наружу' }]} /></div>}</> : null}<p className="inspector-note">Включите «Выбор» и перетащите проём за любую его часть. Окно или дверь прилипнут к ближайшей стене; ворота — только к наружной.</p><button className="button danger-button" onClick={remove}><Trash2 />Удалить</button></div>;
  }
  if (pileRow) {
    const length = Math.hypot(pileRow.x2 - pileRow.x1, pileRow.y2 - pileRow.y1);
    const spacing = length / Math.max(1, (pileRow.count || 2) - 1);
    const alignment = pileRowAlignment(pileRow);
    const alignmentText = alignment.state === 'aligned' ? `Точно ${alignment.axis === 'vertical' ? 'по вертикали' : 'по горизонтали'}` : alignment.state === 'warning' ? `Смещение ${Math.round(alignment.offset * 1000)} мм` : 'Диагональный ряд';
    return <div className="inspector-form"><h3>{pileRow.name}</h3><div className={`pile-alignment-status ${alignment.state}`}>{alignmentText}</div><Field label="Название"><input value={pileRow.name} onChange={(event) => update('pileRows', (item) => { item.name = event.target.value; })} /></Field><div className="form-grid"><NumberField label="Количество свай" value={pileRow.count} suffix="шт" min={2} max={60} step={1} onChange={(value) => update('pileRows', (item) => { item.count = Math.max(2, Math.round(value)); })} /><NumberField label="Желаемый шаг" value={roundCoord(spacing)} suffix="м" min={.3} max={5} step={.1} onChange={(value) => update('pileRows', (item) => { const rowLength = Math.hypot(item.x2 - item.x1, item.y2 - item.y1); item.count = Math.max(2, Math.round(rowLength / Math.max(.3, value)) + 1); })} /></div><div className="readout"><span>Длина ряда</span><strong>{formatNumber(length)} м</strong></div><div className="readout"><span>Фактическое расстояние</span><strong>{formatNumber(spacing)} м</strong></div><p className="inspector-note">Зелёный ряд стоит точно по оси. Красный показывает небольшое случайное смещение; янтарный — диагональный ряд.</p><button className="button danger-button" onClick={remove}><Trash2 />Удалить ряд</button></div>;
  }
  if (bindingLine) {
    const length = Math.hypot(bindingLine.x2 - bindingLine.x1, bindingLine.y2 - bindingLine.y1);
    return <div className="inspector-form"><h3>{bindingLine.name || 'Линия обвязки'}</h3><Field label="Название"><input value={bindingLine.name || ''} onChange={(event) => update('bindingLines', (item) => { item.name = event.target.value; })} /></Field><Toggle label="Учитывать в расчёте" checked={bindingLine.include !== false} onChange={(value) => update('bindingLines', (item) => { item.include = value; })} /><div className="readout"><span>Чистая длина</span><strong>{formatNumber(length)} м</strong></div><p className="inspector-note">Линию можно двигать целиком, а зелёные концы — перетаскивать по узлам. Закупка доски округляется по общей длине до заготовок 6 м.</p><button className="button danger-button" onClick={remove}><Trash2 />Удалить обвязку</button></div>;
  }
  if (wall || dimension) { const item = wall || dimension; return <div className="inspector-form"><h3>{wall ? 'Отдельная стена' : 'Размерная линия'}</h3><div className="readout"><span>Длина</span><strong>{formatNumber(Math.hypot(item.x2 - item.x1, item.y2 - item.y1))} м</strong></div><p className="inspector-note">Линию можно двигать целиком; зелёные концы изменяют длину и направление.</p><button className="button danger-button" onClick={remove}><Trash2 />Удалить</button></div>; }
  if (gap) return <div className="inspector-form"><h3>Разрыв стены</h3><NumberField label="Ширина разрыва" value={gap.width * 1000} suffix="мм" step={50} onChange={(value) => update('wallGaps', (item) => { item.width = value / 1000; })} /><p className="inspector-note">Разрыв можно перетащить на другую стену.</p><button className="button danger-button" onClick={remove}><Trash2 />Удалить разрыв</button></div>;
  if (pile) return <div className="inspector-form"><h3>Отдельная свая</h3><div className="form-grid"><NumberField label="X" value={pile.x} suffix="м" onChange={(value) => update('piles', (item) => { item.x = value; })} /><NumberField label="Y" value={pile.y} suffix="м" onChange={(value) => update('piles', (item) => { item.y = value; })} /></div><button className="button danger-button" onClick={remove}><Trash2 />Удалить сваю</button></div>;
  return <RoomList plan={plan} issues={issues} onSelect={setSelected} />;
}


function PileIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M7 4h10v3H7z"/><path d="M10 7v10l2 3 2-3V7"/><path d="M10.2 16.8h3.6"/></svg>;
}
function PileRowIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 5h18v3H3z"/><path d="M7 8v8l1 3 1-3V8"/><path d="M11 8v8l1 3 1-3V8"/><path d="M16 8v8l1 3 1-3V8"/></svg>;
}
function RoofMarkIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 15 10 8l3 3"/><path d="M7 17 12 11l7 6"/><path d="M15 8h3v4"/></svg>;
}

const MOBILE_TOOLS = [
  ['room', 'Комната', SquareDashed], ['polygon', 'Свободная', Pentagon], ['wall', 'Перегородка', BrickWall],
  ['gap', 'Разрыв', Scissors], ['window', 'Окно', PanelsTopLeft], ['door', 'Дверь', DoorOpen],
  ['dimension', 'Размер', Ruler], ['pile', 'Свая', PileIcon], ['pileRow', 'Ряд свай', PileRowIcon],
  ['autoPiles', 'Автосваи', Sparkles], ['bindingLine', 'Обвязка', Layers3],
  ['terrace', 'Терраса', Fence], ['porch', 'Крыльцо', HousePlus]
];

const roundDisplay = (value) => Math.round((Number(value) || 0) * 100) / 100;

function MobileStepper({ label, value, onMinus, onPlus, suffix = 'м' }) {
  const display = suffix === 'шт' ? Math.round(Number(value) || 0) : roundDisplay(value).toFixed(2);
  return <div className="mobile-plan-stepper"><span>{label}</span><div><button type="button" onClick={onMinus} aria-label={`Уменьшить ${label}`}><Minus /></button><strong>{display} {suffix}</strong><button type="button" onClick={onPlus} aria-label={`Увеличить ${label}`}><Plus /></button></div></div>;
}

function MobileSelectionAdjuster({ plan, selected, commitPlan, setSelected, metrics, foundation, sheetMode, setSheetMode }) {
  const swipeStartRef = useRef(null);
  const [nudgePos, setNudgePos] = useState({ right: 18, top: 44 });
  const nudgeDragRef = useRef(null);
  const nudgeRepeatRef = useRef({ timeout: null, interval: null });
  const get = (key) => (plan[key] || []).find((item) => item.id === selected?.id);
  const update = (key, mutate) => commitPlan((next) => { const item = (next[key] || []).find((candidate) => candidate.id === selected?.id); if (item) mutate(item); });
  const room = selected?.type === 'room' ? get('rooms') : null;
  const opening = selected?.type === 'opening' ? get('openings') : null;
  const platform = selected?.type === 'platform' ? get('platforms') : null;
  const wall = selected?.type === 'wall' ? get('walls') : null;
  const binding = selected?.type === 'bindingLine' ? get('bindingLines') : null;
  const dimension = selected?.type === 'dimension' ? get('dimensions') : null;
  const pileRow = selected?.type === 'pileRow' ? get('pileRows') : null;
  const pile = selected?.type === 'pile' ? get('piles') : null;
  const gap = selected?.type === 'gap' ? get('wallGaps') : null;
  const step = .1;

  const keyForSelection = () => selected?.type === 'room' ? 'rooms' : selected?.type === 'platform' ? 'platforms' : selected?.type === 'opening' ? 'openings' : selected?.type === 'wall' ? 'walls' : selected?.type === 'dimension' ? 'dimensions' : selected?.type === 'pileRow' ? 'pileRows' : selected?.type === 'bindingLine' ? 'bindingLines' : selected?.type === 'gap' ? 'wallGaps' : 'piles';
  const deleteSelected = () => {
    if (!selected) return;
    const key = keyForSelection();
    commitPlan((next) => { next[key] = (next[key] || []).filter((item) => item.id !== selected.id); });
    setSelected(null); setSheetMode('peek');
  };

  const resizeRoom = (axis, delta) => {
    if (!room) return;
    update('rooms', (item) => {
      const old = boundsOf(roomPoints(item)); const target = Math.max(.5, (axis === 'w' ? old.w : old.h) + delta);
      const sx = axis === 'w' ? target / Math.max(.1, old.w) : 1; const sy = axis === 'h' ? target / Math.max(.1, old.h) : 1;
      item.points = roomPoints(item).map((point) => ({ x: roundCoord(old.x + (point.x - old.x) * sx), y: roundCoord(old.y + (point.y - old.y) * sy) }));
      Object.assign(item, boundsOf(item.points));
    });
  };
  const resizeLine = (key, delta) => update(key, (line) => {
    const dx = line.x2 - line.x1; const dy = line.y2 - line.y1; const len = Math.max(.01, Math.hypot(dx, dy)); const next = Math.max(.1, len + delta);
    line.x2 = roundCoord(line.x1 + dx / len * next); line.y2 = roundCoord(line.y1 + dy / len * next);
  });
  const moveRoomExact = (next, item, dx, dy) => {
    const wall = Number(next.wallThickness) || 0.174;
    const moved = roomPoints(item).map((point) => ({ x: point.x + dx, y: point.y + dy }));
    let shifted = moved;
    const b = boundsOf(moved);
    const minX = wall; const minY = wall; const maxX = next.house.w - wall; const maxY = next.house.h - wall;
    const shiftX = b.x < minX ? minX - b.x : b.x2 > maxX ? maxX - b.x2 : 0;
    const shiftY = b.y < minY ? minY - b.y : b.y2 > maxY ? maxY - b.y2 : 0;
    if (shiftX || shiftY) shifted = moved.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY }));
    const snapAxes = collectSnapAxes(next, item.id);
    const bb = boundsOf(shifted);
    const snapped = snapPoint({ x: bb.x, y: bb.y }, snapAxes);
    const closeX = Math.abs(snapped.x - bb.x) <= 0.12 ? snapped.x - bb.x : 0;
    const closeY = Math.abs(snapped.y - bb.y) <= 0.12 ? snapped.y - bb.y : 0;
    item.points = shifted.map((point) => ({ x: roundCoord(point.x + closeX), y: roundCoord(point.y + closeY) }));
    Object.assign(item, boundsOf(item.points));
  };
  const nudgeSelected = (dx, dy) => commitPlan((next) => {
    if (!selected) return;
    if (selected.type === 'room') { const item = (next.rooms || []).find((candidate) => candidate.id === selected.id); if (item) moveRoomExact(next, item, dx, dy); return; }
    if (selected.type === 'opening') { const item = (next.openings || []).find((candidate) => candidate.id === selected.id); if (!item) return; const target = { x: roundCoord(item.x + dx), y: roundCoord(item.y + dy) }; Object.assign(item, projectOpeningToWall(item, target, next, { lockDoorType: item.doorType === 'garage' })); return; }
    if (selected.type === 'platform') { const item = (next.platforms || []).find((candidate) => candidate.id === selected.id); if (item) { item.x = roundCoord(item.x + dx); item.y = roundCoord(item.y + dy); Object.assign(item, normalizeTerracePlatform(item)); Object.assign(item, snapPlatformToHouse(item, next.house)); } return; }
    if (selected.type === 'pile' || selected.type === 'gap') { const key = selected.type === 'pile' ? 'piles' : 'wallGaps'; const item = (next[key] || []).find((candidate) => candidate.id === selected.id); if (item) { item.x = roundCoord(item.x + dx); item.y = roundCoord(item.y + dy); } return; }
    const key = selected.type === 'wall' ? 'walls' : selected.type === 'bindingLine' ? 'bindingLines' : selected.type === 'dimension' ? 'dimensions' : selected.type === 'pileRow' ? 'pileRows' : null;
    if (key) { const item = (next[key] || []).find((candidate) => candidate.id === selected.id); if (item) { item.x1 = roundCoord(item.x1 + dx); item.y1 = roundCoord(item.y1 + dy); item.x2 = roundCoord(item.x2 + dx); item.y2 = roundCoord(item.y2 + dy); } }
  });
  const stopNudgeRepeat = () => {
    window.clearTimeout(nudgeRepeatRef.current.timeout); window.clearInterval(nudgeRepeatRef.current.interval);
    nudgeRepeatRef.current = { timeout: null, interval: null };
  };
  const startNudge = (dx, dy) => (event) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId);
    stopNudgeRepeat(); nudgeSelected(dx, dy);
    nudgeRepeatRef.current.timeout = window.setTimeout(() => {
      nudgeRepeatRef.current.interval = window.setInterval(() => nudgeSelected(dx, dy), 120);
    }, 420);
  };

  let title = 'План дома'; let subtitle = `${formatNumber(metrics?.floorArea || plan.house.w*plan.house.h)} м²`;
  let controls = null; let detail = null;
  if (room) {
    const b = boundsOf(roomPoints(room)); const area = polygonArea(roomPoints(room)); title = room.name || 'Комната'; subtitle = `${formatNumber(area)} м² · ${formatNumber(b.w)} × ${formatNumber(b.h)} м`;
    controls = <><label className="mobile-room-name"><span>Название</span><input value={room.name || ''} placeholder="Комната" onChange={(event) => update('rooms', (i) => { i.name = event.target.value || 'Комната'; })} /></label><MobileStepper label="Ширина" value={b.w} onMinus={() => resizeRoom('w', -step)} onPlus={() => resizeRoom('w', step)} /><MobileStepper label="Длина" value={b.h} onMinus={() => resizeRoom('h', -step)} onPlus={() => resizeRoom('h', step)} /></>;
    detail = <div className="mobile-object-facts"><span>Площадь <b>{formatNumber(area)} м²</b></span><span>X / Y <b>{formatNumber(b.x)} / {formatNumber(b.y)} м</b></span><span>Потолок <b>{room.ceilingMode === 'open-rafter' ? 'второй свет' : 'обычный'}</b></span></div>;
  } else if (opening) {
    title = opening.type === 'window' ? 'Окно' : opening.doorType === 'interior' ? 'Межкомнатная дверь' : opening.doorType === 'garage' ? 'Ворота' : 'Входная дверь';
    subtitle = `${formatNumber(opening.width)} × ${formatNumber(opening.height)} м`;
    controls = <><MobileStepper label="Ширина" value={opening.width} onMinus={() => update('openings', (i) => { i.width = Math.max(.3, roundCoord(i.width-step)); })} onPlus={() => update('openings', (i) => { i.width = roundCoord(i.width+step); })} /><MobileStepper label="Высота" value={opening.height} onMinus={() => update('openings', (i) => { i.height = Math.max(.5, roundCoord(i.height-step)); })} onPlus={() => update('openings', (i) => { i.height = roundCoord(i.height+step); })} /></>;
    detail = opening.type === 'door' ? <div className="mobile-choice-grid"><label><span>Петли</span><select value={opening.hinge || 'right'} onChange={(e)=>update('openings',(i)=>{i.hinge=e.target.value})}><option value="left">Слева</option><option value="right">Справа</option></select></label><label><span>Открывание</span><select value={opening.swing || 'in'} onChange={(e)=>update('openings',(i)=>{i.swing=e.target.value})}><option value="in">Внутрь</option><option value="out">Наружу</option></select></label></div> : null;
  } else if (platform) {
    title = platform.kind === 'porch' ? 'Крыльцо' : 'Терраса'; subtitle = `${formatNumber(platform.w*platform.h)} м² · ${formatNumber(platform.w)} × ${formatNumber(platform.h)} м`;
    controls = <><MobileStepper label="Ширина" value={platform.w} onMinus={() => update('platforms', (i)=>{i.w=Math.max(.5,roundCoord(i.w-step));})} onPlus={() => update('platforms',(i)=>{i.w=roundCoord(i.w+step);})}/><MobileStepper label="Длина" value={platform.h} onMinus={() => update('platforms',(i)=>{i.h=Math.max(.5,roundCoord(i.h-step));})} onPlus={() => update('platforms',(i)=>{i.h=roundCoord(i.h+step);})}/></>;
    detail = <div className="mobile-choice-grid"><label><span>Сторона ступеней</span><select value={platform.stairSide || 'bottom'} onChange={(e)=>update('platforms',(i)=>{i.stairSide=e.target.value})}><option value="top">Сверху</option><option value="right">Справа</option><option value="bottom">Снизу</option><option value="left">Слева</option></select></label><label><span>Ступеней</span><select value={platform.steps ?? 3} onChange={(e)=>update('platforms',(i)=>{i.steps=Math.max(0,Number(e.target.value)||0)})}>{[0,1,2,3,4,5].map(v=><option key={v} value={v}>{v}</option>)}</select></label></div>;
  } else if (wall || binding || dimension || pileRow) {
    const item = wall || binding || dimension || pileRow; const key = wall ? 'walls' : binding ? 'bindingLines' : dimension ? 'dimensions' : 'pileRows';
    const length = Math.hypot(item.x2-item.x1,item.y2-item.y1); title = wall ? 'Перегородка' : binding ? 'Обвязка' : dimension ? 'Размер' : 'Ряд свай'; subtitle = pileRow ? `${Math.round(pileRow.count || 2)} свай · ${formatNumber(length)} м` : `${formatNumber(length)} м`;
    controls = pileRow ? <><MobileStepper label="Количество свай" value={pileRow.count || 2} suffix="шт" onMinus={()=>update('pileRows',(i)=>{i.count=Math.max(2,Math.round(i.count||2)-1)})} onPlus={()=>update('pileRows',(i)=>{i.count=Math.min(40,Math.round(i.count||2)+1)})}/><MobileStepper label="Длина ряда" value={length} onMinus={() => resizeLine(key,-step)} onPlus={() => resizeLine(key,step)} /></> : <MobileStepper label="Длина" value={length} onMinus={() => resizeLine(key,-step)} onPlus={() => resizeLine(key,step)} />;
  } else if (gap) { title='Разрыв стены'; subtitle=`${formatNumber(gap.width)} м`; controls=<MobileStepper label="Ширина" value={gap.width} onMinus={()=>update('wallGaps',(i)=>{i.width=Math.max(.1,roundCoord(i.width-step));})} onPlus={()=>update('wallGaps',(i)=>{i.width=roundCoord(i.width+step);})}/>; }
  else if (pile) { title='Свая'; subtitle=`X ${formatNumber(pile.x)} · Y ${formatNumber(pile.y)} м`; }

  const canNudge = Boolean(selected && (room || opening || wall || binding || dimension || pileRow || platform || pile || gap));
  const beginSwipe = (event) => { swipeStartRef.current = event.clientY; event.currentTarget.setPointerCapture?.(event.pointerId); };
  const endSwipe = (event) => {
    if (swipeStartRef.current == null) return;
    const delta = event.clientY - swipeStartRef.current; swipeStartRef.current = null;
    const order = ['peek','compact','full']; let index = order.indexOf(sheetMode);
    if (delta < -28) index = Math.min(2,index+1);
    if (delta > 28) index = Math.max(0,index-1);
    setSheetMode(order[index]);
  };
  const homeFacts = <div className="mobile-house-summary-grid">
    <span>Дом <b>{formatNumber(plan.house.w)} × {formatNumber(plan.house.h)} м</b></span>
    <span>Площадь <b>{formatNumber(metrics?.floorArea || plan.house.w*plan.house.h)} м²</b></span>
    <span>Комнат <b>{(plan.rooms||[]).length}</b></span>
    <span>Перегородки <b>{formatNumber(metrics?.partitionLength || 0)} м</b></span>
    <span>Сваи <b>{foundation?.totalPiles || 0} шт</b></span>
    <span>Обвязка <b>{formatNumber(foundation?.bindingLength || 0)} м</b></span>
  </div>;

  const dragNudgeStart = (event) => { event.preventDefault(); nudgeDragRef.current={x:event.clientX,y:event.clientY,start:{...nudgePos}}; event.currentTarget.setPointerCapture?.(event.pointerId); };
  const dragNudgeMove = (event) => { if(!nudgeDragRef.current) return; const dx=event.clientX-nudgeDragRef.current.x, dy=event.clientY-nudgeDragRef.current.y; setNudgePos({right:Math.max(4,nudgeDragRef.current.start.right-dx),top:Math.max(18,Math.min(78,nudgeDragRef.current.start.top+dy/window.innerHeight*100))}); };
  const dragNudgeEnd = () => { nudgeDragRef.current=null; };

  return <>
    <section className={`mobile-selection-sheet mode-${sheetMode} ${selected ? 'has-selection' : 'no-selection'}`}>
      <button className="mobile-sheet-swipe-handle" type="button" onPointerDown={beginSwipe} onPointerUp={endSwipe} onClick={() => setSheetMode(sheetMode==='peek'?'compact':sheetMode==='compact'?'full':'compact')}>
        <span className="mobile-sheet-grabber"/><div className="mobile-sheet-peek-copy"><strong>{title}</strong><small>{subtitle}</small></div>
      </button>
      {sheetMode !== 'peek' ? <div className="mobile-sheet-body">
        {selected ? <><header><div><strong>{title}</strong><small>{subtitle}</small></div><button type="button" onClick={()=>{setSelected(null);setSheetMode('peek')}}><X/></button></header><div className="mobile-stepper-grid">{controls}</div>{detail}<div className="mobile-selection-actions"><button className="mobile-delete-selection" type="button" onClick={deleteSelected}><Trash2/>Удалить</button></div></> : <><header><div><strong>Параметры дома</strong><small>Размер меняет весь план пропорционально</small></div></header><div className="mobile-stepper-grid"><MobileStepper label="Ширина дома" value={plan.house.w} onMinus={()=>commitPlan((next)=>scalePlanToHouse(next,Math.max(3,next.house.w-.1),next.house.h))} onPlus={()=>commitPlan((next)=>scalePlanToHouse(next,next.house.w+.1,next.house.h))}/><MobileStepper label="Длина дома" value={plan.house.h} onMinus={()=>commitPlan((next)=>scalePlanToHouse(next,next.house.w,Math.max(3,next.house.h-.1)))} onPlus={()=>commitPlan((next)=>scalePlanToHouse(next,next.house.w,next.house.h+.1))}/></div>{homeFacts}</>}
        {sheetMode === 'full' ? <div className="mobile-sheet-full">
          {selected ? <><div className="mobile-full-section-title">Подробные параметры</div><div className="mobile-selection-inspector"><Inspector plan={plan} selected={selected} commitPlan={commitPlan} issues={[]} setSelected={setSelected}/></div></> :
          <><div className="mobile-full-section-title">Геометрия проекта</div><div className="mobile-house-summary-grid extended"><span>Высота стен <b>{formatNumber(plan.wallHeight)} м</b></span><span>Наружная стена <b>{Math.round((plan.wallThickness||0)*1000)} мм</b></span><span>Перегородка <b>{Math.round((plan.partitionThickness||0)*1000)} мм</b></span><span>Размеры <b>{plan.showDimensions!==false?'вкл':'выкл'}</b></span><span>Сваи <b>{plan.showPiles!==false?'вкл':'выкл'}</b></span><span>Обвязка <b>{plan.showBinding!==false?'вкл':'выкл'}</b></span></div></>}
        </div> : null}
      </div> : null}
    </section>
    {canNudge ? <div className="mobile-room-nudge nudge-floating" style={{right:nudgePos.right,top:`${nudgePos.top}%`}}>
      <button className="up" type="button" onPointerDown={startNudge(0,-step)} onPointerUp={stopNudgeRepeat} onPointerCancel={stopNudgeRepeat} onPointerLeave={stopNudgeRepeat}>↑</button>
      <button className="left" type="button" onPointerDown={startNudge(-step,0)} onPointerUp={stopNudgeRepeat} onPointerCancel={stopNudgeRepeat} onPointerLeave={stopNudgeRepeat}>←</button>
      <button className="center" type="button" onPointerDown={dragNudgeStart} onPointerMove={dragNudgeMove} onPointerUp={dragNudgeEnd} onPointerCancel={dragNudgeEnd} aria-label="Перетащить блок стрелок"><span>•</span></button>
      <button className="right" type="button" onPointerDown={startNudge(step,0)} onPointerUp={stopNudgeRepeat} onPointerCancel={stopNudgeRepeat} onPointerLeave={stopNudgeRepeat}>→</button>
      <button className="down" type="button" onPointerDown={startNudge(0,step)} onPointerUp={stopNudgeRepeat} onPointerCancel={stopNudgeRepeat} onPointerLeave={stopNudgeRepeat}>↓</button>
    </div> : null}
  </>;
}
export default function PlanScreen({ onNavigate }) {
  const { project, commit, undo, redo, canUndo, canRedo } = useProject();
  const [tool, setTool] = useState('select');
  const [selected, setSelected] = useState(null);
  const [polygonDraft, setPolygonDraft] = useState([]);
  const [viewportZoom, setViewportZoom] = useState(() => Math.max(35, Math.min(2000, Number(project?.plan?.zoom) || 100)));
  const [viewportPan, setViewportPan] = useState({ x: 0, y: 0 });
  const [bindingSetupOpen, setBindingSetupOpen] = useState(false);
  const [autoPileSetupOpen, setAutoPileSetupOpen] = useState(false);
  const [autoPileColumns, setAutoPileColumns] = useState(() => Math.max(2, Number(project?.settings?.piles?.autoGridColumns) || 5));
  const [autoPileRows, setAutoPileRows] = useState(() => Math.max(2, Number(project?.settings?.piles?.autoGridRows) || 6));
  const [bindingVerticalRows, setBindingVerticalRows] = useState(() => Math.max(2, Number(project?.settings?.piles?.autoBindingVerticalRows) || 4));
  const [bindingHorizontalRows, setBindingHorizontalRows] = useState(() => Math.max(2, Number(project?.settings?.piles?.autoBindingHorizontalRows) || 5));
  const [gridVisible, setGridVisible] = useState(true);
  const [sheetMode, setSheetMode] = useState('peek');
  const [toolRailCollapsed, setToolRailCollapsed] = useState(false);
  const toolRailSwipeRef = useRef(null);
  const [transferStatus, setTransferStatus] = useState('План автоматически сохраняется вместе с проектом');
  const planFileRef = useRef(null);
  const [customSketches, setCustomSketches] = useState(getStoredSketches);
  const [sketchId, setSketchId] = useState('photo-plan');
  const plan = project.plan;
  const commitPlan = useCallback((mutate) => commit((next) => { mutate(next.plan); return next; }), [commit]);
  const metrics = useMemo(() => calculatePlanMetrics(plan), [plan]);
  const foundation = useMemo(() => calculateFoundation(plan, project.settings.piles), [plan, project.settings.piles]);
  const issues = useMemo(() => planIssues(plan), [plan]);
  const sketches = useMemo(() => [
    { id: 'photo-plan', name: 'План с фото', plan: createDefaultPlan() },
    { id: 'compact', name: 'Компактный · 10 × 7 м', plan: createCompactPlan() },
    { id: 'empty', name: 'Новый чистый план', plan: createEmptyPlan() }, ...customSketches
  ], [customSketches]);
  const selectTool = (id) => { setTool(id); if (id !== 'polygon') setPolygonDraft([]); if (id === 'bindingLine' && plan.showBinding === false) commitPlan((next) => { next.showBinding = true; }); };
  const handleCreated = useCallback((selection) => { setSelected(selection); setSheetMode('compact'); setTool('select'); setPolygonDraft([]); }, []);
  const handleSelected = useCallback((selection) => { setSelected(selection); setSheetMode('peek'); }, []);
  const finishPolygon = () => {
    if (polygonDraft.length < 3 || polygonArea(polygonDraft) < .25) return;
    const id = uid('room'); commitPlan((next) => next.rooms.push(withRoomBounds({ id, name: `Комната ${next.rooms.length + 1}`, points: polygonDraft, include: true, bearing: false, ceilingMode: 'flat' })));
    setPolygonDraft([]); setSelected({ type: 'room', id }); setTool('select');
  };
  const loadSketch = () => {
    const sketch = sketches.find((item) => item.id === sketchId); if (!sketch) return;
    if (!window.confirm(`Загрузить «${sketch.name}»? Текущий план можно вернуть кнопкой «Отменить».`)) return;
    commit((next) => { next.plan = structuredClone(sketch.plan); return next; }); setSelected(null); setTool('select'); setPolygonDraft([]);
  };
  const newPlan = () => {
    commit((next) => { next.plan = createEmptyPlan(); return next; });
    setSketchId('empty'); setSelected(null); setTool('select'); setPolygonDraft([]);
  };
  const saveSketch = () => {
    const name = window.prompt('Название эскиза:', `Эскиз ${customSketches.length + 1}`)?.trim(); if (!name) return;
    const updated = [{ id: uid('sketch'), name, plan: structuredClone(plan) }, ...customSketches].slice(0, 20);
    localStorage.setItem(SKETCHES_KEY, JSON.stringify(updated)); setCustomSketches(updated);
  };
  const savePlanFile = () => {
    downloadPlanTransfer(project);
    setTransferStatus('Файл плана сохранён на компьютер');
  };
  const openPlanFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      commit((next) => applyPlanTransfer(next, payload));
      setSelected(null); setTool('select'); setPolygonDraft([]);
      setTransferStatus(`Загружен план: ${file.name}. Калькуляторы пересчитаны.`);
    } catch (error) {
      setTransferStatus(`Не удалось открыть план: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  };
  const sharePlanFile = async () => {
    try {
      const result = await sharePlanTransfer(project);
      setTransferStatus(result === 'shared' ? 'План передан через системное меню' : 'План скачан — отправьте файл коллеге');
    } catch (error) {
      if (error?.name !== 'AbortError') setTransferStatus(`Не удалось поделиться планом: ${error.message}`);
    }
  };
  const autoPiles = () => {
    const columns = Math.max(2, Math.min(24, Math.round(Number(autoPileColumns) || 5)));
    const rows = Math.max(2, Math.min(24, Math.round(Number(autoPileRows) || 6)));
    commit((next) => {
      next.settings.piles.autoGridColumns = columns; next.settings.piles.autoGridRows = rows;
      next.plan.pileRows = generatePileGrid(next.plan, columns, rows);
      next.plan.bindingLines = generateAutoBindingLines(next.plan, columns, rows);
      next.plan.showPiles = true; next.plan.showBinding = true;
      return next;
    });
    setAutoPileSetupOpen(false); setSelected(null); setTool('select');
  };
  const autoBinding = () => {
    const vertical = Math.max(2, Math.min(24, Math.round(Number(bindingVerticalRows) || 4)));
    const horizontal = Math.max(2, Math.min(24, Math.round(Number(bindingHorizontalRows) || 5)));
    commit((next) => {
      next.settings.piles.autoBindingVerticalRows = vertical;
      next.settings.piles.autoBindingHorizontalRows = horizontal;
      next.plan.bindingLines = generateAutoBindingLines(next.plan, vertical, horizontal);
      next.plan.showBinding = true;
      return next;
    });
    setBindingSetupOpen(false); setSelected(null); setTool('select');
  };
  const openVisualMode = (mode) => { sessionStorage.setItem('eft-visual-mode', mode); onNavigate?.('visualization'); };
  useEffect(() => {
    const keydown = (event) => {
      if (event.key === 'Escape') { setPolygonDraft([]); setTool('select'); setSelected(null); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        const key = selected.type === 'room' ? 'rooms' : selected.type === 'platform' ? 'platforms' : selected.type === 'opening' ? 'openings' : selected.type === 'wall' ? 'walls' : selected.type === 'dimension' ? 'dimensions' : selected.type === 'pileRow' ? 'pileRows' : selected.type === 'bindingLine' ? 'bindingLines' : selected.type === 'gap' ? 'wallGaps' : 'piles';
        commitPlan((next) => { next[key] = (next[key] || []).filter((item) => item.id !== selected.id); }); setSelected(null);
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [selected, commitPlan]);
  const toolRailDown = (event) => { toolRailSwipeRef.current = { x: event.clientX, y: event.clientY }; };
  const toolRailUp = (event) => {
    const start = toolRailSwipeRef.current; toolRailSwipeRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x; const dy = event.clientY - start.y;
    if (Math.abs(dx) < Math.abs(dy) || Math.abs(dx) < 28) return;
    if (dx < 0) setToolRailCollapsed(true);
    if (dx > 0) setToolRailCollapsed(false);
  };
  const toolHint = tool === 'select' ? 'Один палец — выбрать/править. Два пальца — только масштаб и перемещение поля.' : tool === 'room' ? 'Коснитесь первого угла и тяните. Край комнаты сам прилипнет к наружной стене, перегородке, узлу или сетке — миллиметры ловить не нужно.' : tool === 'polygon' ? 'Ставьте углы комнаты. Узлы магнитятся к стенам и сетке. После третьей точки нажмите первую точку.' : tool === 'dimension' ? 'Нажмите первую точку, затем вторую. Размер привяжется к узлам и сетке.' : tool === 'pileRow' ? 'Первый конец начинается под пальцем. Второй идёт за пальцем 1:1; возле узла или оси включается магнит.' : tool === 'bindingLine' ? 'Начало и конец идут за пальцем; возле стен и узлов включается магнитная привязка.' : ['window','door','gap','pile'].includes(tool) ? 'Нажмите точное место установки. Проём выбирает ближайшую стену по месту касания.' : 'Рисуйте пальцем. Магнит включается только рядом со стеной, узлом или осью.';
  const mobileEditor = <div className={`mobile-plan-fullscreen ${gridVisible ? '' : 'grid-hidden'}`}>
    <div className="mobile-release-badge" aria-label={`Версия ${MOBILE_RELEASE_LABEL}`}>{MOBILE_RELEASE_LABEL}</div>
    <div className="mobile-plan-top-controls">
      <button className="mobile-float-button" type="button" onClick={() => onNavigate?.('visualization')} aria-label="Выйти из редактора"><ChevronLeft /></button>
      <details className="mobile-project-menu"><summary className="mobile-project-chip"><strong>Дом № {project.meta?.projectNum || '0001'}</strong><ChevronDown /></summary><div className="mobile-project-actions"><label className="mobile-template-picker"><span>Шаблон</span><select value={sketchId} onChange={(event) => setSketchId(event.target.value)}>{sketches.map((sketch) => <option key={sketch.id} value={sketch.id}>{sketch.name}</option>)}</select></label><button type="button" onClick={loadSketch}><PanelsTopLeft />Загрузить шаблон</button><button type="button" onClick={newPlan}><Plus />Новый план</button><button type="button" onClick={savePlanFile}><Download />Сохранить файл</button><button type="button" onClick={() => planFileRef.current?.click()}><Upload />Открыть файл</button><button type="button" onClick={sharePlanFile}><Share2 />Поделиться</button><button type="button" onClick={() => setAutoPileSetupOpen(true)}><Sparkles />Автосваи</button><button type="button" onClick={() => setBindingSetupOpen(true)}><Layers3 />Автообвязка</button><button type="button" onClick={saveSketch}><Save />В эскизы</button></div></details>
      <div className="mobile-zoom-chip"><button type="button" onClick={() => setViewportZoom((z) => Math.max(35,z-25))}><ZoomOut /></button><strong onClick={() => { setViewportZoom(100); setViewportPan({x:0,y:0}); }} title="Сбросить масштаб">{viewportZoom}%</strong><button type="button" onClick={() => setViewportZoom((z) => Math.min(2000,z+25))}><ZoomIn /></button></div>
      <button className={`mobile-grid-chip ${gridVisible ? 'active' : ''}`} type="button" onClick={() => setGridVisible((v) => !v)}><Grid3X3 /><span>Сетка</span></button>
      <div className="mobile-history-chip"><button type="button" onClick={undo} disabled={!canUndo}><Undo2 /></button><button type="button" onClick={redo} disabled={!canRedo}><Redo2 /></button></div>
      <details className="mobile-view-menu"><summary><Layers3 /><span>Вид</span><ChevronDown /></summary><div><button className="active" type="button"><Check />План</button><button type="button" onClick={() => openVisualMode('3d')}><Box />3D</button><button type="button" onClick={() => openVisualMode('frame')}><Hammer />Каркас</button><button type="button" onClick={() => openVisualMode('sip')}><Layers3 />СИП</button><button type="button" onClick={() => openVisualMode('roof')}><Home />Кровля</button><div className="mobile-view-divider">Слои</div><button type="button" className={plan.showPiles !== false ? 'layer-on' : ''} onClick={() => commitPlan((next)=>{next.showPiles = next.showPiles === false;})}>{plan.showPiles !== false ? <Check /> : <Minus />}Сваи</button><button type="button" className={plan.showBinding !== false ? 'layer-on' : ''} onClick={() => commitPlan((next)=>{next.showBinding = next.showBinding === false;})}>{plan.showBinding !== false ? <Check /> : <Minus />}Обвязка</button><button type="button" className={plan.showDimensions !== false ? 'layer-on' : ''} onClick={() => commitPlan((next)=>{next.showDimensions = next.showDimensions === false;})}>{plan.showDimensions !== false ? <Check /> : <Minus />}Размеры</button><button type="button" className={gridVisible ? 'layer-on' : ''} onClick={() => setGridVisible((v)=>!v)}>{gridVisible ? <Check /> : <Minus />}Сетка 1×1 м</button></div></details>
    </div>
    <aside className={`mobile-plan-tools ${toolRailCollapsed ? 'collapsed' : ''}`} onPointerDown={toolRailDown} onPointerUp={toolRailUp}>
      <button className="mobile-tools-peek" type="button" onClick={() => setToolRailCollapsed(false)} aria-label="Показать инструменты"><span>›</span></button>
      <div className="mobile-select-fixed"><button type="button" className={tool==='select'?'active':''} onClick={() => selectTool('select')}><MousePointer2 /><span>Выбор</span></button></div>
      <div className="mobile-tools-scroll">{MOBILE_TOOLS.map(([id,label,Icon]) => <button key={id} type="button" className={`${tool===id?'active ':''}${id==='autoPiles'?'auto-piles-tool':''}`} onClick={() => id === 'autoPiles' ? setAutoPileSetupOpen(true) : selectTool(id)}><Icon /><span>{label}</span></button>)}</div>
      <div className="mobile-delete-fixed"><button type="button" className={tool==='delete'?'active':''} onClick={() => selectTool('delete')}><Trash2 /><span>Удалить</span></button></div>
    </aside>
    <div className="mobile-plan-stage"><PlanCanvas plan={plan} tool={tool} selected={selected} setSelected={setSelected} commitPlan={commitPlan} polygonDraft={polygonDraft} setPolygonDraft={setPolygonDraft} finishPolygon={finishPolygon} issues={issues} viewportZoom={viewportZoom} onViewportZoom={setViewportZoom} viewportPan={viewportPan} onViewportPan={setViewportPan} onCreated={handleCreated} onSelected={handleSelected} /><div className="mobile-pinch-tip">{toolHint}</div></div>
    {autoPileSetupOpen ? <section className="mobile-binding-setup mobile-auto-pile-setup"><div className="mobile-sheet-grabber"/><header><div><strong>Автосваи</strong><small>Сетка свай + автоматическая обвязка</small></div><button type="button" onClick={() => setAutoPileSetupOpen(false)}><X /></button></header><div className="binding-count-grid"><MobileStepper label="Свай по ширине" value={autoPileColumns} suffix="шт" onMinus={() => setAutoPileColumns((v)=>Math.max(2,Math.round(v)-1))} onPlus={() => setAutoPileColumns((v)=>Math.min(24,Math.round(v)+1))}/><MobileStepper label="Свай по длине" value={autoPileRows} suffix="шт" onMinus={() => setAutoPileRows((v)=>Math.max(2,Math.round(v)-1))} onPlus={() => setAutoPileRows((v)=>Math.min(24,Math.round(v)+1))}/></div><div className="auto-pile-preview"><strong>{autoPileColumns} × {autoPileRows}</strong><span>{autoPileColumns*autoPileRows} свай до объединения совпадающих точек</span></div><button className="button primary mobile-binding-apply" type="button" onClick={autoPiles}><Sparkles />Построить сваи и обвязку</button><p>Сетка равномерно распределяется по всему дому: крайние сваи всегда лежат на периметре.</p></section> : null}
    {bindingSetupOpen ? <section className="mobile-binding-setup"><div className="mobile-sheet-grabber"/><header><div><strong>Автообвязка</strong><small>2 ряда = только крайние линии</small></div><button type="button" onClick={() => setBindingSetupOpen(false)}><X /></button></header><div className="binding-count-grid"><MobileStepper label="Вертикальных рядов" value={bindingVerticalRows} suffix="шт" onMinus={() => setBindingVerticalRows((v) => Math.max(2, Math.round(v)-1))} onPlus={() => setBindingVerticalRows((v) => Math.min(24, Math.round(v)+1))} /><MobileStepper label="Горизонтальных рядов" value={bindingHorizontalRows} suffix="шт" onMinus={() => setBindingHorizontalRows((v) => Math.max(2, Math.round(v)-1))} onPlus={() => setBindingHorizontalRows((v) => Math.min(24, Math.round(v)+1))} /></div><button className="button primary mobile-binding-apply" type="button" onClick={autoBinding}><Sparkles />Построить обвязку</button><p>Ряды распределяются равномерно. После построения любую линию можно поправить вручную.</p></section> : null}
    <MobileSelectionAdjuster plan={plan} selected={selected} commitPlan={commitPlan} setSelected={setSelected} metrics={metrics} foundation={foundation} sheetMode={sheetMode} setSheetMode={setSheetMode} />
  </div>;
  return <><div className="mobile-plan-editor-only">{mobileEditor}</div><div className="desktop-plan-editor screen plan-screen-v2"><ScreenHeader title="План дома" description="Новый редактор: каждое действие можно выбрать, изменить, удалить и отменить" actions={<><button className="button primary" onClick={newPlan}><Plus />Новый план</button><button className="button secondary" onClick={savePlanFile}><Download />Сохранить план</button><button className="button secondary" onClick={() => planFileRef.current?.click()}><Upload />Открыть план</button><button className="button secondary" onClick={sharePlanFile}><Share2 />Поделиться</button><input ref={planFileRef} className="visually-hidden" type="file" accept=".eft-plan.json,.eft.json,.json" onChange={openPlanFile} /><button className="button secondary auto-piles-button" onClick={autoPiles}><Sparkles />Автосваи</button><button className="button secondary" onClick={autoBinding}><Layers3 />Автообвязка</button><select className="sketch-select" value={sketchId} onChange={(event) => setSketchId(event.target.value)}>{sketches.map((sketch) => <option key={sketch.id} value={sketch.id}>{sketch.name}</option>)}</select><button className="button secondary" onClick={loadSketch}>Загрузить</button><button className="button secondary" onClick={saveSketch}><Save />В эскизы</button><button className="button ghost" onClick={undo} disabled={!canUndo}><Undo2 />Отменить</button><button className="button ghost" onClick={redo} disabled={!canRedo}><Redo2 />Повторить</button></>} />
    <div className="mobile-plan-commandbar">
      <button type="button" onClick={undo} disabled={!canUndo}><Undo2 /><span>Назад</span></button>
      <button type="button" onClick={redo} disabled={!canRedo}><Redo2 /><span>Вперёд</span></button>
      <button type="button" onClick={() => setAutoPileSetupOpen(true)}><Sparkles /><span>Автосваи</span></button>
      <details><summary><MoreHorizontal /><span>Ещё</span></summary><div className="mobile-plan-more"><button type="button" onClick={newPlan}><Plus />Новый план</button><button type="button" onClick={savePlanFile}><Download />Сохранить план</button><button type="button" onClick={() => planFileRef.current?.click()}><Upload />Открыть план</button><button type="button" onClick={sharePlanFile}><Share2 />Поделиться</button><button type="button" onClick={autoBinding}><Layers3 />Автообвязка</button><button type="button" onClick={saveSketch}><Save />В эскизы</button></div></details>
    </div>
    <div className="plan-transfer-status"><Share2 /><span>{transferStatus}</span><small>Файл плана не содержит прайс-лист, данные заказчика и ручные правки сметы.</small></div>
    <div className="plan-status-bar"><div className="plan-house-fields"><NumberField label="Габарит X" value={plan.house.w} suffix="м" min={3} onChange={(value) => commitPlan((next) => { scalePlanToHouse(next, value, next.house.h); })} /><NumberField label="Габарит Y" value={plan.house.h} suffix="м" min={3} onChange={(value) => commitPlan((next) => { scalePlanToHouse(next, next.house.w, value); })} /><NumberField label="Высота стен" value={plan.wallHeight} suffix="м" min={2} onChange={(value) => commitPlan((next) => { next.wallHeight = value; })} /></div><div className="plan-view-switches"><Toggle label="Сваи" checked={plan.showPiles !== false} onChange={(value) => commitPlan((next) => { next.showPiles = value; })} /><Toggle label="Обвязка" checked={plan.showBinding !== false} onChange={(value) => commitPlan((next) => { next.showBinding = value; })} /><Toggle label="Размеры" checked={plan.showDimensions !== false} onChange={(value) => commitPlan((next) => { next.showDimensions = value; })} /></div><div className="zoom-controls"><button className="icon-button" onClick={() => commitPlan((next) => { next.zoom = Math.max(65, (next.zoom || 100) - 10); })}><ZoomOut /></button><strong>{plan.zoom || 100}%</strong><button className="icon-button" onClick={() => commitPlan((next) => { next.zoom = Math.min(180, (next.zoom || 100) + 10); })}><ZoomIn /></button></div></div>
    <div className="planner-shell"><aside className="planner-tools">{TOOLS.map(([id, label, Icon]) => <button key={id} className={tool === id ? 'active' : ''} title={label} onClick={() => selectTool(id)}><Icon /><span>{label}</span></button>)}{tool === 'polygon' && polygonDraft.length ? <div className="polygon-actions"><button className="active" onClick={finishPolygon} disabled={polygonDraft.length < 3}><Save /><span>Замкнуть</span></button><button onClick={() => setPolygonDraft([])}><X /><span>Сброс</span></button></div> : null}</aside><div className="planner-canvas"><PlanCanvas plan={plan} tool={tool} selected={selected} setSelected={setSelected} commitPlan={commitPlan} polygonDraft={polygonDraft} setPolygonDraft={setPolygonDraft} finishPolygon={finishPolygon} issues={issues} /><div className="planner-hint">{toolHint}</div></div><aside className="planner-inspector"><Inspector plan={plan} selected={selected} setSelected={setSelected} commitPlan={commitPlan} issues={issues} /></aside></div>
    <div className="stats-row planner-stats"><Stat label="Пол всего дома" value={`${formatNumber(metrics.floorArea)} м²`} /><Stat label="Перегородки без задвоений" value={`${formatNumber(metrics.partitionLength)} м`} /><Stat label="Наружные стены" value={`${formatNumber(metrics.exteriorWallNetArea)} м²`} /><Stat label="Сваи" value={`${foundation.totalPiles} шт`} /><Stat label="Обвязка" value={`${formatNumber(foundation.bindingLength)} м · ${foundation.boardCount} досок × 6 м`} /><Stat label="Проверка" value={issues.length ? `${issues.length} ошибок` : 'Стыковка верна'} tone={issues.length ? 'danger' : ''} /></div>
  </div></>;
}
