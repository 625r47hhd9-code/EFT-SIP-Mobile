import { polygonArea } from '../../calculations/plan-metrics.js';
import { calculateFoundation } from '../calculations/foundation-model.js';
import { boundsOf, lineEndpoints, roomPoints, unifiedWallSegments } from '../planner/geometry.js';
import { formatNumber } from '../utils/format.js';

const PLAN_VIEW = { width: 760, height: 500, margin: 62 };

function doorSwingGeometry(opening, q, size, plan) {
  const left = opening.hinge === 'left';
  if (opening.orientation === 'h') {
    const hingeX = q.x + (left ? -size / 2 : size / 2);
    const closedX = q.x + (left ? size / 2 : -size / 2);
    const inward = opening.outer ? (opening.y < plan.house.h / 2 ? 1 : -1) : 1;
    const direction = opening.swing === 'out' ? -inward : inward;
    const leafY = q.y + direction * size;
    return { leaves: [{ x1: hingeX, y1: q.y, x2: hingeX, y2: leafY }], arcs: [`M ${closedX} ${q.y} A ${size} ${size} 0 0 ${left === (direction > 0) ? 1 : 0} ${hingeX} ${leafY}`] };
  }
  const hingeY = q.y + (left ? -size / 2 : size / 2);
  const closedY = q.y + (left ? size / 2 : -size / 2);
  const inward = opening.outer ? (opening.x < plan.house.w / 2 ? 1 : -1) : 1;
  const direction = opening.swing === 'out' ? -inward : inward;
  const leafX = q.x + direction * size;
  return { leaves: [{ x1: q.x, y1: hingeY, x2: leafX, y2: hingeY }], arcs: [`M ${q.x} ${closedY} A ${size} ${size} 0 0 ${left === (direction < 0) ? 1 : 0} ${leafX} ${hingeY}`] };
}

function garageSwingGeometry(opening, q, size, plan) {
  const half = size / 2;
  if (opening.orientation === 'h') {
    const inward = opening.outer ? (opening.y < plan.house.h / 2 ? 1 : -1) : 1;
    const direction = opening.swing === 'out' ? -inward : inward;
    const leafY = q.y + direction * half;
    return {
      leaves: [{ x1: q.x - half, y1: q.y, x2: q.x - half, y2: leafY }, { x1: q.x + half, y1: q.y, x2: q.x + half, y2: leafY }],
      arcs: [`M ${q.x} ${q.y} A ${half} ${half} 0 0 ${direction > 0 ? 1 : 0} ${q.x - half} ${leafY}`, `M ${q.x} ${q.y} A ${half} ${half} 0 0 ${direction > 0 ? 0 : 1} ${q.x + half} ${leafY}`]
    };
  }
  const inward = opening.outer ? (opening.x < plan.house.w / 2 ? 1 : -1) : 1;
  const direction = opening.swing === 'out' ? -inward : inward;
  const leafX = q.x + direction * half;
  return {
    leaves: [{ x1: q.x, y1: q.y - half, x2: leafX, y2: q.y - half }, { x1: q.x, y1: q.y + half, x2: leafX, y2: q.y + half }],
    arcs: [`M ${q.x} ${q.y} A ${half} ${half} 0 0 ${direction > 0 ? 0 : 1} ${leafX} ${q.y - half}`, `M ${q.x} ${q.y} A ${half} ${half} 0 0 ${direction > 0 ? 1 : 0} ${leafX} ${q.y + half}`]
  };
}

function planBounds(plan) {
  const points = [
    { x: 0, y: 0 }, { x: plan.house.w, y: plan.house.h },
    ...(plan.rooms || []).flatMap(roomPoints),
    ...(plan.platforms || []).flatMap((item) => [
      { x: item.x, y: item.y }, { x: item.x + item.w, y: item.y + item.h }
    ])
  ];
  return boundsOf(points);
}

export function PrintPlanDiagram({ plan, pileSettings, options = {} }) {
  const bounds = planBounds(plan);
  const scale = Math.min(
    (PLAN_VIEW.width - PLAN_VIEW.margin * 2) / Math.max(1, bounds.w),
    (PLAN_VIEW.height - PLAN_VIEW.margin * 2) / Math.max(1, bounds.h)
  );
  const ox = (PLAN_VIEW.width - bounds.w * scale) / 2 - bounds.x * scale;
  const oy = (PLAN_VIEW.height - bounds.h * scale) / 2 - bounds.y * scale;
  const p = (x, y) => ({ x: ox + x * scale, y: oy + y * scale });
  const houseStart = p(0, 0);
  const showPiles = options.showPiles !== false;
  const showBinding = options.showBinding !== false;
  const showDimensions = options.showDimensions !== false;
  const foundation = calculateFoundation(plan, pileSettings);
  const line = (item) => ({ a: p(item.x1, item.y1), b: p(item.x2, item.y2) });
  const openingLine = (opening) => {
    const q = p(opening.x, opening.y);
    const half = Math.max(8, opening.width * scale / 2);
    return opening.orientation === 'v'
      ? { x1: q.x, y1: q.y - half, x2: q.x, y2: q.y + half }
      : { x1: q.x - half, y1: q.y, x2: q.x + half, y2: q.y };
  };
  const renderOpening = (opening) => {
    const q = p(opening.x, opening.y);
    const size = Math.max(16, opening.width * scale);
    const garage = opening.type === 'door' && opening.doorType === 'garage';
    const geometry = opening.type === 'door' ? (garage ? garageSwingGeometry(opening, q, size, plan) : doorSwingGeometry(opening, q, size, plan)) : null;
    const tag = garage ? 'ГВ' : opening.doorType === 'interior' ? 'МД' : 'ВХ';
    return <g key={opening.id} className={`print-opening-group ${garage ? 'garage' : opening.type}`}>
      <line className="print-opening-cut" {...openingLine(opening)} />
      <line className={`print-opening ${garage ? 'garage' : opening.type}`} {...openingLine(opening)} />
      {geometry ? <g className={`print-door-swing ${garage ? 'garage' : ''}`} aria-label={garage ? 'Двустворчатое открывание гаражных ворот' : 'Направление открывания двери'}>
        {geometry.leaves.map((leaf, index) => <line key={`leaf-${index}`} {...leaf} />)}
        {geometry.arcs.map((path, index) => <path key={`arc-${index}`} d={path} />)}
      </g> : null}
      {opening.type === 'door' ? <text className="print-opening-tag" x={q.x} y={q.y - 9}>{tag}</text> : null}
    </g>;
  };
  return <svg className="print-plan-svg" viewBox={`0 0 ${PLAN_VIEW.width} ${PLAN_VIEW.height}`} role="img" aria-label="План дома для печати">
    <defs><marker id="print-plan-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" /></marker></defs>
    {(plan.platforms || []).map((item) => { const q = p(item.x, item.y); return <g key={item.id} className="print-platform"><rect x={q.x} y={q.y} width={item.w * scale} height={item.h * scale} /><text x={q.x + item.w * scale / 2} y={q.y + item.h * scale / 2 - 3}>{item.kind === 'porch' ? 'Крыльцо' : 'Терраса'}</text><text x={q.x + item.w * scale / 2} y={q.y + item.h * scale / 2 + 13}>{formatNumber(item.w * item.h)} м²</text></g>; })}
    <rect className="print-house-fill" x={houseStart.x} y={houseStart.y} width={plan.house.w * scale} height={plan.house.h * scale} />
    {(plan.rooms || []).map((room) => { const points = roomPoints(room); const screen = points.map((point) => p(point.x, point.y)); const roomBounds = boundsOf(points); const center = p(roomBounds.x + roomBounds.w / 2, roomBounds.y + roomBounds.h / 2); return <g key={room.id} className="print-room"><polygon points={screen.map((point) => `${point.x},${point.y}`).join(' ')} /><text className="room-title" x={center.x} y={center.y - 7}>{room.name}</text><text x={center.x} y={center.y + 9}>{formatNumber(polygonArea(points))} м²</text></g>; })}
    <rect className="print-outer-wall" x={houseStart.x} y={houseStart.y} width={plan.house.w * scale} height={plan.house.h * scale} />
    {unifiedWallSegments(plan).map((segment, index) => { const [a, b] = lineEndpoints(segment); const q1 = p(a.x, a.y); const q2 = p(b.x, b.y); return <line className="print-inner-wall" key={index} x1={q1.x} y1={q1.y} x2={q2.x} y2={q2.y} />; })}
    {(plan.walls || []).map((wall) => { const a = p(wall.x1, wall.y1); const b = p(wall.x2, wall.y2); return <line className="print-inner-wall" key={wall.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })}
    {showBinding ? <g className="print-binding" aria-label="Обвязка на печатном плане">
      {(plan.bindingLines || []).filter((item) => item.include !== false).map((item) => { const q = line(item); return <line key={item.id} x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} />; })}
      {(plan.platforms || []).filter((item) => item.include !== false && item.binding?.mode !== 'none').map((item) => { const q = p(item.x, item.y); return <rect key={item.id} x={q.x} y={q.y} width={item.w * scale} height={item.h * scale} />; })}
    </g> : null}
    {(plan.openings || []).map(renderOpening)}
    {showPiles ? <g className="print-piles" aria-label="Сваи на печатном плане">{foundation.points.map((point, index) => { const q = p(point.x, point.y); return <circle key={index} cx={q.x} cy={q.y} r="5" />; })}</g> : null}
    {showDimensions ? <g className="print-house-dimensions" aria-label="Размеры на печатном плане">
      <line x1={houseStart.x} y1={houseStart.y - 24} x2={houseStart.x + plan.house.w * scale} y2={houseStart.y - 24} markerStart="url(#print-plan-arrow)" markerEnd="url(#print-plan-arrow)" />
      <text x={houseStart.x + plan.house.w * scale / 2} y={houseStart.y - 31}>{Math.round(plan.house.w * 1000).toLocaleString('ru-RU')} мм</text>
      <line x1={houseStart.x - 24} y1={houseStart.y} x2={houseStart.x - 24} y2={houseStart.y + plan.house.h * scale} markerStart="url(#print-plan-arrow)" markerEnd="url(#print-plan-arrow)" />
      <text transform={`translate(${houseStart.x - 31} ${houseStart.y + plan.house.h * scale / 2}) rotate(-90)`}>{Math.round(plan.house.h * 1000).toLocaleString('ru-RU')} мм</text>
      {(plan.dimensions || []).map((item) => { const q = line(item); const length = Math.hypot(item.x2 - item.x1, item.y2 - item.y1); return <g className="print-custom-dimension" key={item.id}><line x1={q.a.x} y1={q.a.y} x2={q.b.x} y2={q.b.y} markerStart="url(#print-plan-arrow)" markerEnd="url(#print-plan-arrow)" /><text x={(q.a.x + q.b.x) / 2} y={(q.a.y + q.b.y) / 2 - 7}>{Math.round(length * 1000).toLocaleString('ru-RU')} мм</text></g>; })}
    </g> : null}
    <g className="print-plan-legend" transform="translate(35 456)" aria-label="Условные обозначения плана">
      <rect className="legend-background" x="0" y="0" width="690" height="34" rx="6" />
      <g className="legend-item" transform="translate(14 17)"><line className="legend-outer" x1="0" y1="0" x2="25" y2="0" /><text x="32" y="4">Наружная стена</text></g>
      <g className="legend-item" transform="translate(158 17)"><line className="legend-inner" x1="0" y1="0" x2="25" y2="0" /><text x="32" y="4">Перегородка</text></g>
      {showBinding ? <g className="legend-item" transform="translate(282 17)"><line className="legend-binding" x1="0" y1="0" x2="25" y2="0" /><text x="32" y="4">Обвязка</text></g> : null}
      <g className="legend-item" transform="translate(392 17)"><line className="legend-window" x1="0" y1="0" x2="25" y2="0" /><text x="32" y="4">Окно</text></g>
      <g className="legend-item" transform="translate(490 17)"><line className="legend-door" x1="0" y1="0" x2="25" y2="0" /><text x="32" y="4">Дверь / ворота</text></g>
    </g>
  </svg>;
}

export function PrintRoofDiagram({ project, roof }) {
  const structure = roof.rafterStructure || {};
  const count = Math.max(2, structure.pairCount || 2);
  const rafters = Array.from({ length: count }, (_, index) => 394 + index * (302 / Math.max(1, count - 1)));
  const layered = structure.system === 'layered';
  const truss = structure.system === 'truss';
  const flat = roof.mainRoofShape === 'flat';
  return <svg className="print-roof-svg" viewBox="0 0 760 300" role="img" aria-label="Схема кровли для печати">
    <g className="print-roof-section">
      <rect x="48" y="178" width="270" height="54" />
      {flat ? <line x1="35" y1="170" x2="330" y2="155" /> : <><line x1="34" y1="178" x2="183" y2="55" /><line x1="183" y1="55" x2="332" y2="178" /></>}
      {!flat ? <><line className="mauerlat" x1="52" y1="173" x2="78" y2="173" /><line className="mauerlat" x1="288" y1="173" x2="314" y2="173" /></> : null}
      {layered ? <><line className="support" x1="183" y1="62" x2="183" y2="178" /><line className="support" x1="183" y1="164" x2="118" y2="111" /><line className="support" x1="183" y1="164" x2="248" y2="111" /></> : truss ? <><line className="support" x1="52" y1="169" x2="314" y2="169" /><line className="support" x1="183" y1="61" x2="183" y2="169" /><line className="support" x1="116" y1="111" x2="183" y2="169" /><line className="support" x1="250" y1="111" x2="183" y2="169" /></> : !flat ? <line className="support" x1="88" y1="132" x2="278" y2="132" /> : null}
      <text x="183" y="258">{flat ? 'Плоская кровля' : layered ? 'Наслонная система' : truss ? 'Стропильная ферма' : 'Висячая A-frame'}</text>
      <text x="183" y="276">Высота конька {formatNumber(project.settings.roof.ridgeHeight)} м</text>
    </g>
    <g className="print-roof-plan">
      <rect x="394" y="55" width="302" height="177" />
      <line className="mauerlat" x1="398" y1="64" x2="692" y2="64" />
      <line className="mauerlat" x1="398" y1="223" x2="692" y2="223" />
      {!flat ? <line className="ridge" x1="394" y1="143" x2="696" y2="143" /> : null}
      {rafters.map((x) => <line key={x} x1={x} y1="55" x2={x} y2="232" />)}
      <text x="545" y="258">{structure.pairCount || 0} пар · шаг {formatNumber(structure.step || 0.6)} м</text>
      <text x="545" y="276">Свесы: карниз {formatNumber(roof.eaveOverhang)} м · торец {formatNumber(roof.gableOverhang)} м</text>
    </g>
  </svg>;
}

export function PrintProjectDiagrams({ project, calculation }) {
  const options = project.settings.print || {};
  const includePlan = options.includePlan !== false;
  const includeRoof = options.includeRoof === true;
  if (!includePlan && !includeRoof) return null;
  return <section className={`print-diagrams ${includePlan && includeRoof ? 'two' : 'one'}`} aria-label="Иллюстрации проекта">
    {includePlan ? <article><h2>План дома</h2><PrintPlanDiagram plan={project.plan} pileSettings={project.settings.piles} options={options} /></article> : null}
    {includeRoof ? <article><h2>Схема кровли</h2><PrintRoofDiagram project={project} roof={calculation.roof} /></article> : null}
  </section>;
}
