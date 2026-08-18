import { useMemo, useState } from 'react';
import { Box, Eye, EyeOff, Grid3X3, Hammer, Home, Layers3, RotateCcw, RotateCw, SlidersHorizontal } from 'lucide-react';
import { useProject } from '../state/ProjectContext.jsx';
import { calculateProject } from '../calculations/estimate-engine.js';
import { roomPoints, unifiedWallSegments } from '../planner/geometry.js';

const MODES = [
  ['3d', '3D', Box], ['plan', 'План', Grid3X3], ['frame', 'Каркас', Hammer], ['sip', 'СИП', Layers3], ['roof', 'Кровля', Home]
];
const FRAME_TYPES = [
  ['thermal', 'Термобрус', '95×145 мм'],
  ['board-pack', 'Пакет клеёных досок', '95×145 мм'],
  ['solid', 'Брус естественной влажности', '100×150 мм']
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pointsAttr = (points) => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

function rotateXY(x, y, dims, quarter) {
  const dx = x - dims.w / 2; const dy = y - dims.h / 2;
  if (quarter === 1) return { x: -dy, y: dx };
  if (quarter === 2) return { x: -dx, y: -dy };
  if (quarter === 3) return { x: dy, y: -dx };
  return { x: dx, y: dy };
}
function projectIso(x, y, z, dims, quarter = 0) {
  const q = rotateXY(x, y, dims, quarter);
  const sx = 29; const sy = 16.5; const sz = 36;
  return { x: 390 + (q.x - q.y) * sx, y: 330 + (q.x + q.y) * sy - z * sz, depth: q.x + q.y };
}
function face(points3d, dims, quarter) { return points3d.map(([x,y,z]) => projectIso(x,y,z,dims,quarter)); }
function avgDepth(points) { return points.reduce((s,p)=>s+(p.depth||0),0)/Math.max(1,points.length); }
function sideFace(side, w, h, wallHeight) {
  if (side === 'north') return [[0,0,0],[w,0,0],[w,0,wallHeight],[0,0,wallHeight]];
  if (side === 'south') return [[w,h,0],[0,h,0],[0,h,wallHeight],[w,h,wallHeight]];
  if (side === 'west') return [[0,h,0],[0,0,0],[0,0,wallHeight],[0,h,wallHeight]];
  return [[w,0,0],[w,h,0],[w,h,wallHeight],[w,0,wallHeight]];
}
function wallPoint(side, along, z, w, h) {
  if (side === 'north') return [along,0,z];
  if (side === 'south') return [w-along,h,z];
  if (side === 'west') return [0,h-along,z];
  return [w,along,z];
}
function wallLength(side,w,h){ return side === 'north' || side === 'south' ? w : h; }

function PanelWall({ side, dims, wallHeight, quarter, panelWidth = 1.25, faded = false }) {
  const length = wallLength(side,dims.w,dims.h); const count = Math.max(1,Math.ceil(length/panelWidth));
  return <g className={faded ? 'visual-far-layer' : ''}>{Array.from({length:count},(_,i)=>{
    const a=i*length/count,b=(i+1)*length/count;
    const poly=face([wallPoint(side,a,0,dims.w,dims.h),wallPoint(side,b,0,dims.w,dims.h),wallPoint(side,b,wallHeight,dims.w,dims.h),wallPoint(side,a,wallHeight,dims.w,dims.h)],dims,quarter);
    return <polygon key={`${side}-${i}`} points={pointsAttr(poly)} className={`sip-board sip-board-${i%3}`}/>;
  })}</g>;
}

function FrameWall({ side, dims, wallHeight, quarter, step = .625, faded = false }) {
  const length=wallLength(side,dims.w,dims.h); const count=Math.max(2,Math.ceil(length/step));
  const lines=[];
  for(let i=0;i<=count;i+=1){ const along=Math.min(length,i*length/count); const a=projectIso(...wallPoint(side,along,0,dims.w,dims.h),dims,quarter); const b=projectIso(...wallPoint(side,along,wallHeight,dims.w,dims.h),dims,quarter); lines.push(<line key={`s-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="frame-stud"/>); }
  const b1=projectIso(...wallPoint(side,0,.08,dims.w,dims.h),dims,quarter), b2=projectIso(...wallPoint(side,length,.08,dims.w,dims.h),dims,quarter);
  const t1=projectIso(...wallPoint(side,0,wallHeight-.06,dims.w,dims.h),dims,quarter), t2=projectIso(...wallPoint(side,length,wallHeight-.06,dims.w,dims.h),dims,quarter);
  return <g className={faded ? 'visual-far-layer' : ''}><line x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} className="frame-plate"/><line x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} className="frame-plate"/>{lines}</g>;
}

function OpeningShape({ opening, dims, wallHeight, quarter }) {
  const w=Number(opening.width)||.9, hh=Number(opening.height)||(opening.type==='window'?1.35:2.05), sill=opening.type==='window'?Math.max(.7,Number(opening.sillHeight)||.9):0;
  let side='south', center=Number(opening.x)||dims.w/2;
  if(opening.orientation==='h'){ side=Number(opening.y)<dims.h/2?'north':'south'; center=Number(opening.x)||dims.w/2; }
  else { side=Number(opening.x)<dims.w/2?'west':'east'; center=Number(opening.y)||dims.h/2; }
  const len=wallLength(side,dims.w,dims.h); const a=clamp(center-w/2,0,len), b=clamp(center+w/2,0,len);
  const poly=face([wallPoint(side,a,sill,dims.w,dims.h),wallPoint(side,b,sill,dims.w,dims.h),wallPoint(side,b,Math.min(wallHeight,sill+hh),dims.w,dims.h),wallPoint(side,a,Math.min(wallHeight,sill+hh),dims.w,dims.h)],dims,quarter);
  return <polygon points={pointsAttr(poly)} className={opening.type==='window'?'iso-window':'iso-door'}/>;
}

function PartitionFace({ segment, dims, wallHeight, quarter, mode }) {
  let a,b;
  if(segment.axis==='h'){ a=[segment.start,segment.fixed,0];b=[segment.end,segment.fixed,0]; }
  else if(segment.axis==='v'){ a=[segment.fixed,segment.start,0];b=[segment.fixed,segment.end,0]; }
  else return null;
  const poly=face([a,b,[b[0],b[1],wallHeight],[a[0],a[1],wallHeight]],dims,quarter);
  if(mode==='frame'){
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]); const count=Math.max(1,Math.ceil(len/.625));
    return <g className="partition-frame"><polygon points={pointsAttr(poly)} className="partition-ghost"/>{Array.from({length:count+1},(_,i)=>{ const r=i/count; const x=a[0]+(b[0]-a[0])*r,y=a[1]+(b[1]-a[1])*r; const p1=projectIso(x,y,0,dims,quarter),p2=projectIso(x,y,wallHeight,dims,quarter); return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="frame-stud internal"/>;})}</g>;
  }
  return <polygon points={pointsAttr(poly)} className={mode==='sip'?'partition-sip':'partition-wall'}/>;
}

function RoofGeometry({ dims, wallHeight, roof, quarter, mode }) {
  if(roof.shape==='flat'){
    const p=face([[0,0,wallHeight+.12],[dims.w,0,wallHeight+.12],[dims.w,dims.h,wallHeight+.12],[0,dims.h,wallHeight+.12]],dims,quarter);
    return <polygon points={pointsAttr(p)} className={mode==='sip'?'sip-roof-plane':'iso-roof'}/>;
  }
  const ridge=Number(roof.ridgeHeight)||1.8; const z=wallHeight+ridge;
  const north=face([[0,0,wallHeight],[dims.w,0,wallHeight],[dims.w,dims.h/2,z],[0,dims.h/2,z]],dims,quarter);
  const south=face([[dims.w,dims.h,wallHeight],[0,dims.h,wallHeight],[0,dims.h/2,z],[dims.w,dims.h/2,z]],dims,quarter);
  const planes=[north,south].sort((a,b)=>avgDepth(a)-avgDepth(b));
  return <g>{planes.map((p,i)=><polygon key={i} points={pointsAttr(p)} className={mode==='sip'?'sip-roof-plane':'iso-roof'}/>)}{mode==='frame'?<Rafters dims={dims} wallHeight={wallHeight} ridge={ridge} roof={roof} quarter={quarter}/>:null}</g>;
}
function Rafters({dims,wallHeight,ridge,roof,quarter}){
  const step=Math.max(.3,Number(roof.rafterStep)||.6); const count=Math.max(2,Math.ceil(dims.w/step)); const z=wallHeight+ridge;
  return <g className="rafter-system">{Array.from({length:count+1},(_,i)=>{const x=Math.min(dims.w,i*dims.w/count); const a=projectIso(x,0,wallHeight,dims,quarter),r=projectIso(x,dims.h/2,z,dims,quarter),b=projectIso(x,dims.h,wallHeight,dims,quarter); return <g key={i}><line x1={a.x} y1={a.y} x2={r.x} y2={r.y}/><line x1={r.x} y1={r.y} x2={b.x} y2={b.y}/></g>})}</g>;
}

function FoundationLayer({plan,dims,quarter}){
  const piles=[]; const seen=new Set();
  const add=(x,y)=>{const key=`${x.toFixed(2)}:${y.toFixed(2)}`;if(seen.has(key))return;seen.add(key);piles.push({x,y});};
  (plan.pileRows||[]).forEach(row=>{const c=Math.max(2,Number(row.count)||2);for(let i=0;i<c;i++){const r=i/(c-1);add(Number(row.x1)+(Number(row.x2)-Number(row.x1))*r,Number(row.y1)+(Number(row.y2)-Number(row.y1))*r)}});(plan.piles||[]).forEach(p=>add(Number(p.x)||0,Number(p.y)||0));
  return <g className="visual-foundation">{piles.map((pile,i)=>{const a=projectIso(pile.x,pile.y,-.35,dims,quarter),b=projectIso(pile.x,pile.y,0,dims,quarter);return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>})}</g>;
}

function HouseModel({ project, calculation, mode, roofHidden, quarter, cutaway, layers }) {
  const plan=project.plan; const dims={w:Number(plan.house?.w)||8,h:Number(plan.house?.h)||10}; const wallHeight=Number(plan.wallHeight)||2.5; const roof=project.settings?.roof||{};
  const floor=face([[0,0,0],[dims.w,0,0],[dims.w,dims.h,0],[0,dims.h,0]],dims,quarter);
  const exterior=['north','east','south','west'].map(side=>({side,poly:face(sideFace(side,dims.w,dims.h,wallHeight),dims,quarter)})).sort((a,b)=>avgDepth(a.poly)-avgDepth(b.poly));
  const partitions=unifiedWallSegments(plan).filter(s=>s.axis!=='d'); const openings=(plan.openings||[]).filter(o=>o.outer!==false);
  const panelWidth=Math.max(.5,Number(project.settings?.formulas?.panelWidth)||1.25);
  return <svg className="house-visual-svg engineering-model" viewBox="0 0 780 585" role="img" aria-label="Инженерная визуализация дома">
    <defs>
      <pattern id="osbTexture" width="24" height="18" patternUnits="userSpaceOnUse"><rect width="24" height="18" fill="#d8a85d"/><path d="M2 5l7-3m-3 12l8-4m2-7l5 3m-7 8l8-2M1 16l5-4" stroke="#9b6a2c" strokeWidth="1.2" opacity=".45"/></pattern>
      <linearGradient id="wallSoft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff"/><stop offset="1" stopColor="#e9edf0"/></linearGradient>
      <linearGradient id="roofFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6557a7"/><stop offset="1" stopColor="#38335f"/></linearGradient>
      <filter id="modelShadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="12" stdDeviation="13" floodOpacity=".18"/></filter>
    </defs>
    <ellipse cx="390" cy="505" rx="270" ry="42" className="visual-ground-shadow"/>
    <g filter="url(#modelShadow)">
      {layers.foundation ? <FoundationLayer plan={plan} dims={dims} quarter={quarter}/> : null}
      <polygon points={pointsAttr(floor)} className="visual-floor"/>
      {layers.walls && mode!=='roof' ? exterior.map((item,index)=>{
        const near=index>=2; const fade=cutaway&&near;
        if(mode==='sip') return <PanelWall key={item.side} side={item.side} dims={dims} wallHeight={wallHeight} quarter={quarter} panelWidth={panelWidth} faded={fade}/>;
        if(mode==='frame') return <FrameWall key={item.side} side={item.side} dims={dims} wallHeight={wallHeight} quarter={quarter} step={.625} faded={fade}/>;
        return <polygon key={item.side} points={pointsAttr(item.poly)} className={`iso-wall-full ${fade?'cutaway':''} ${index<2?'rear-wall':''}`}/>;
      }) : null}
      {layers.partitions && mode!=='roof' ? partitions.map((seg,i)=><PartitionFace key={i} segment={seg} dims={dims} wallHeight={wallHeight} quarter={quarter} mode={mode}/>) : null}
      {layers.openings && mode!=='roof' ? openings.map(o=><OpeningShape key={o.id} opening={o} dims={dims} wallHeight={wallHeight} quarter={quarter}/>) : null}
      {layers.roof && !roofHidden ? <RoofGeometry dims={dims} wallHeight={wallHeight} roof={roof} quarter={quarter} mode={mode}/> : null}
    </g>
    <text x="24" y="34" className="visual-caption">{dims.w.toFixed(2)} × {dims.h.toFixed(2)} м · стены {wallHeight.toFixed(2)} м</text>
    <text x="24" y="56" className="visual-subcaption">{mode==='frame'?'Силовой каркас':mode==='sip'?'СИП-панельная схема':mode==='roof'?'Конструкция кровли':'Пространственная модель'} · {roof.shape==='flat'?'плоская':'двускатная'} кровля</text>
    {mode==='sip'?<text x="24" y="78" className="visual-subcaption">СИП: {calculation?.sip?.cutting?.reduce((s,r)=>s+(Number(r.panels)||0),0)||0} панелей · стена {project.settings.sip.wallThickness} мм</text>:null}
  </svg>;
}

function PlanPreview({ project }) {
  const plan=project.plan; const w=Number(plan.house?.w)||8,h=Number(plan.house?.h)||10; const pad=26,width=720,height=500; const scale=Math.min((width-pad*2)/w,(height-pad*2)/h); const p=(x,y)=>({x:pad+x*scale,y:pad+y*scale});
  return <svg className="house-visual-svg plan-preview-svg" viewBox={`0 0 ${width} ${height}`}><rect x={pad} y={pad} width={w*scale} height={h*scale} className="plan-house"/>{(plan.rooms||[]).filter(r=>r.include!==false).map(room=>{const rp=roomPoints(room).map(pt=>p(Number(pt.x)||0,Number(pt.y)||0)); const cx=rp.reduce((s,q)=>s+q.x,0)/Math.max(1,rp.length),cy=rp.reduce((s,q)=>s+q.y,0)/Math.max(1,rp.length);return <g key={room.id}><polygon points={pointsAttr(rp)} className="plan-room"/><text x={cx} y={cy} className="plan-label">{room.name}</text></g>})}{(plan.platforms||[]).filter(x=>x.include!==false).map(platform=><rect key={platform.id} x={p(platform.x,platform.y).x} y={p(platform.x,platform.y).y} width={(Number(platform.w)||0)*scale} height={(Number(platform.h)||0)*scale} className="plan-platform"/>)}</svg>;
}

export default function VisualizationScreen(){
  const { project, commit }=useProject(); const [mode,setModeState]=useState(()=>sessionStorage.getItem('eft-visual-mode')||'3d'); const setMode=(m)=>{sessionStorage.setItem('eft-visual-mode',m);setModeState(m)};
  const [roofHidden,setRoofHidden]=useState(false); const [quarter,setQuarter]=useState(0); const [cutaway,setCutaway]=useState(false); const [showLayers,setShowLayers]=useState(false);
  const [layers,setLayers]=useState({walls:true,partitions:true,openings:true,roof:true,foundation:true}); const calculation=useMemo(()=>calculateProject(project),[project]);
  const totalPanels=calculation?.sip?.cutting?.reduce((sum,row)=>sum+(Number(row.panels)||0),0)||0; const connector=project.settings?.sip?.connectorType||'thermal';
  const setConnector=(value)=>commit(next=>{next.settings.sip.connectorType=value;return next;}); const toggleLayer=(key)=>setLayers(current=>({...current,[key]:!current[key]}));
  const jointLine=calculation.lines?.find(line=>line.source==='sip-walls-joints'); const rafterStep=Number(project.settings?.roof?.rafterStep)||.6;
  return <section className="visualization-screen engineering-visualization">
    <div className="mobile-screen-intro visualization-intro"><span className="eyebrow">Инженерная визуализация · M7.7.0</span><h1>Конструкция дома</h1><p>Один план управляет стенами, СИП-панелями, силовым каркасом, проёмами и кровлей. Вид можно вращать и разбирать по слоям.</p></div>
    <nav className="visual-mode-tabs" aria-label="Режим визуализации">{MODES.map(([id,label,Icon])=><button key={id} className={mode===id?'active':''} onClick={()=>setMode(id)}><Icon/><span>{label}</span></button>)}</nav>
    {mode==='frame'?<div className="frame-material-selector"><span>Материал силового каркаса</span><div>{FRAME_TYPES.map(([id,label,size])=><button key={id} className={connector===id?'active':''} type="button" onClick={()=>setConnector(id)}><strong>{label}</strong><small>{size}</small></button>)}</div></div>:null}
    <article className="visual-stage engineering-stage">
      {mode==='plan'?<PlanPreview project={project}/>:<HouseModel project={project} calculation={calculation} mode={mode} roofHidden={roofHidden} quarter={quarter} cutaway={cutaway} layers={layers}/>} 
      {mode!=='plan'?<div className="visual-orbit-controls"><button type="button" onClick={()=>setQuarter(q=>(q+3)%4)} title="Повернуть влево"><RotateCcw/></button><span>{quarter*90}°</span><button type="button" onClick={()=>setQuarter(q=>(q+1)%4)} title="Повернуть вправо"><RotateCw/></button></div>:null}
      {mode!=='plan'?<div className="visual-stage-actions"><button type="button" className={cutaway?'active':''} onClick={()=>setCutaway(v=>!v)}><Eye/><span>{cutaway?'Разрез включён':'Разрез'}</span></button><button type="button" className={showLayers?'active':''} onClick={()=>setShowLayers(v=>!v)}><SlidersHorizontal/><span>Слои</span></button>{mode!=='roof'?<button type="button" onClick={()=>setRoofHidden(v=>!v)}>{roofHidden?<Eye/>:<EyeOff/>}<span>{roofHidden?'Показать крышу':'Снять крышу'}</span></button>:null}</div>:null}
      {showLayers&&mode!=='plan'?<div className="visual-layer-panel"><strong>Слои модели</strong>{[['walls','Наружные стены'],['partitions','Перегородки'],['openings','Окна и двери'],['roof','Кровля'],['foundation','Сваи']].map(([key,label])=><button key={key} type="button" className={layers[key]?'on':''} onClick={()=>toggleLayer(key)}><span>{label}</span><i/></button>)}</div>:null}
      <div className="visual-stage-badge"><RotateCcw/><span>Связано с планом</span></div>
    </article>
    <div className={`visual-facts ${mode==='frame'||mode==='sip'?'visual-facts-five':''}`}>
      <article><span>Площадь</span><strong>{((Number(project.plan.house?.w)||0)*(Number(project.plan.house?.h)||0)).toFixed(1)} м²</strong></article>
      {mode==='frame'?<><article><span>Каркас</span><strong>{FRAME_TYPES.find(x=>x[0]===connector)?.[1]}</strong></article><article><span>Стыки стен</span><strong>{Number(jointLine?.qty||0).toFixed(1)} м</strong></article><article><span>Стропила</span><strong>шаг {Math.round(rafterStep*1000)} мм</strong></article></>:<article><span>СИП</span><strong>{totalPanels} шт.</strong></article>}
      <article><span>Кровля</span><strong>{Number(calculation?.roof?.totalArea||calculation?.roof?.geometry?.totalSlopeArea||0).toFixed(1)} м²</strong></article>
      {mode==='sip'?<><article><span>Стена</span><strong>{project.settings.sip.wallThickness} мм</strong></article><article><span>Соединение</span><strong>{FRAME_TYPES.find(x=>x[0]===connector)?.[1]}</strong></article></>:null}
    </div>
    <div className="visual-note engineering-note"><strong>{mode==='frame'?'Силовая схема':mode==='sip'?'СИП-система':'Одна модель данных'}</strong><span>{mode==='frame'?'Стойки, верхняя и нижняя обвязки, внутренние перегородки и стропила отображаются из геометрии проекта. Выбор материала каркаса сразу меняет расчёт СИП-соединений.':mode==='sip'?'Наружные стены показаны панельными картами с фактурой ОСБ и заводским шагом панели. Проёмы, перегородки и кровля берутся из текущего проекта.':'Передние стены можно сделать прозрачными режимом «Разрез», а модель повернуть на четыре стороны, чтобы задние стены всегда были доступны для контроля.'}</span></div>
  </section>;
}
