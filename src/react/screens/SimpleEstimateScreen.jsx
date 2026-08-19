import { useMemo } from 'react';
import { Printer, Share2, FileText } from 'lucide-react';
import { useProject } from '../state/ProjectContext.jsx';
import { calculateProject } from '../calculations/estimate-engine.js';
import { formatMoney, formatNumber } from '../utils/format.js';

export default function SimpleEstimateScreen() {
  const { project } = useProject();
  const calculation = useMemo(() => calculateProject(project), [project]);
  const house = project.plan.house || {};
  const roof = project.settings.roof || {};
  const share = async () => {
    const text = `ЭФТ · Проект ${project.meta.projectNum || 'без номера'}\nДом ${formatNumber(house.w)} × ${formatNumber(house.h)} м · ${formatNumber(calculation.metrics.floorArea)} м²\nИтого: ${formatMoney(calculation.totals.total)}`;
    if (navigator.share) {
      try { await navigator.share({ title: `ЭФТ · Проект ${project.meta.projectNum || ''}`, text, url: location.href }); } catch {}
    } else {
      await navigator.clipboard?.writeText(text);
    }
  };
  return <section className="simple-estimate-screen">
    <div className="simple-estimate-actions no-print">
      <button onClick={() => window.print()}><Printer />Печать</button>
      <button onClick={() => window.print()}><FileText />Сохранить PDF</button>
      <button onClick={share}><Share2 />Поделиться</button>
    </div>
    <article className="simple-estimate-sheet">
      <header className="simple-estimate-head">
        <div className="simple-estimate-brand"><img src="./icons/eft-logo.png" alt="ЭФТ"/><div><strong>ЭФТ</strong><span>ЭнергоЭффективные Технологии</span></div></div>
        <div className="simple-estimate-project"><span>УПРОЩЁННАЯ СМЕТА</span><strong>Проект № {project.meta.projectNum || '—'}</strong><small>{project.meta.customer || 'Заказчик не указан'}</small></div>
      </header>
      <section className="simple-estimate-hero">
        <div><span>Дом</span><strong>{formatNumber(house.w)} × {formatNumber(house.h)} м</strong></div>
        <div><span>Площадь</span><strong>{formatNumber(calculation.metrics.floorArea)} м²</strong></div>
        <div><span>Стены</span><strong>{formatNumber(project.plan.wallHeight)} м</strong></div>
        <div><span>Кровля</span><strong>{formatNumber(calculation.roof.totalArea)} м²</strong></div>
      </section>
      <section className="simple-estimate-specs">
        <div><span>СИП стены</span><strong>{project.settings.sip.wallThickness} мм</strong></div>
        <div><span>СИП пол</span><strong>{project.settings.sip.floorThickness} мм</strong></div>
        <div><span>СИП потолок</span><strong>{project.settings.sip.ceilingThickness} мм</strong></div>
        <div><span>Стропильная система</span><strong>{calculation.roof.rafterStructure?.system === 'layered' ? 'Наслонная' : calculation.roof.rafterStructure?.system === 'truss' ? 'Фермы' : 'Висячая'}</strong></div>
        <div><span>Стропила</span><strong>{(calculation.roof.rafterStructure?.section || roof.rafterSection || '50x150').replace('x','×')} мм</strong></div>
        <div><span>Фронтоны</span><strong>{formatNumber(calculation.roof.gableArea)} м²</strong></div>
      </section>
      <section className="simple-estimate-sections">
        <h2>Стоимость по разделам</h2>
        {calculation.sections.map((section) => {
          const material = section.lines.filter(line => line.kind !== 'labor').reduce((sum,line)=>sum+line.qty*line.price,0);
          const labor = section.lines.filter(line => line.kind === 'labor').reduce((sum,line)=>sum+line.qty*line.price,0);
          const total = material + labor;
          return <div className="simple-estimate-row" key={section.key}><div><strong>{section.title}</strong><span>Материалы {formatMoney(material)} · работы {formatMoney(labor)}</span></div><b>{formatMoney(total)}</b></div>;
        })}
      </section>
      <section className="simple-estimate-total">
        <div><span>Материалы</span><strong>{formatMoney(calculation.totals.materials)}</strong></div>
        <div><span>Работы</span><strong>{formatMoney(calculation.totals.labor)}</strong></div>
        <div className="grand"><span>Итого</span><strong>{formatMoney(calculation.totals.total)}</strong></div>
      </section>
      <footer><span>ЭФТ · Мобильный калькулятор · версия 7.9.4</span><span>{project.meta.date || ''}</span></footer>
    </article>
  </section>;
}
