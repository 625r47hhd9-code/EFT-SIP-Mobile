import { useEffect, useMemo, useState } from 'react';
import { Box, Eye, EyeOff, Grid3X3, Layers3, RotateCcw, RotateCw, Triangle, Hammer, MoveUpRight, Check, Settings2, ChevronUp, ChevronDown } from 'lucide-react';
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

function FrameExteriorWall({ side, dims, wallHeight, quarter, faded = false }) {
  const length = wallLength(side, dims.w, dims.h);
  const count = Math.max(2, Math.ceil(length / 0.625));
  const baseA = projectIso(...wallPoint(side, 0, 0.08, dims.w, dims.h), dims, quarter);
  const baseB = projectIso(...wallPoint(side, length, 0.08, dims.w, dims.h), dims, quarter);
  const topA = projectIso(...wallPoint(side, 0, wallHeight - 0.06, dims.w, dims.h), dims, quarter);
  const topB = projectIso(...wallPoint(side, length, wallHeight - 0.06, dims.w, dims.h), dims, quarter);
  return <g className={`frame-exterior-wall ${faded ? 'visual-cut-wall' : ''}`}>
    <line x1={baseA.x} y1={baseA.y} x2={baseB.x} y2={baseB.y} className="frame-wall-plate" />
    <line x1={topA.x} y1={topA.y} x2={topB.x} y2={topB.y} className="frame-wall-plate" />
    {Array.from({length: count + 1}, (_, index) => {
      const along = length * index / count;
      const bottom = projectIso(...wallPoint(side, along, 0, dims.w, dims.h), dims, quarter);
      const top = projectIso(...wallPoint(side, along, wallHeight, dims.w, dims.h), dims, quarter);
      return <line key={index} x1={bottom.x} y1={bottom.y} x2={top.x} y2={top.y} className="frame-wall-stud" />;
    })}
  </g>;
}

function FramePartition({ segment, dims, wallHeight, quarter }) {
  let a; let b;
  if (segment.axis === 'h') { a = [segment.start, segment.fixed]; b = [segment.end, segment.fixed]; }
  else if (segment.axis === 'v') { a = [segment.fixed, segment.start]; b = [segment.fixed, segment.end]; }
  else return null;
  const length = Math.hypot(b[0]-a[0], b[1]-a[1]);
  const count = Math.max(1, Math.ceil(length / 0.6));
  const pointAt = (ratio, z) => projectIso(a[0] + (b[0]-a[0])*ratio, a[1] + (b[1]-a[1])*ratio, z, dims, quarter);
  const p1 = pointAt(0, 0.05); const p2 = pointAt(1, 0.05);
  const t1 = pointAt(0, wallHeight-.05); const t2 = pointAt(1, wallHeight-.05);
  return <g className="frame-partition">
    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="frame-wall-plate internal" />
    <line x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} className="frame-wall-plate internal" />
    {Array.from({length:count+1},(_,i)=>{ const q1=pointAt(i/count,0); const q2=pointAt(i/count,wallHeight); return <line key={i} x1={q1.x} y1={q1.y} x2={q2.x} y2={q2.y} className="frame-wall-stud internal"/>; })}
  </g>;
}

function InternalOpeningShape({ opening, dims, wallHeight, quarter }) {
  const width=Math.max(.5,Number(opening.width)||.8);
  const height=Math.min(wallHeight,Math.max(1.8,Number(opening.height)||2.05));
  const x=Number(opening.x)||0, y=Number(opening.y)||0;
  const horizontal=opening.orientation==='h';
  const a=horizontal?[x-width/2,y,0]:[x,y-width/2,0];
  const b=horizontal?[x+width/2,y,0]:[x,y+width/2,0];
  const poly=face([a,b,[b[0],b[1],height],[a[0],a[1],height]],dims,quarter);
  return <polygon points={pointsAttr(poly)} className="iso-door internal-door-3d"/>;
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

function PartitionFace({ segment, dims, wallHeight, quarter, thickness = 0.1 }) {
  let x1; let y1; let x2; let y2;
  if (segment.axis === 'h') {
    x1 = segment.start; x2 = segment.end; y1 = y2 = segment.fixed;
  } else if (segment.axis === 'v') {
    y1 = segment.start; y2 = segment.end; x1 = x2 = segment.fixed;
  } else return null;
  const half = Math.max(0.035, Number(thickness) || 0.1) / 2;
  const corners = segment.axis === 'h'
    ? [[x1,y1-half],[x2,y2-half],[x2,y2+half],[x1,y1+half]]
    : [[x1-half,y1],[x1+half,y1],[x2+half,y2],[x2-half,y2]];
  const top = corners.map(([x,y]) => projectIso(x,y,wallHeight,dims,quarter));
  const sideA = face([[...corners[0],0],[...corners[1],0],[...corners[1],wallHeight],[...corners[0],wallHeight]],dims,quarter);
  const sideB = face([[...corners[2],0],[...corners[3],0],[...corners[3],wallHeight],[...corners[2],wallHeight]],dims,quarter);
  return <g className="partition-volume">
    <polygon points={pointsAttr(sideA)} className="partition-wall volume-face" />
    <polygon points={pointsAttr(sideB)} className="partition-wall volume-face secondary" />
    <polygon points={pointsAttr(top)} className="partition-wall-top" />
  </g>;
}

function GableFaces({ dims, wallHeight, roof, quarter }) {
  if ((roof.shape || 'gable') === 'flat') return null;
  const ridge = Math.max(0.2, Number(roof.ridgeHeight) || 1.8);
  const z = wallHeight + ridge;
  const alongWidth = roof.ridgeDirection === 'width';
  const faces = alongWidth
    ? [
        face([[0,0,wallHeight],[dims.w,0,wallHeight],[dims.w/2,0,z]],dims,quarter),
        face([[dims.w,dims.h,wallHeight],[0,dims.h,wallHeight],[dims.w/2,dims.h,z]],dims,quarter)
      ]
    : [
        face([[0,0,wallHeight],[0,dims.h,wallHeight],[0,dims.h/2,z]],dims,quarter),
        face([[dims.w,dims.h,wallHeight],[dims.w,0,wallHeight],[dims.w,dims.h/2,z]],dims,quarter)
      ];
  return <g className="gable-faces">{faces.map((poly,index)=><polygon key={index} points={pointsAttr(poly)} className="gable-face" />)}</g>;
}

function RoofGeometry({ dims, wallHeight, roof, quarter }) {
  const ridge = Math.max(0.2, Number(roof.ridgeHeight) || 1.8);
  const eave = Math.max(0, Number(roof.eaveOverhang) || 0);
  const gable = Math.max(0, Number(roof.gableOverhang) || 0);
  const alongWidth = roof.ridgeDirection === 'width';
  if ((roof.shape || 'gable') === 'flat') {
    const plane = face([[-gable,-eave,wallHeight+.12],[dims.w+gable,-eave,wallHeight+.12],[dims.w+gable,dims.h+eave,wallHeight+.12],[-gable,dims.h+eave,wallHeight+.12]],dims,quarter);
    return <polygon points={pointsAttr(plane)} className="iso-roof" />;
  }
  const ridgeZ = wallHeight + ridge;
  let planes; let ridgeA; let ridgeB;
  if (alongWidth) {
    const west = face([[-eave,-gable,wallHeight],[-eave,dims.h+gable,wallHeight],[dims.w/2,dims.h+gable,ridgeZ],[dims.w/2,-gable,ridgeZ]],dims,quarter);
    const east = face([[dims.w+eave,dims.h+gable,wallHeight],[dims.w+eave,-gable,wallHeight],[dims.w/2,-gable,ridgeZ],[dims.w/2,dims.h+gable,ridgeZ]],dims,quarter);
    planes=[west,east].sort((a,b)=>avgDepth(a)-avgDepth(b));
    ridgeA=projectIso(dims.w/2,-gable,ridgeZ,dims,quarter);
    ridgeB=projectIso(dims.w/2,dims.h+gable,ridgeZ,dims,quarter);
  } else {
    const north = face([[-gable,-eave,wallHeight],[dims.w+gable,-eave,wallHeight],[dims.w+gable,dims.h/2,ridgeZ],[-gable,dims.h/2,ridgeZ]],dims,quarter);
    const south = face([[dims.w+gable,dims.h+eave,wallHeight],[-gable,dims.h+eave,wallHeight],[-gable,dims.h/2,ridgeZ],[dims.w+gable,dims.h/2,ridgeZ]],dims,quarter);
    planes=[north,south].sort((a,b)=>avgDepth(a)-avgDepth(b));
    ridgeA=projectIso(-gable,dims.h/2,ridgeZ,dims,quarter);
    ridgeB=projectIso(dims.w+gable,dims.h/2,ridgeZ,dims,quarter);
  }
  return <g className="roof-volume">{planes.map((poly,i)=><polygon key={i} points={pointsAttr(poly)} className="iso-roof"/>)}<line x1={ridgeA.x} y1={ridgeA.y} x2={ridgeB.x} y2={ridgeB.y} className="roof-ridge-line"/></g>;
}

function Platform3D({ platform, dims, quarter }) {
  const x=Number(platform.x)||0, y=Number(platform.y)||0, w=Math.max(.2,Number(platform.w)||1), h=Math.max(.2,Number(platform.h)||1);
  const topZ=.12;
  const top=face([[x,y,topZ],[x+w,y,topZ],[x+w,y+h,topZ],[x,y+h,topZ]],dims,quarter);
  const edge1=face([[x,y,0],[x+w,y,0],[x+w,y,topZ],[x,y,topZ]],dims,quarter);
  const edge2=face([[x+w,y,0],[x+w,y+h,0],[x+w,y+h,topZ],[x+w,y,topZ]],dims,quarter);
  const steps=[];
  const count=Math.max(0,Math.min(8,Math.round(Number(platform.steps)||0)));
  const side=platform.stairSide||'bottom';
  const stairWidth=Math.min(side==='top'||side==='bottom'?w:h,Math.max(.6,Number(platform.stairWidth)||1.2));
  const tread=Math.max(.18,Number(platform.tread)||.3);
  for(let i=0;i<count;i+=1){
    const depth=tread*(i+1); const z=Math.max(.02,topZ*(count-i)/(count+1));
    let sx=x+(w-stairWidth)/2, sy=y+h;
    let sw=stairWidth, sh=tread;
    if(side==='top'){ sy=y-depth; }
    if(side==='bottom'){ sy=y+h+depth-tread; }
    if(side==='left'){ sx=x-depth; sy=y+(h-stairWidth)/2; sw=tread; sh=stairWidth; }
    if(side==='right'){ sx=x+w+depth-tread; sy=y+(h-stairWidth)/2; sw=tread; sh=stairWidth; }
    const poly=face([[sx,sy,z],[sx+sw,sy,z],[sx+sw,sy+sh,z],[sx,sy+sh,z]],dims,quarter);
    steps.push(<polygon key={i} points={pointsAttr(poly)} className="platform-step-3d"/>);
  }
  return <g className={`platform-3d ${platform.kind==='porch'?'porch':'terrace'}`}>
    <polygon points={pointsAttr(edge1)} className="platform-edge-3d"/><polygon points={pointsAttr(edge2)} className="platform-edge-3d"/>
    <polygon points={pointsAttr(top)} className="platform-deck-3d"/>{steps}
  </g>;
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
  return <g className="visual-foundation">{piles.map((pile,index)=>{const a=projectIso(pile.x,pile.y,-.35,dims,quarter),b=projectIso(pile.x,pile.y,0,dims,quarter);return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>})}</g>;
}

function RoomSurface({ room, index, dims, quarter }) {
  const points = roomPoints(room);
  const floorPoly = points.map((point) => projectIso(Number(point.x) || 0, Number(point.y) || 0, 0.025, dims, quarter));
  const roomBounds = boundsOf(points);
  const labelPoint = projectIso(roomBounds.x + roomBounds.w / 2, roomBounds.y + roomBounds.h / 2, 0.03, dims, quarter);
  const area = polygonArea(points);
  return <g><polygon points={pointsAttr(floorPoly)} className="visual-room-surface" style={{ '--room-fill': ROOM_SWATCHES[index % ROOM_SWATCHES.length] }} /><text x={labelPoint.x} y={labelPoint.y - 2} className="visual-room-label">{room.name}</text><text x={labelPoint.x} y={labelPoint.y + 13} className="visual-room-area">{formatNumber(area)} м²</text></g>;
}

function HouseModel({ project, calculation, roofHidden, quarter, cutaway, layers }) {
  const plan = project.plan;
  const dims = { w: Number(plan.house?.w) || 8, h: Number(plan.house?.h) || 10 };
  const wallHeight = Number(plan.wallHeight) || 2.5;
  const roof = project.settings?.roof || {};
  const floor = face([[0,0,0],[dims.w,0,0],[dims.w,dims.h,0],[0,dims.h,0]],dims,quarter);
  const exterior=['north','east','south','west'].map(side=>({side,depth:avgDepth(face(sideFace(side,dims.w,dims.h,wallHeight),dims,quarter))})).sort((a,b)=>a.depth-b.depth);
  const partitions=unifiedWallSegments(plan).filter(segment=>segment.axis!=='d');
  const exteriorOpenings=(plan.openings||[]).filter(opening=>opening.outer!==false);
  const interiorOpenings=(plan.openings||[]).filter(opening=>opening.type==='door'&&opening.outer===false);
  const roomPolys=(plan.rooms||[]).filter(room=>room.include!==false);
  const platforms=(plan.platforms||[]).filter(item=>item.include!==false);
  const partitionThickness=Number(plan.partitionThickness)||.1;
  const exteriorSystem=project.settings.visual?.exteriorWallSystem||'sip';
  const interiorSystem=project.settings.visual?.interiorWallSystem||'frame';
  return <svg className="house-visual-svg engineering-model polished-house-model m790-house" viewBox="0 0 780 570" role="img" aria-label="Трёхмерная визуализация дома">
    <defs>
      <pattern id="osbWallTexture" width="34" height="24" patternUnits="userSpaceOnUse"><rect width="34" height="24" fill="#f2e6cf"/><path d="M2 6l9-3m-4 12l12-5m2-7l8 4m-10 10l11-3M1 21l7-5M25 2l6 3" stroke="#c6a370" strokeWidth="1.1" opacity=".34"/></pattern>
      <pattern id="floorWoodTexture" width="46" height="18" patternUnits="userSpaceOnUse"><rect width="46" height="18" fill="#ebdfca"/><path d="M0 1h46M0 17h46M15 1v16M34 1v16" stroke="#c8b89d" strokeWidth=".8" opacity=".55"/></pattern>
      <linearGradient id="roofGradientVisual" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#625ba0"/><stop offset="1" stopColor="#343254"/></linearGradient>
      <filter id="modelShadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="16" stdDeviation="14" floodOpacity=".14"/></filter>
    </defs>
    <rect x="0" y="0" width="780" height="570" className="visual-backdrop"/><ellipse cx="392" cy="505" rx="276" ry="39" className="visual-ground-shadow"/>
    <g filter="url(#modelShadow)">
      {layers.foundation?<FoundationLayer plan={plan} dims={dims} quarter={quarter}/>:null}
      {platforms.map(platform=><Platform3D key={platform.id} platform={platform} dims={dims} quarter={quarter}/>)}
      <polygon points={pointsAttr(floor)} className="visual-floor polished-floor"/><FloorGrid dims={dims} quarter={quarter}/>
      {roomPolys.map((room,index)=><RoomSurface key={room.id} room={room} index={index} dims={dims} quarter={quarter}/>)}
      {layers.walls?exterior.map((item,index)=>exteriorSystem==='frame'
        ? <FrameExteriorWall key={item.side} side={item.side} dims={dims} wallHeight={wallHeight} quarter={quarter} faded={cutaway&&index>=2}/>
        : <ExteriorWall key={item.side} side={item.side} dims={dims} wallHeight={wallHeight} quarter={quarter} faded={cutaway&&index>=2}/>):null}
      {layers.partitions?partitions.map((segment,index)=>interiorSystem==='frame'
        ? <FramePartition key={index} segment={segment} dims={dims} wallHeight={wallHeight} quarter={quarter}/>
        : <PartitionFace key={index} segment={segment} dims={dims} wallHeight={wallHeight} quarter={quarter} thickness={Math.max(partitionThickness,.124)}/>):null}
      {layers.openings?exteriorOpenings.map(opening=><OpeningShape key={opening.id} opening={opening} dims={dims} wallHeight={wallHeight} quarter={quarter}/>):null}
      {layers.openings?interiorOpenings.map(opening=><InternalOpeningShape key={opening.id} opening={opening} dims={dims} wallHeight={wallHeight} quarter={quarter}/>):null}
      {layers.roof&&!roofHidden?<><GableFaces dims={dims} wallHeight={wallHeight} roof={roof} quarter={quarter}/><RoofGeometry dims={dims} wallHeight={wallHeight} roof={roof} quarter={quarter}/></>:null}
    </g>
    <text x="24" y="32" className="visual-caption">{formatNumber(dims.w)} × {formatNumber(dims.h)} м · стены {formatNumber(wallHeight)} м</text>
    <text x="24" y="53" className="visual-subcaption">Главная 3D-модель · {roof.shape==='flat'?'плоская':'двускатная'} кровля</text>
    <text x="24" y="73" className="visual-subcaption">Комнат: {roomPolys.length} · стены: {exteriorSystem==='frame'?'каркас':'СИП'} / {interiorSystem==='frame'?'каркас':'СИП'} · кровля: {formatNumber(calculation?.roof?.totalArea||0)} м²</text>
  </svg>;
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
  return <svg viewBox="0 0 130 64" className="rafter-mini" aria-hidden="true">
    <rect x="16" y="48" width="98" height="6" rx="2" className="mini-sip" />
    <line x1="8" y1="49" x2="65" y2="10"/><line x1="65" y1="10" x2="122" y2="49"/>
    {type==='hanging'?<line x1="38" y1="31" x2="92" y2="31"/>:null}
    {type==='layered'?<><line x1="65" y1="12" x2="65" y2="48"/><line x1="65" y1="47" x2="39" y2="31"/><line x1="65" y1="47" x2="91" y2="31"/></>:null}
    {type==='truss'?<><line x1="18" y1="48" x2="112" y2="48"/><line x1="65" y1="10" x2="65" y2="48"/><line x1="65" y1="48" x2="39" y2="31"/><line x1="65" y1="48" x2="91" y2="31"/></>:null}
  </svg>;
}

function StepControl({ label, value, note, onDown, onUp, disabled = false }) {
  return <div className={`roof-step-control ${disabled?'disabled':''}`}>
    <div><span>{label}</span><strong>{value}</strong>{note?<small>{note}</small>:null}</div>
    <div className="roof-step-buttons">
      <button type="button" disabled={disabled} onClick={onDown} aria-label={`${label}: уменьшить`}><ChevronDown/></button>
      <button type="button" disabled={disabled} onClick={onUp} aria-label={`${label}: увеличить`}><ChevronUp/></button>
    </div>
  </div>;
}

function RafterSectionDrawing({ system, section, span, ridgeHeight, ceilingThickness, eaveOverhang }) {
  const W=820,H=470;
  const lx=160,rx=660,cx=410;
  const ceilingTop=360, ceilingH=30;
  const rise=clamp(130+ridgeHeight*25,145,205), ry=ceilingTop-rise;
  const eavePx=clamp(22+(Number(eaveOverhang)||0)*30,26,52);
  const le=lx-eavePx,re=rx+eavePx;
  const lm={x:(le+cx)/2,y:(ceilingTop+ry)/2};
  const rm={x:(re+cx)/2,y:(ceilingTop+ry)/2};
  const midY=ry+(ceilingTop-ry)*.52;
  const beamY=ceilingTop-11;
  return <svg viewBox={`0 0 ${W} ${H}`} className="rafter-section-svg m791-rafter-section" role="img" aria-label="Схема стропильной системы">
    <defs>
      <pattern id="sipCore791" width="18" height="12" patternUnits="userSpaceOnUse"><rect width="18" height="12" fill="#f3f0e7"/><path d="M0 6h18" stroke="#ded7c6"/><circle cx="4" cy="3" r="1" fill="#c9b99d"/><circle cx="13" cy="9" r="1" fill="#c9b99d"/></pattern>
    </defs>
    <rect width={W} height={H} className="rafter-paper"/>
    <g className="rafter-building-base">
      <rect x={lx-16} y={ceilingTop} width={rx-lx+32} height={ceilingH} className="sip-ceiling-panel"/>
      <rect x={lx-22} y={ceilingTop-2} width="10" height={ceilingH+4} className="sip-end-board"/>
      <rect x={rx+12} y={ceilingTop-2} width="10" height={ceilingH+4} className="sip-end-board"/>
      <rect x={lx-30} y={ceilingTop-68} width="58" height="68" className="sip-wall-support"/>
      <rect x={rx-28} y={ceilingTop-68} width="58" height="68" className="sip-wall-support"/>
      <rect x={lx-30} y={ceilingTop-16} width="60" height="14" rx="3" className="mauerlat-beam"/>
      <rect x={rx-30} y={ceilingTop-16} width="60" height="14" rx="3" className="mauerlat-beam"/>
    </g>
    <g className="rafter-timber">
      <line x1={le} y1={ceilingTop+2} x2={cx} y2={ry}/><line x1={cx} y1={ry} x2={re} y2={ceilingTop+2}/>
      {system==='hanging'?<line x1={lm.x-12} y1={midY} x2={rm.x+12} y2={midY} className="collar-beam"/>:null}
      {system==='layered'?<>
        <rect x={cx-34} y={beamY} width="68" height="13" rx="2" className="central-mauerlat"/>
        <line x1={cx} y1={beamY} x2={cx} y2={ry} className="central-post"/>
        <line x1={cx} y1={beamY} x2={lm.x} y2={lm.y} className="brace"/>
        <line x1={cx} y1={beamY} x2={rm.x} y2={rm.y} className="brace"/>
        <rect x={cx-10} y={ry-8} width="20" height="16" rx="2" className="ridge-beam-node"/>
      </>:null}
      {system==='truss'?<>
        <line x1={lx} y1={ceilingTop-7} x2={rx} y2={ceilingTop-7} className="bottom-chord"/>
        <line x1={cx} y1={ceilingTop-7} x2={cx} y2={ry} className="central-post"/>
        <line x1={cx} y1={ceilingTop-7} x2={lm.x} y2={lm.y} className="brace"/>
        <line x1={cx} y1={ceilingTop-7} x2={rm.x} y2={rm.y} className="brace"/>
      </>:null}
    </g>
    <g className="rafter-overhang-visual"><line x1={le} y1={ceilingTop+16} x2={lx} y2={ceilingTop+16}/><line x1={rx} y1={ceilingTop+16} x2={re} y2={ceilingTop+16}/></g>
    <line x1={lx} y1="428" x2={rx} y2="428" className="rafter-dim"/><text x={cx} y="449" className="rafter-dim-text">{formatNumber(span)} м</text>
    <line x1="730" y1={ceilingTop} x2="730" y2={ry} className="rafter-dim"/><text x="748" y={(ceilingTop+ry)/2} className="rafter-dim-text vertical">{formatNumber(ridgeHeight)} м</text>
  </svg>;
}

function LathDrawing({ roof, calculation }) {
  const step=Math.max(.1,Number(roof.lathStep)||.35);
  const count=clamp(Math.round(3.5/step),5,18);
  const rafters=10;
  return <svg viewBox="0 0 820 400" className="lath-plan-svg m791-lath-plan" role="img" aria-label="Схема обрешётки сверху">
    <defs><pattern id="roofGrid791" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#eef1e8" strokeWidth="1"/></pattern></defs>
    <rect width="820" height="400" fill="url(#roofGrid791)"/><rect x="72" y="54" width="676" height="286" rx="4" className="lath-roof-outline"/>
    <line x1="410" y1="54" x2="410" y2="340" className="lath-ridge"/>
    {Array.from({length:rafters},(_,i)=>{const x=94+i*(632/(rafters-1));return <line key={`r-${i}`} x1={x} y1="64" x2={x} y2="330" className="lath-rafter-under"/>})}
    {Array.from({length:count},(_,i)=>{const y=72+i*(250/Math.max(1,count-1));return <line key={`l-${i}`} x1="82" y1={y} x2="738" y2={y} className="lath-board-line"/>})}
  </svg>;
}

function RafterSystemEditor({ project, calculation, setRoof }) {
  const roof=project.settings?.roof||{};
  const structure=calculation.roof.rafterStructure||{};
  const automatic=(roof.structureMode||'auto')==='auto';
  const system=structure.system||roof.rafterSystem||'hanging';
  const section=structure.section||roof.rafterSection||'50x150';
  const step=Number(structure.step)||Number(roof.rafterStep)||.6;
  const ridgeAlongWidth=roof.ridgeDirection==='width';
  const span=Math.max(1,Number(ridgeAlongWidth?project.plan.house?.w:project.plan.house?.h)||8);
  const ridgeHeight=Math.max(.4,Number(roof.ridgeHeight)||1.8);
  const hasBearingSupport=(project.plan.rooms||[]).some(room=>room.include!==false&&room.bearing)||(project.plan.walls||[]).some(wall=>wall.bearing);
  const setSystem=(value)=>{setRoof('structureMode','manual');setRoof('rafterSystem',value)};
  const stepValue=(delta)=>{setRoof('structureMode','manual');setRoof('rafterStep',clamp(Math.round((step+delta)*100)/100,.3,1.2))};
  const ridgeValue=(delta)=>setRoof('ridgeHeight',clamp(Math.round((ridgeHeight+delta)*100)/100,.4,5));
  const rafterSections=['50x100','50x150','50x200'];
  const cycleSection=(dir)=>{setRoof('structureMode','manual');const i=Math.max(0,rafterSections.indexOf(section));setRoof('rafterSection',rafterSections[(i+dir+rafterSections.length)%rafterSections.length])};
  const lathSection=roof.lathSection==='25x150'?'25x150':'25x100';
  const cycleLath=(dir)=>{const items=['25x100','25x150'];const i=items.indexOf(lathSection);setRoof('lathSection',items[(i+dir+items.length)%items.length])};
  const lathStep=Math.max(.1,Number(roof.lathStep)||.35);
  const setLathStep=(delta)=>setRoof('lathStep',clamp(Math.round((lathStep+delta)*100)/100,.1,1.2));
  return <div className="rafter-editor-shell m791-roof-editor">
    <Panel title="Стропильная система" description="Сначала выбирается несущая схема, затем шаг, сечение и высота. Схема ниже обновляется сразу.">
      <div className="rafter-auto-row"><button type="button" className={automatic?'active':''} onClick={()=>setRoof('structureMode',automatic?'manual':'auto')}><Settings2/><span><strong>Автоматический подбор</strong><small>{automatic?'до 8 м — висячая; больше 8 м или с внутренней опорой — наслонная':'ручная настройка'}</small></span><i className={automatic?'on':''}/></button></div>
      <div className="form-grid two rafter-select-row">
        <SelectField label="Система" value={system} onChange={setSystem} options={[{value:'hanging',label:'Висячая'},{value:'layered',label:'Наслонная'},{value:'truss',label:'Ферма'}]} />
        <SelectField label="Направление конька" value={roof.ridgeDirection||'length'} onChange={(value)=>setRoof('ridgeDirection',value)} options={[{value:'length',label:'Вдоль длины дома'},{value:'width',label:'Вдоль ширины дома'}]} />
      </div>
      <div className="roof-step-grid">
        <StepControl label="Шаг стропил / ферм" value={`${Math.round(step*1000)} мм`} onDown={()=>stepValue(-.05)} onUp={()=>stepValue(.05)}/>
        <StepControl label="Сечение стропил" value={`${section.replace('x','×')} мм`} onDown={()=>cycleSection(-1)} onUp={()=>cycleSection(1)}/>
        <StepControl label="Высота конька" value={`${formatNumber(ridgeHeight)} м`} onDown={()=>ridgeValue(-.1)} onUp={()=>ridgeValue(.1)}/>
        <div className="roof-step-control static"><div><span>Внутренняя несущая опора</span><strong>{hasBearingSupport?'Есть':'Нет'}</strong></div></div>
      </div>
    </Panel>
    <article className="rafter-drawing-card clean-rafter-drawing"><header><div><h2>{system==='truss'?'Стропильная ферма':system==='layered'?'Наслонная система':'Висячая система'}</h2><p>Чистая конструктивная схема без служебных подписей на рисунке</p></div><strong>{section.replace('x','×')} мм · {Math.round(step*1000)} мм</strong></header><RafterSectionDrawing system={system} section={section} span={span} ridgeHeight={ridgeHeight} ceilingThickness={project.settings.sip.ceilingThickness} eaveOverhang={roof.eaveOverhang}/></article>

    <Panel title="Обрешётка" description="Идёт следующим блоком по ходу прокрутки. Настройка шага и доски без переключения плиток.">
      <div className="roof-step-grid">
        <StepControl label="Шаг обрешётки" value={`${Math.round(lathStep*1000)} мм`} onDown={()=>setLathStep(-.05)} onUp={()=>setLathStep(.05)}/>
        <StepControl label="Доска обрешётки" value={`${lathSection.replace('x','×')} мм`} onDown={()=>cycleLath(-1)} onUp={()=>cycleLath(1)}/>
        <div className="roof-step-control static"><div><span>Закупка</span><strong>{calculation.roof.mainLathBoardCount||0} шт × 6 м</strong></div></div>
        <div className="roof-step-control static"><div><span>Расчётная длина</span><strong>{formatNumber(calculation.roof.mainLathRequiredLength||0)} м.п.</strong></div></div>
      </div>
    </Panel>
    <article className="rafter-drawing-card lath-card clean-lath-drawing"><header><div><h2>Схема обрешётки</h2><p>Вид сверху: стропила подложкой, обрешётка поперёк ската</p></div><strong>{lathSection.replace('x','×')} мм · {Math.round(lathStep*1000)} мм</strong></header><LathDrawing roof={roof} calculation={calculation}/></article>
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
  useEffect(() => {
    const handler = (event) => {
      const nextMode = event.detail;
      if (MODES.some((item) => item[0] === nextMode)) setModeState(nextMode);
    };
    window.addEventListener('eft-visual-mode', handler);
    return () => window.removeEventListener('eft-visual-mode', handler);
  }, []);
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
        <span className="eyebrow">Инженерная визуализация · 7.9.1</span>
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
