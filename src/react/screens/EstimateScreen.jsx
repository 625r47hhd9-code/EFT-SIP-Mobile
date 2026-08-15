import { useMemo } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { useProject } from '../state/ProjectContext.jsx';
import { calculateProject } from '../calculations/estimate-engine.js';
import { buildCommercialScope } from '../calculations/commercial-scope.js';
import { downloadEstimateWorkbook } from '../export/xlsx.js';
import { EditableEstimateTable, ScreenHeader, Stat } from '../components/ui.jsx';
import { PrintProjectDiagrams } from '../components/PrintProjectDiagrams.jsx';
import { formatMoney, formatNumber } from '../utils/format.js';
import { addEstimateLine, changeEstimateLine, removeEstimateLine, resetEstimateLine, resetEstimateSection } from '../state/estimate-edits.js';

function EstimateSectionEditor({ section, project, commit }) {
  const hiddenCount = (project.estimateOverrides || []).filter((item) => item.section === section.key && item.excluded).length;
  const update = (mutate) => commit((next) => { mutate(next); return next; });
  return <EditableEstimateTable
    lines={section.lines}
    grouped={section.key === 'sip'}
    hiddenCount={hiddenCount}
    onChangeLine={(line, changes) => update((next) => changeEstimateLine(next, line, changes))}
    onRemoveLine={(line) => update((next) => removeEstimateLine(next, line))}
    onResetLine={(line) => update((next) => resetEstimateLine(next, line.id))}
    onAddLine={() => update((next) => addEstimateLine(next, section.key))}
    onResetSection={() => update((next) => resetEstimateSection(next, section.key))}
  />;
}

export default function EstimateScreen() {
  const { project, commit } = useProject();
  const calculation = useMemo(() => calculateProject(project), [project]);
  const commercialScope = useMemo(() => buildCommercialScope(project, calculation), [project, calculation]);
  const setPrintOption = (key, value) => commit((next) => { next.settings.print = { ...(next.settings.print || {}), [key]: value }; return next; });
  const printOptions = project.settings.print || {};
  return <div className="screen estimate-screen"><ScreenHeader title="Смета проекта" description="Собрана автоматически из плана, выбранных работ и действующего прайс-листа" actions={<><button className="button secondary no-print" onClick={() => downloadEstimateWorkbook(project, calculation)}><FileSpreadsheet />Скачать Excel</button><button className="button primary no-print" onClick={() => window.print()}><Printer />Печать / PDF</button></>} />
    <section className="print-diagram-options no-print" aria-label="Иллюстрации в печати"><div><strong>Иллюстрации в печати</strong><span>Выберите схемы и слои, которые увидит заказчик.</span></div><div className="print-option-group"><label><input type="checkbox" checked={printOptions.includePlan !== false} onChange={(event) => setPrintOption('includePlan', event.target.checked)} />План дома</label><label><input type="checkbox" checked={printOptions.includeRoof === true} onChange={(event) => setPrintOption('includeRoof', event.target.checked)} />Схема кровли</label></div>{printOptions.includePlan !== false ? <div className="print-option-group plan-layers"><span>Слои плана:</span><label><input type="checkbox" checked={printOptions.showPiles !== false} onChange={(event) => setPrintOption('showPiles', event.target.checked)} />Сваи</label><label><input type="checkbox" checked={printOptions.showBinding !== false} onChange={(event) => setPrintOption('showBinding', event.target.checked)} />Обвязка</label><label><input type="checkbox" checked={printOptions.showDimensions !== false} onChange={(event) => setPrintOption('showDimensions', event.target.checked)} />Размеры</label></div> : null}</section>
    <section className="print-sheet"><header className="print-title"><div className="print-brand"><img src="./icons/eft-logo.png" alt="ЭФТ" /><div><strong>ЭнергоЭффективные Технологии</strong><span>Расчёт комплектации дома</span></div></div><div><h1>КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h1><strong>Проект № {project.meta.projectNum || '—'}</strong></div></header>
      <div className="project-summary"><dl><div><dt>Заказчик</dt><dd>{project.meta.customer || 'Не указан'}</dd></div><div><dt>Адрес</dt><dd>{project.meta.address || 'Не указан'}</dd></div><div><dt>Дата расчёта</dt><dd>{project.meta.date}</dd></div><div><dt>Автор</dt><dd>{project.meta.author || 'ЭФТ'}</dd></div></dl><dl><div><dt>Габариты дома</dt><dd>{formatNumber(project.plan.house.w)} × {formatNumber(project.plan.house.h)} м</dd></div><div><dt>Пол всего дома</dt><dd>{formatNumber(calculation.metrics.floorArea)} м²</dd></div><div><dt>Помещения / СИП-потолок</dt><dd>{formatNumber(calculation.metrics.roomArea)} / {formatNumber(calculation.metrics.ceilingArea)} м²</dd></div><div><dt>Второй свет</dt><dd>{formatNumber(calculation.metrics.openCeilingArea)} м²</dd></div><div><dt>Высота стен</dt><dd>{formatNumber(project.plan.wallHeight)} м</dd></div><div><dt>Наружные / внутренние стены</dt><dd>{project.plan.wallThickness * 1000} / {project.plan.partitionThickness * 1000} мм</dd></div></dl></div>
      <div className="estimate-totals"><Stat label="Материалы" value={formatMoney(calculation.totals.materials)} /><Stat label="Работы" value={formatMoney(calculation.totals.labor)} /><Stat label="Итого по смете" value={formatMoney(calculation.totals.total)} tone="accent" /></div>
      <PrintProjectDiagrams project={project} calculation={calculation} />
      <section className="commercial-scope" aria-labelledby="commercial-scope-title">
        <header><div><span>Комплектация проекта</span><h2 id="commercial-scope-title">Что посчитано и входит в предложение</h2></div><p>Перечень сформирован из активных разделов текущей сметы</p></header>
        <div className="commercial-scope-grid">{commercialScope.map((item) => <article key={item.key} className="commercial-scope-item"><div className="commercial-scope-heading"><h3>{item.title}</h3><strong>{item.total}</strong></div><p>{item.summary}</p><small>{item.details}</small><div className="commercial-scope-tags">{item.coverage.map((label) => <span key={label}>{label}</span>)}</div></article>)}</div>
        <footer>В стоимость входят только перечисленные выше разделы. Подробные количества, цены материалов и работ приведены далее в смете.</footer>
      </section>
      {calculation.sections.map((section) => <section className="estimate-section" key={section.key}><h2>{section.title}</h2><EstimateSectionEditor section={section} project={project} commit={commit} /></section>)}
      <footer className="estimate-footer"><p>Расчёт сформирован в калькуляторе ЭФТ. Итоговая стоимость уточняется после проверки проекта специалистом.</p><strong>Итого: {formatMoney(calculation.totals.total)}</strong></footer>
    </section>
  </div>;
}
