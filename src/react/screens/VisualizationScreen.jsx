import { useMemo, useState } from 'react';
import { Box, Grid3X3, Hammer, Home, Layers3, RotateCcw } from 'lucide-react';
import { useProject } from '../state/ProjectContext.jsx';
import { calculateProject } from '../calculations/estimate-engine.js';

const MODES = [
  ['3d', '3D', Box],
  ['plan', 'План', Grid3X3],
  ['frame', 'Каркас', Hammer],
  ['sip', 'СИП', Layers3],
  ['roof', 'Кровля', Home]
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function projectIso(x, y, z, dims) {
  const sx = 32;
  const sy = 18;
  const sz = 34;
  const cx = 390;
  const cy = 300;
  const nx = x - dims.w / 2;
  const ny = y - dims.h / 2;
  return { x: cx + (nx - ny) * sx, y: cy + (nx + ny) * sy - z * sz };
}

function pts(points) {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function HouseIso({ project, calculation, mode }) {
  const plan = project.plan;
  const w = Number(plan.house?.w) || 8;
  const h = Number(plan.house?.h) || 10;
  const wallHeight = Number(plan.wallHeight) || 2.5;
  const roof = project.settings?.roof || {};
  const ridgeHeight = roof.shape === 'flat' ? 0.15 : Number(roof.ridgeHeight) || 1.8;
  const dims = { w, h };
  const floor = [projectIso(0,0,0,dims), projectIso(w,0,0,dims), projectIso(w,h,0,dims), projectIso(0,h,0,dims)];
  const top = [projectIso(0,0,wallHeight,dims), projectIso(w,0,wallHeight,dims), projectIso(w,h,wallHeight,dims), projectIso(0,h,wallHeight,dims)];
  const front = [floor[2], floor[3], top[3], top[2]];
  const right = [floor[1], floor[2], top[2], top[1]];
  const leftRoofEdge = projectIso(0, h/2, wallHeight + ridgeHeight, dims);
  const rightRoofEdge = projectIso(w, h/2, wallHeight + ridgeHeight, dims);
  const roofFront = [top[3], top[2], rightRoofEdge, leftRoofEdge];
  const roofBack = [top[0], top[1], rightRoofEdge, leftRoofEdge];
  const roofVisible = mode !== 'frame';
  const wallOpacity = mode === 'frame' ? .10 : mode === 'roof' ? .18 : .96;
  const sipStep = clamp(1.25, .5, 2);
  const panelLines = [];
  if (mode === 'sip') {
    for (let x = sipStep; x < w; x += sipStep) {
      panelLines.push([projectIso(x,h,0,dims), projectIso(x,h,wallHeight,dims)]);
    }
    for (let y = sipStep; y < h; y += sipStep) {
      panelLines.push([projectIso(w,y,0,dims), projectIso(w,y,wallHeight,dims)]);
    }
  }
  const terraceShapes = (plan.platforms || []).filter((p) => p.include !== false).map((platform) => {
    const x = Number(platform.x) || 0; const y = Number(platform.y) || 0;
    const pw = Number(platform.w) || 0; const ph = Number(platform.h) || 0;
    return [projectIso(x,y,.05,dims), projectIso(x+pw,y,.05,dims), projectIso(x+pw,y+ph,.05,dims), projectIso(x,y+ph,.05,dims)];
  });
  const openings = (plan.openings || []).filter((o) => o.outer !== false);
  const frontOpenings = openings.filter((o) => o.orientation === 'h' && Number(o.y) >= h * .7);
  const rightOpenings = openings.filter((o) => o.orientation === 'v' && Number(o.x) >= w * .7);
  const openingPolygon = (o, side) => {
    const ow = Number(o.width) || .9;
    const oh = Number(o.height) || (o.type === 'window' ? 1.35 : 2.05);
    const sill = o.type === 'window' ? Math.max(.75, Number(o.sillHeight) || .9) : 0;
    if (side === 'front') {
      const cx = clamp(Number(o.x) || w/2, 0, w);
      return [projectIso(cx-ow/2,h,sill,dims), projectIso(cx+ow/2,h,sill,dims), projectIso(cx+ow/2,h,sill+oh,dims), projectIso(cx-ow/2,h,sill+oh,dims)];
    }
    const cy = clamp(Number(o.y) || h/2, 0, h);
    return [projectIso(w,cy-ow/2,sill,dims), projectIso(w,cy+ow/2,sill,dims), projectIso(w,cy+ow/2,sill+oh,dims), projectIso(w,cy-ow/2,sill+oh,dims)];
  };

  return <svg className="house-visual-svg" viewBox="0 0 780 560" role="img" aria-label="Параметрическая модель дома">
    <defs>
      <linearGradient id="wallFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff"/><stop offset="1" stopColor="#ebe8ff"/></linearGradient>
      <linearGradient id="wallRight" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f7f5ff"/><stop offset="1" stopColor="#ddd8fb"/></linearGradient>
      <linearGradient id="roofFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6257a7"/><stop offset="1" stopColor="#3f376f"/></linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="14" floodOpacity=".16"/></filter>
    </defs>
    <ellipse cx="390" cy="460" rx="250" ry="46" fill="rgba(41,35,74,.08)" />
    <g filter="url(#shadow)">
      {terraceShapes.map((shape, i) => <polygon key={i} points={pts(shape)} className="iso-terrace" />)}
      <polygon points={pts(front)} fill="url(#wallFront)" opacity={wallOpacity} className="iso-wall" />
      <polygon points={pts(right)} fill="url(#wallRight)" opacity={wallOpacity} className="iso-wall" />
      {mode === 'frame' ? <>
        {[0, .25, .5, .75, 1].map((ratio) => {
          const x = w * ratio; return <line key={`f${ratio}`} x1={projectIso(x,h,0,dims).x} y1={projectIso(x,h,0,dims).y} x2={projectIso(x,h,wallHeight,dims).x} y2={projectIso(x,h,wallHeight,dims).y} className="frame-line"/>;
        })}
        {[0, .2, .4, .6, .8, 1].map((ratio) => {
          const y = h * ratio; return <line key={`r${ratio}`} x1={projectIso(w,y,0,dims).x} y1={projectIso(w,y,0,dims).y} x2={projectIso(w,y,wallHeight,dims).x} y2={projectIso(w,y,wallHeight,dims).y} className="frame-line"/>;
        })}
      </> : null}
      {panelLines.map(([a,b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="sip-panel-line"/>)}
      {mode !== 'roof' && frontOpenings.map((o) => <polygon key={o.id} points={pts(openingPolygon(o,'front'))} className={o.type === 'window' ? 'iso-window' : 'iso-door'} />)}
      {mode !== 'roof' && rightOpenings.map((o) => <polygon key={o.id} points={pts(openingPolygon(o,'right'))} className={o.type === 'window' ? 'iso-window' : 'iso-door'} />)}
      {roofVisible && roof.shape !== 'flat' ? <>
        <polygon points={pts(roofBack)} fill="#756bb5" className="iso-roof" />
        <polygon points={pts(roofFront)} fill="url(#roofFill)" className="iso-roof" />
        <line x1={leftRoofEdge.x} y1={leftRoofEdge.y} x2={rightRoofEdge.x} y2={rightRoofEdge.y} className="ridge-line" />
      </> : roofVisible ? <polygon points={pts(top)} fill="url(#roofFill)" className="iso-roof" /> : null}
    </g>
    <text x="26" y="34" className="visual-caption">{w.toFixed(2)} × {h.toFixed(2)} м · стены {wallHeight.toFixed(2)} м</text>
    <text x="26" y="56" className="visual-subcaption">{roof.shape === 'flat' ? 'Плоская кровля' : 'Двускатная кровля'} · площадь дома {(w*h).toFixed(1)} м²</text>
    {mode === 'sip' ? <text x="26" y="80" className="visual-subcaption">Расчёт: {calculation?.sip?.cutting?.reduce((s,r)=>s+(Number(r.panels)||0),0) || 0} СИП-панелей</text> : null}
  </svg>;
}

function PlanPreview({ project }) {
  const plan = project.plan;
  const w = Number(plan.house?.w) || 8; const h = Number(plan.house?.h) || 10;
  const pad = 26; const width = 720; const height = 500;
  const scale = Math.min((width-pad*2)/w, (height-pad*2)/h);
  const p = (x,y) => ({ x: pad + x*scale, y: pad + y*scale });
  return <svg className="house-visual-svg plan-preview-svg" viewBox={`0 0 ${width} ${height}`}>
    <rect x={pad} y={pad} width={w*scale} height={h*scale} className="plan-house" />
    {(plan.rooms || []).filter((r)=>r.include !== false).map((room) => {
      const roomPts = (room.points || []).map((pt)=>p(Number(pt.x)||0, Number(pt.y)||0));
      return <g key={room.id}><polygon points={pts(roomPts)} className="plan-room"/><text x={roomPts.reduce((s,q)=>s+q.x,0)/Math.max(1,roomPts.length)} y={roomPts.reduce((s,q)=>s+q.y,0)/Math.max(1,roomPts.length)} className="plan-label">{room.name}</text></g>;
    })}
    {(plan.platforms || []).filter((x)=>x.include !== false).map((platform) => <rect key={platform.id} x={p(platform.x,platform.y).x} y={p(platform.x,platform.y).y} width={(Number(platform.w)||0)*scale} height={(Number(platform.h)||0)*scale} className="plan-platform" />)}
  </svg>;
}

export default function VisualizationScreen() {
  const { project } = useProject();
  const [mode, setMode] = useState('3d');
  const calculation = useMemo(() => calculateProject(project), [project]);
  const totalPanels = calculation?.sip?.cutting?.reduce((sum, row) => sum + (Number(row.panels) || 0), 0) || 0;
  return <section className="visualization-screen">
    <div className="mobile-screen-intro visualization-intro">
      <span className="eyebrow">Визуализация проекта</span>
      <h1>Дом из вашего плана</h1>
      <p>Эскиз строится автоматически из геометрии проекта. Измените план, высоту, кровлю или проёмы — модель обновится вместе с расчётом.</p>
    </div>
    <nav className="visual-mode-tabs" aria-label="Режим визуализации">
      {MODES.map(([id,label,Icon]) => <button key={id} className={mode===id?'active':''} onClick={()=>setMode(id)}><Icon/><span>{label}</span></button>)}
    </nav>
    <article className="visual-stage">
      {mode === 'plan' ? <PlanPreview project={project}/> : <HouseIso project={project} calculation={calculation} mode={mode}/>} 
      <div className="visual-stage-badge"><RotateCcw/><span>Параметрическая модель</span></div>
    </article>
    <div className="visual-facts">
      <article><span>Площадь</span><strong>{((Number(project.plan.house?.w)||0)*(Number(project.plan.house?.h)||0)).toFixed(1)} м²</strong></article>
      <article><span>СИП</span><strong>{totalPanels} шт.</strong></article>
      <article><span>Кровля</span><strong>{Number(calculation?.roof?.totalArea || calculation?.roof?.geometry?.totalSlopeArea || 0).toFixed(1)} м²</strong></article>
    </div>
    <div className="visual-note"><strong>Что уже связано</strong><span>Габариты дома, высота стен, тип и высота кровли, помещения, наружные проёмы, террасы и данные СИП-расчёта.</span></div>
  </section>;
}
