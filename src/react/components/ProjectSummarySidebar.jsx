import {
  AlertTriangle, CheckCircle2, ChevronRight, DoorOpen, HardHat, Home, Layers3,
  PanelTop, Ruler, Trees
} from 'lucide-react';
import { planIssues } from '../planner/geometry.js';
import { formatNumber } from '../utils/format.js';

const ROOF_TYPES = { cold: 'Холодная', sip: 'Тёплая SIP', combo: 'Комбинированная' };
const ROOF_SHAPES = { flat: 'Плоская', gable: 'Двускатная' };
const CONNECTOR_TYPES = { thermal: 'Термобрус', 'board-pack': 'Клеёный пакет досок', solid: 'Брус естественной влажности' };

function SummaryValue({ label, value, tone }) {
  return <div className={`summary-value ${tone || ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function SummarySection({ title, icon: Icon, target, onNavigate, children }) {
  return <section className="summary-section"><button className="summary-section-title" onClick={() => onNavigate(target)}><Icon /><strong>{title}</strong><ChevronRight /></button><div className="summary-section-body">{children}</div></section>;
}

function openingLabel(opening) {
  if (opening.type === 'window') return 'Окно';
  if (opening.doorType === 'garage') return 'Гаражные ворота';
  if (opening.doorType === 'interior') return 'Межкомнатная дверь';
  return 'Входная дверь';
}

export default function ProjectSummarySidebar({ project, calculation, onNavigate }) {
  const { plan } = project;
  const { metrics, foundation, roof } = calculation;
  const issues = planIssues(plan);
  const openings = plan.openings || [];
  const windows = openings.filter((item) => item.type === 'window').length;
  const doors = openings.filter((item) => item.type === 'door' && item.doorType !== 'garage').length;
  const garage = openings.filter((item) => item.doorType === 'garage').length;
  const activeEngineering = [
    project.services.engineeringElectric && 'Электрика',
    project.services.engineeringPlumbing && 'Водоснабжение',
    project.services.engineeringSewerage && 'Канализация',
    project.services.engineeringVentilation && 'Вентиляция'
  ].filter(Boolean);
  const activeScope = [
    project.services.foundation && 'фундамент',
    project.services.sipFloor && 'SIP-пол',
    project.services.sipWalls && 'SIP-стены',
    project.services.sipCeiling && 'SIP-потолок',
    project.services.partitions && 'перегородки',
    project.services.roof && 'кровля',
    project.services.terrace && 'терраса',
    project.services.openings && 'проёмы',
    project.services.delivery && 'доставка'
  ].filter(Boolean);

  return <aside className="project-summary-sidebar" aria-label="Сводная ведомость проекта">
    <header className="project-summary-header"><div><span>Контрольная ведомость</span><h2>Сводка проекта</h2></div><small>№ {project.meta?.projectNum || '—'}</small></header>
    <div className={`summary-health ${issues.length ? 'warning' : 'ok'}`}>{issues.length ? <AlertTriangle /> : <CheckCircle2 />}<span><strong>{issues.length ? `${issues.length} несостыковок` : 'План согласован'}</strong><small>{issues.length ? 'Проверьте красные комнаты' : 'Стены и площади состыкованы'}</small></span></div>
    <button className="summary-customer" onClick={() => onNavigate('parameters')}><span><strong>{project.meta?.customer || 'Заказчик не указан'}</strong><small>{project.meta?.address || 'Адрес объекта не указан'}</small></span><ChevronRight /></button>

    <SummarySection title="Дом и помещения" icon={Home} target="plan" onNavigate={onNavigate}>
      <div className="summary-grid"><SummaryValue label="Габариты" value={`${formatNumber(plan.house.w)} × ${formatNumber(plan.house.h)} м`} /><SummaryValue label="Этажи" value={`${project.meta?.floors || 1}`} /><SummaryValue label="Высота стен" value={`${formatNumber(plan.wallHeight)} м`} /><SummaryValue label="Пол" value={`${formatNumber(metrics.floorArea)} м²`} /><SummaryValue label="Помещения" value={`${formatNumber(metrics.roomArea)} м²`} /><SummaryValue label="Без комнат" value={`${formatNumber(metrics.unassignedArea)} м²`} tone={metrics.unassignedArea > 1 ? 'attention' : ''} /></div>
    </SummarySection>

    <SummarySection title="Стены и SIP" icon={Layers3} target="sip" onNavigate={onNavigate}>
      <div className="summary-grid"><SummaryValue label="Наружные" value={`${formatNumber(metrics.exteriorWallNetArea)} м²`} /><SummaryValue label="Перегородки" value={`${formatNumber(metrics.partitionLength)} м`} /><SummaryValue label="Наружная панель" value={`${Math.round(plan.wallThickness * 1000)} мм`} /><SummaryValue label="Перегородка" value={`${Math.round(plan.partitionThickness * 1000)} мм`} /></div>
      <p className="summary-detail">SIP: пол {project.settings.sip.floorThickness}, стены {project.settings.sip.wallThickness}, потолок {project.settings.sip.ceilingThickness} мм</p><p className="summary-detail">Шаг раскладки: пол {Math.round(Number(project.settings.sip.floorPanelWidth || 1.25) * 1000)} мм · потолок {Math.round(Number(project.settings.sip.ceilingPanelWidth || 1.25) * 1000)} мм</p><p className="summary-detail">{CONNECTOR_TYPES[project.settings.sip.connectorType] || 'Термобрус'}</p>
    </SummarySection>

    <SummarySection title="Сваи и обвязка" icon={HardHat} target="piles" onNavigate={onNavigate}>
      <div className="summary-grid"><SummaryValue label="Всего свай" value={`${foundation.totalPiles} шт`} /><SummaryValue label="Обвязка" value={`${formatNumber(foundation.bindingLength)} м`} /><SummaryValue label="Доски 6 м" value={`${foundation.boardCount} шт`} /><SummaryValue label="Объём доски" value={`${formatNumber(foundation.boardVolume, 3)} м³`} /><SummaryValue label="Шаг не более" value={`${formatNumber(project.settings.piles.spacing)} м`} /><SummaryValue label="Общие с террасой" value={`${foundation.sharedPiles} шт`} /></div>
    </SummarySection>

    <SummarySection title="Кровля" icon={Ruler} target="roof" onNavigate={onNavigate}>
      <div className="summary-grid"><SummaryValue label="Форма" value={ROOF_SHAPES[project.settings.roof.shape || 'gable']} /><SummaryValue label="Тип" value={ROOF_TYPES[project.settings.roof.type] || '—'} /><SummaryValue label="Стропила" value={(roof.rafterStructure?.section || project.settings.roof.rafterSection || '50x150').replace('x', '×')} /><SummaryValue label="Чистый шаг" value={`${formatNumber(roof.rafterStructure?.step || .6)} м`} /><SummaryValue label="Пар" value={`${roof.rafterStructure?.pairCount || 0} шт`} /><SummaryValue label="Обрешётка" value={`${formatNumber(roof.lathStep || .35, 2)} м`} /><SummaryValue label="Доски 6 м" value={`${roof.rafterBoardCount || 0} шт`} /><SummaryValue label="Водосток" value={project.settings.roof.includeGutter === true ? `${formatNumber(roof.gutterLength)} м` : 'нет'} /><SummaryValue label="Скаты" value={`${formatNumber((roof.coldSlopeArea || 0) + (roof.warmSlopeArea || 0))} м²`} /><SummaryValue label="Фронтоны" value={`${formatNumber(roof.gableArea)} м²`} /><SummaryValue label="Столбы террас" value={`${roof.terracePostCount || 0} шт`} /><SummaryValue label="Всего" value={`${formatNumber(roof.totalArea)} м²`} /></div><p className="summary-detail">{project.settings.roof.shape === 'flat' ? `Плоская кровля: длина ${formatNumber(project.settings.roof.ridgeLength)} м` : `Конёк: высота ${formatNumber(project.settings.roof.ridgeHeight)} м · длина ${formatNumber(project.settings.roof.ridgeLength)} м · ${roof.rafterStructure?.system === 'layered' ? 'наслонная система' : roof.rafterStructure?.system === 'truss' ? 'стропильные фермы' : 'висячая система'}`}</p>
    </SummarySection>

    <SummarySection title="Террасы и крыльцо" icon={Trees} target="terrace" onNavigate={onNavigate}>
      <div className="summary-grid"><SummaryValue label="Площадок" value={`${plan.platforms?.length || 0} шт`} /><SummaryValue label="Площадь" value={`${formatNumber(metrics.platformArea)} м²`} /></div>
      {(plan.platforms || []).map((platform) => <p className="summary-detail" key={platform.id}>{platform.kind === 'porch' ? 'Крыльцо' : 'Терраса'} {formatNumber(platform.w)} × {formatNumber(platform.h)} м · {platform.roof?.mode === 'none' ? 'без кровли' : platform.roof?.mode === 'warm' ? 'тёплая кровля' : 'холодная кровля'}</p>)}
    </SummarySection>

    <SummarySection title="Окна, двери, ворота" icon={PanelTop} target="openings" onNavigate={onNavigate}>
      <div className="summary-grid three"><SummaryValue label="Окна" value={`${windows}`} /><SummaryValue label="Двери" value={`${doors}`} /><SummaryValue label="Ворота" value={`${garage}`} /></div>
      <div className="summary-openings">{openings.length ? openings.map((opening, index) => <div key={opening.id}><span>{index + 1}. {openingLabel(opening)}</span><strong>{Math.round(opening.width * 1000)} × {Math.round(opening.height * 1000)}</strong></div>) : <p>Проёмы не заданы</p>}</div>
    </SummarySection>

    <SummarySection title="Комплектация" icon={DoorOpen} target="parameters" onNavigate={onNavigate}>
      <p className="summary-detail">В расчёте: {activeScope.length ? activeScope.join(', ') : 'разделы не выбраны'}</p><p className="summary-detail">Инженерия: {activeEngineering.length ? activeEngineering.join(', ') : 'не выбрана'}</p><p className="summary-detail">Отделка: {project.services.internalFinish ? 'внутренняя' : 'без внутренней'} · {project.services.externalFinish ? 'наружная' : 'без наружной'}</p><p className="summary-detail">Доставка: {formatNumber(project.settings.delivery.distance)} км · {project.settings.delivery.trips} рейс.</p>
    </SummarySection>
  </aside>;
}
