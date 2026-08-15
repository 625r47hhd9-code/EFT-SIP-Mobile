import { useMemo } from 'react';
import { calculatePlanMetrics } from '../../calculations/plan-metrics.js';
import { useProject } from '../state/ProjectContext.jsx';
import { Field, NumberField, Panel, ScreenHeader, Stat, Toggle } from '../components/ui.jsx';
import { formatNumber } from '../utils/format.js';

const SERVICE_GROUPS = [
  ['Конструктив', [
    ['foundation', 'Свайный фундамент и обвязка'], ['sipFloor', 'СИП-пол'], ['sipWalls', 'Наружные СИП-стены'], ['sipCeiling', 'СИП-потолок'], ['partitions', 'Внутренние перегородки'], ['roof', 'Кровля']
  ]],
  ['Комплектация', [
    ['terrace', 'Терраса и крыльцо'], ['openings', 'Окна и двери'], ['delivery', 'Доставка']
  ]],
  ['Инженерия', [
    ['engineeringElectric', 'Электрика'], ['engineeringPlumbing', 'Водоснабжение'], ['engineeringSewerage', 'Канализация'], ['engineeringVentilation', 'Вентиляция']
  ]],
  ['Отделка', [['internalFinish', 'Внутренняя отделка'], ['externalFinish', 'Наружная отделка']]]
];

export default function ParametersScreen() {
  const { project, commit } = useProject();
  const metrics = useMemo(() => calculatePlanMetrics(project.plan), [project.plan]);
  const updateMeta = (key, value) => commit((next) => { next.meta[key] = value; return next; });
  const updatePlan = (key, value) => commit((next) => { next.plan[key] = value; return next; });
  const updateService = (key, value) => commit((next) => { next.services[key] = value; return next; });
  return <div className="screen"><ScreenHeader title="Параметры проекта" description="Основные характеристики и состав работ автоматически используются всеми калькуляторами" />
    <div className="stats-row"><Stat label="Габариты" value={`${formatNumber(project.plan.house.w)} × ${formatNumber(project.plan.house.h)} м`} /><Stat label="Площадь помещений" value={`${formatNumber(metrics.roomArea)} м²`} /><Stat label="Периметр" value={`${formatNumber(metrics.perimeter)} м`} /><Stat label="Проёмы" value={`${project.plan.openings.length} шт`} /></div>
    <div className="two-column-layout"><div className="stack"><Panel title="Карточка проекта" description="Эти данные попадут в файл проекта, смету и печатный документ"><div className="form-grid three"><Field label="Номер проекта"><input value={project.meta.projectNum} onChange={(event) => updateMeta('projectNum', event.target.value)} /></Field><Field label="Заказчик"><input value={project.meta.customer} onChange={(event) => updateMeta('customer', event.target.value)} /></Field><Field label="Дата"><input type="date" value={project.meta.date} onChange={(event) => updateMeta('date', event.target.value)} /></Field><Field label="Адрес" className="span-2"><input value={project.meta.address} onChange={(event) => updateMeta('address', event.target.value)} /></Field><Field label="Автор"><input value={project.meta.author} onChange={(event) => updateMeta('author', event.target.value)} /></Field></div></Panel>
      <Panel title="Конструктив дома"><div className="form-grid three"><NumberField label="Высота стен" value={project.plan.wallHeight} suffix="м" min={2} onChange={(value) => updatePlan('wallHeight', value)} /><NumberField label="Наружная панель" value={project.plan.wallThickness * 1000} suffix="мм" step={1} min={100} onChange={(value) => updatePlan('wallThickness', value / 1000)} /><NumberField label="Перегородка" value={project.plan.partitionThickness * 1000} suffix="мм" step={1} min={50} onChange={(value) => updatePlan('partitionThickness', value / 1000)} /></div></Panel></div>
      <Panel title="Состав расчёта" description="Отключённый раздел остаётся в проекте, но не входит в общую смету" className="services-panel"><div className="service-groups">{SERVICE_GROUPS.map(([group, items]) => <section key={group}><h3>{group}</h3>{items.map(([key, label]) => <Toggle key={key} label={label} checked={project.services[key]} onChange={(value) => updateService(key, value)} />)}</section>)}</div></Panel></div>
  </div>;
}
