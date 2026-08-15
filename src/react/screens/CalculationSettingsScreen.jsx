import { useMemo } from 'react';
import { ArrowRight, CheckCircle2, CircleDollarSign, RotateCcw, Unplug } from 'lucide-react';
import { calculationFlowRows, DEFAULT_FORMULAS } from '../calculations/calculation-links.js';
import { calculateProject } from '../calculations/estimate-engine.js';
import { NumberField, Panel, ScreenHeader, Stat, Toggle } from '../components/ui.jsx';
import { useProject } from '../state/ProjectContext.jsx';
import { formatMoney, formatNumber } from '../utils/format.js';

const LINK_FIELDS = [
  ['roofRidgeFromPlan', 'Кровля из габаритов дома', 'Длина конька меняется вместе с шириной дома'],
  ['engineeringFromPlan', 'Инженерия из площади', 'Трассы и точки зависят от площади и мокрых помещений'],
  ['internalFinishFromPlan', 'Внутренняя отделка из плана', 'Стены, полы и двери берутся из геометрии'],
  ['externalFinishFromPlan', 'Фасад из наружных стен', 'Фасад, мембрана и утепление следуют за стенами'],
  ['deliveryVolumeFromPlan', 'Объём доставки из площадей', 'Груз оценивается по дому и пристройкам']
];

const FORMULA_GROUPS = [
  ['Связи с планом', [
    ['roofRidgeExtra', 'Добавка к длине конька', 'м'], ['cableMetersPerM2', 'Кабель на 1 м² дома', 'м'],
    ['electricPointsPerM2', 'Электроточек на 1 м²', 'шт'], ['waterPipeMetersPerM2', 'Водопровод на 1 м²', 'м'],
    ['waterPointsPerWetRoom', 'Точек воды на мокрую комнату', 'шт'], ['sewerMetersPerWetRoom', 'Канализации на мокрую комнату', 'м'],
    ['sewerPointsPerWetRoom', 'Точек канализации на мокрую комнату', 'шт'], ['ventMetersPerWetRoom', 'Вентиляции на мокрую комнату', 'м'],
    ['ventGrillesPerWetRoom', 'Решёток на мокрую комнату', 'шт'],
    ['cargoM3PerM2', 'Груза на 1 м² дома', 'м³'], ['terraceCargoM3PerM2', 'Груза на 1 м² террасы', 'м³'],
    ['internalPartitionFaces', 'Сторон отделки перегородки', 'сторон'], ['laminateShare', 'Доля пола под ламинат', 'коэф.'], ['tileShare', 'Доля пола под плитку', 'коэф.']
  ]],
  ['СИП и крепёж', [
    ['panelArea', 'Площадь одной СИП-панели', 'м²'], ['panelWidth', 'Ширина СИП-панели', 'м'],
    ['panelLength', 'Длина СИП-панели', 'м'], ['sipTimberReservePercent', 'Запас бруса и торцевой доски', '%'],
    ['partitionBoardM3PerM2', 'Доска перегородок на 1 м²', 'м³'],
    ['foamUnitsPerPanel', 'Баллонов пены на панель', 'шт'], ['structuralFastenerKgPerM2', 'Конструкционного крепежа на 1 м²', 'кг'],
    ['seamScrewKgPerM2', 'Саморезов шва на 1 м²', 'кг'], ['spiralPackPerPanels', 'Панелей на упаковку спирального крепежа', 'шт']
  ]],
  ['Фундамент, кровля, терраса', [
    ['pileConcreteM3', 'Пескобетона на сваю', 'м³'], ['pileScrewKg', 'Саморезов обвязки на сваю', 'кг'],
    ['pileLagScrews', 'Глухарей на сваю', 'шт'], ['hangingRafterReserve', 'Коэффициент висячей системы', 'коэф.'], ['layeredRafterReserve', 'Коэффициент наслонной системы', 'коэф.'], ['trussRafterReserve', 'Коэффициент стропильной фермы', 'коэф.'],
    ['gableBoardM3PerM2', 'Доски каркаса на 1 м² фронтона', 'м³'], ['lathM3PerM2', 'Обрешётки на 1 м² кровли', 'м³'], ['roofScrewsPerM2', 'Кровельных саморезов на 1 м²', 'шт'], ['roofGeneralFastenerKgPerM2', 'Сопутствующего крепежа кровли на 1 м²', 'кг'],
    ['ridgeReserve', 'Запас планки конька', 'коэф.'], ['mauerlatReserve', 'Запас мауэрлата', 'коэф.'], ['mauerlatAnchorSpacing', 'Шаг анкеров мауэрлата', 'м'],
    ['ridgeBeamReserve', 'Запас коньковой доски', 'коэф.'], ['roofTrimReserve', 'Запас карнизных и ветровых планок', 'коэф.'], ['gutterBracketSpacing', 'Шаг кронштейнов жёлоба', 'м'], ['gutterOutletSpacing', 'Макс. длина жёлоба на один выпуск', 'м'], ['downpipeClampSpacing', 'Шаг хомутов водосточной трубы', 'м'], ['rafterInsulationThicknessM', 'Толщина минваты второго света', 'м'],
    ['vaporBarrierRollArea', 'Площадь рулона пароизоляции', 'м²'], ['terraceRoofPostSpacing', 'Предельный шаг столбов кровли террасы', 'м'], ['terraceFrameBoardM3PerM2', 'Каркаса на 1 м² террасы', 'м³'],
    ['terraceDeckReserve', 'Запас настила террасы', 'коэф.'], ['terraceScrewKgPerM2', 'Саморезов на 1 м² террасы', 'кг']
  ]]
];

export default function CalculationSettingsScreen() {
  const { project, commit } = useProject();
  const calculation = useMemo(() => calculateProject(project), [project]);
  const flows = useMemo(() => calculationFlowRows(project, calculation), [project, calculation]);
  const priced = calculation.lines.filter((line) => line.catalogId && line.price > 0);
  const missing = calculation.lines.filter((line) => !line.catalogId || line.price <= 0);
  const updateLink = (key, value) => commit((next) => { next.settings.links[key] = value; return next; });
  const updateFormula = (key, value) => commit((next) => { next.settings.formulas[key] = Math.max(0, value); return next; });
  const resetFormulas = () => commit((next) => { next.settings.formulas = structuredClone(DEFAULT_FORMULAS); return next; });
  return <div className="screen calculation-settings-screen"><ScreenHeader title="Связи и формулы" description="Полная цепочка: план → расчёт → номенклатура → прайс → смета" actions={<button className="button secondary" onClick={resetFormulas}><RotateCcw />Исходные коэффициенты</button>} />
    <div className="stats-row"><Stat label="Автоматические связи" value={`${Object.values(calculation.inputs.links).filter(Boolean).length} из ${LINK_FIELDS.length}`} tone="accent" /><Stat label="Расчётных строк" value={`${calculation.lines.length} шт`} /><Stat label="Связано с прайсом" value={`${priced.length} шт`} /><Stat label="Требует цены" value={`${missing.length} шт`} tone={missing.length ? 'danger' : ''} /><Stat label="Итого сметы" value={formatMoney(calculation.totals.total)} /></div>
    <Panel title="Структурная схема" description="Каждая строка показывает источник, применённую формулу, текущий результат и потребителей"><div className="calculation-flow">{flows.map((row) => <article key={`${row.group}-${row.target}`}><span className="flow-group">{row.group}</span><div><small>Источник</small><strong>{row.source}</strong></div><ArrowRight /><div><small>Формула</small><code>{row.formula}</code></div><ArrowRight /><div className="flow-result"><small>Результат</small><strong>{formatNumber(row.result, 3)} {row.unit}</strong></div><ArrowRight /><div><small>Передаётся</small><span>{row.target}</span></div>{row.auto === false ? <i className="manual"><Unplug />Вручную</i> : <i><CheckCircle2 />Связано</i>}</article>)}</div></Panel>
    <div className="two-column-layout settings-columns"><Panel title="Автоматические связи" description="Отключите связь, если хотите вводить величину вручную в соответствующем калькуляторе">{LINK_FIELDS.map(([key, label, hint]) => <Toggle key={key} label={label} hint={hint} checked={project.settings.links[key]} onChange={(value) => updateLink(key, value)} />)}</Panel><Panel title="Контроль прайса" description="Расчётная строка должна найти номенклатуру и цену"><div className={`price-link-status ${missing.length ? 'warning' : 'ok'}`}>{missing.length ? <Unplug /> : <CircleDollarSign />}<div><strong>{missing.length ? `Не найдено или без цены: ${missing.length}` : 'Все расчётные строки имеют цену'}</strong><span>{missing.length ? missing.slice(0, 6).map((line) => line.name).join(' · ') : `Материалы ${formatMoney(calculation.totals.materials)}, работы ${formatMoney(calculation.totals.labor)}`}</span></div></div><div className="price-link-list">{calculation.sections.map((section) => { const sectionMissing = section.lines.filter((line) => !line.catalogId || line.price <= 0).length; return <div key={section.key}><span>{section.title}</span><strong className={sectionMissing ? 'bad' : ''}>{section.lines.length - sectionMissing}/{section.lines.length}</strong></div>; })}</div></Panel></div>
    <Panel title="Полная расчётная ведомость" description="Все количества после формул и точная позиция прайса, из которой взята цена"><div className="table-wrap formula-ledger"><table className="data-table"><thead><tr><th>Раздел</th><th>Номенклатура</th><th>Источник</th><th>ID прайса</th><th>Количество</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>{calculation.lines.map((line) => <tr key={line.id}><td>{line.section}</td><td>{line.name}</td><td>{line.source}</td><td><code>{line.catalogId || 'НЕ НАЙДЕНО'}</code></td><td>{formatNumber(line.qty, 3)} {line.unit}</td><td>{formatMoney(line.price)}</td><td>{formatMoney(line.qty * line.price)}</td></tr>)}</tbody></table></div></Panel>
    {FORMULA_GROUPS.map(([group, fields]) => <Panel key={group} title={group}><div className="form-grid four formula-grid">{fields.map(([key, label, unit]) => <NumberField key={key} label={label} value={project.settings.formulas[key]} suffix={unit} min={0} step={project.settings.formulas[key] < 0.1 ? .001 : .1} onChange={(value) => updateFormula(key, value)} />)}</div></Panel>)}
  </div>;
}
