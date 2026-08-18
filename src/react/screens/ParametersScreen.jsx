import { useMemo } from 'react';
import {
  ClipboardList, DoorOpen, Factory, Hammer, Home, Layers3, MapPin,
  PackageCheck, PaintRoller, Printer, Settings2, Truck, UserRound, Waves
} from 'lucide-react';
import { calculatePlanMetrics } from '../../calculations/plan-metrics.js';
import { useProject } from '../state/ProjectContext.jsx';
import { Field, NumberField, Panel, SelectField, Stat, Toggle } from '../components/ui.jsx';
import { formatNumber } from '../utils/format.js';
import { scalePlanToHouse } from '../planner/geometry.js';
import { normalizeTerracePlatform } from '../../calculations/terrace-model.js';

const SERVICE_GROUPS = [
  ['Конструкция', [
    ['foundation', 'Свайный фундамент и обвязка'],
    ['sipFloor', 'СИП-пол'],
    ['sipWalls', 'Наружные СИП-стены'],
    ['sipCeiling', 'СИП-потолок'],
    ['partitions', 'Внутренние перегородки'],
    ['roof', 'Кровля']
  ]],
  ['Пристройки и проёмы', [
    ['terrace', 'Террасы и крыльцо'],
    ['openings', 'Окна и двери']
  ]],
  ['Инженерия', [
    ['engineeringElectric', 'Электрика'],
    ['engineeringPlumbing', 'Водоснабжение'],
    ['engineeringSewerage', 'Канализация'],
    ['engineeringVentilation', 'Вентиляция']
  ]],
  ['Отделка и логистика', [
    ['internalFinish', 'Внутренняя отделка'],
    ['externalFinish', 'Наружная отделка'],
    ['delivery', 'Доставка и разгрузка']
  ]]
];

const LINK_ROWS = [
  ['roofRidgeFromPlan', 'Длина конька из плана'],
  ['engineeringFromPlan', 'Инженерия из площади и помещений'],
  ['internalFinishFromPlan', 'Внутренняя отделка из плана'],
  ['externalFinishFromPlan', 'Наружная отделка из плана'],
  ['deliveryVolumeFromPlan', 'Объём доставки из проекта']
];

const FORMULA_FIELDS = [
  ['roofRidgeExtra', 'Добавка к длине конька', 'м', 0.1],
  ['cableMetersPerM2', 'Кабеля на 1 м²', 'м/м²', 0.1],
  ['electricPointsPerM2', 'Электроточек на 1 м²', 'шт/м²', 0.1],
  ['waterPipeMetersPerM2', 'Водопровода на 1 м²', 'м/м²', 0.05],
  ['waterPointsPerWetRoom', 'Водоточек на мокрое помещение', 'шт', 1],
  ['sewerMetersPerWetRoom', 'Канализации на мокрое помещение', 'м', 0.5],
  ['sewerPointsPerWetRoom', 'Точек канализации на помещение', 'шт', 1],
  ['ventMetersPerWetRoom', 'Вентканала на мокрое помещение', 'м', 0.5],
  ['ventGrillesPerWetRoom', 'Вентрешёток на помещение', 'шт', 1],
  ['cargoM3PerM2', 'Груза на 1 м² дома', 'м³/м²', 0.01],
  ['terraceCargoM3PerM2', 'Груза на 1 м² террасы', 'м³/м²', 0.01],
  ['internalPartitionFaces', 'Сторон отделки перегородки', 'шт', 1],
  ['laminateShare', 'Доля ламината', '', 0.05],
  ['tileShare', 'Доля плитки', '', 0.05],
  ['sipTimberReservePercent', 'Запас соединительного бруса', '%', 1],
  ['partitionBoardM3PerM2', 'Доски перегородок на 1 м²', 'м³/м²', 0.001],
  ['foamUnitsPerPanel', 'Пены на СИП-панель', 'шт', 0.1],
  ['structuralFastenerKgPerM2', 'Силового крепежа на 1 м²', 'кг/м²', 0.005],
  ['seamScrewKgPerM2', 'Саморезов шва на 1 м²', 'кг/м²', 0.002],
  ['spiralPackPerPanels', 'Панелей на пачку спиральных гвоздей', 'шт', 1],
  ['pileConcreteM3', 'Бетона на сваю', 'м³', 0.001],
  ['pileScrewKg', 'Крепежа на сваю', 'кг', 0.01],
  ['pileLagScrews', 'Глухарей на сваю', 'шт', 1],
  ['hangingRafterReserve', 'Запас висячих стропил', '', 0.01],
  ['layeredRafterReserve', 'Запас наслонных стропил', '', 0.01],
  ['trussRafterReserve', 'Запас ферм', '', 0.01],
  ['gableBoardM3PerM2', 'Доски фронтона на 1 м²', 'м³/м²', 0.001],
  ['lathM3PerM2', 'Обрешётки на 1 м²', 'м³/м²', 0.001],
  ['roofScrewsPerM2', 'Кровельных саморезов на 1 м²', 'шт/м²', 1],
  ['roofGeneralFastenerKgPerM2', 'Крепежа кровли на 1 м²', 'кг/м²', 0.01],
  ['ridgeReserve', 'Запас коньковой планки', '', 0.01],
  ['mauerlatReserve', 'Запас мауэрлата', '', 0.01],
  ['mauerlatAnchorSpacing', 'Шаг анкеров мауэрлата', 'м', 0.1],
  ['ridgeBeamReserve', 'Запас конькового прогона', '', 0.01],
  ['roofTrimReserve', 'Запас доборных элементов', '', 0.01],
  ['gutterBracketSpacing', 'Шаг кронштейнов водостока', 'м', 0.05],
  ['gutterOutletSpacing', 'Шаг выпусков водостока', 'м', 1],
  ['downpipeClampSpacing', 'Шаг хомутов трубы', 'м', 0.1],
  ['rafterInsulationThicknessM', 'Толщина утепления стропил', 'м', 0.05],
  ['vaporBarrierRollArea', 'Площадь рулона пароизоляции', 'м²', 1],
  ['terraceRoofPostSpacing', 'Шаг стоек кровли террасы', 'м', 0.1],
  ['terraceFrameBoardM3PerM2', 'Каркаса террасы на 1 м²', 'м³/м²', 0.001],
  ['terraceDeckReserve', 'Запас настила террасы', '', 0.01],
  ['terraceScrewKgPerM2', 'Саморезов террасы на 1 м²', 'кг/м²', 0.01]
];

function Section({ number, title, subtitle, icon: Icon, children }) {
  return (
    <section className="all-params-section">
      <header>
        <span className="all-params-number">{String(number).padStart(2, '0')}</span>
        <span className="all-params-icon"><Icon /></span>
        <div><h2>{title}</h2><p>{subtitle}</p></div>
      </header>
      <div className="all-params-body">{children}</div>
    </section>
  );
}

function Subhead({ children }) {
  return <h3 className="all-params-subhead">{children}</h3>;
}

export default function ParametersScreen() {
  const { project, commit } = useProject();
  const metrics = useMemo(() => calculatePlanMetrics(project.plan), [project.plan]);

  const updateMeta = (key, value) => commit((next) => { next.meta[key] = value; return next; });
  const updatePlan = (key, value) => commit((next) => { next.plan[key] = value; return next; });
  const updateSetting = (group, key, value) => commit((next) => {
    next.settings[group][key] = value;
    return next;
  });
  const updateService = (key, value) => commit((next) => { next.services[key] = value; return next; });
  const updateLink = (key, value) => commit((next) => { next.settings.links[key] = value; return next; });
  const updateFormula = (key, value) => commit((next) => { next.settings.formulas[key] = value; return next; });

  const resizeHouse = (axis, value) => commit((next) => {
    const width = axis === 'w' ? value : next.plan.house.w;
    const height = axis === 'h' ? value : next.plan.house.h;
    next.plan = scalePlanToHouse(next.plan, width, height);
    return next;
  });

  const updatePlatform = (id, mutator) => commit((next) => {
    const index = next.plan.platforms.findIndex((item) => item.id === id);
    if (index < 0) return next;
    const changed = structuredClone(next.plan.platforms[index]);
    mutator(changed);
    next.plan.platforms[index] = normalizeTerracePlatform(changed);
    return next;
  });

  const updateOpening = (id, key, value) => commit((next) => {
    const opening = next.plan.openings.find((item) => item.id === id);
    if (opening) opening[key] = value;
    return next;
  });

  const activeServices = SERVICE_GROUPS.flatMap(([, items]) => items).filter(([key]) => project.services[key]).length;
  const roof = project.settings.roof;
  const sip = project.settings.sip;
  const piles = project.settings.piles;

  return (
    <div className="screen parameters-screen-v3">
      <div className="all-params-intro">
        <span className="eyebrow">Полная проверка проекта · M7.9.0</span>
        <h1>Все параметры дома</h1>
        <p>Один последовательный экран. Прокручивайте сверху вниз и проверяйте проект по разделам: от габаритов и фундамента до инженерии, отделки, доставки и расчётных связей.</p>
      </div>

      <div className="mobile-parameter-hero all-params-hero">
        <div><span>Дом</span><strong>{formatNumber(project.plan.house.w)} × {formatNumber(project.plan.house.h)} м</strong></div>
        <div><span>Площадь</span><strong>{formatNumber(metrics.floorArea)} м²</strong></div>
        <div><span>Разделов</span><strong>{activeServices}</strong></div>
      </div>

      <div className="all-params-flow">
        <Section number={1} title="Карточка проекта" subtitle="Идентификация объекта и данные для документов" icon={UserRound}>
          <div className="form-grid three">
            <Field label="Номер проекта"><input value={project.meta.projectNum} onChange={(event) => updateMeta('projectNum', event.target.value)} /></Field>
            <Field label="Заказчик"><input value={project.meta.customer} onChange={(event) => updateMeta('customer', event.target.value)} /></Field>
            <Field label="Дата"><input type="date" value={project.meta.date} onChange={(event) => updateMeta('date', event.target.value)} /></Field>
            <Field label="Адрес" className="span-2"><input value={project.meta.address} onChange={(event) => updateMeta('address', event.target.value)} /></Field>
            <Field label="Автор"><input value={project.meta.author} onChange={(event) => updateMeta('author', event.target.value)} /></Field>
          </div>
        </Section>

        <Section number={2} title="Геометрия дома" subtitle="Габариты, этажность, стены и перегородки" icon={Home}>
          <div className="form-grid four">
            <NumberField label="Длина дома" value={project.plan.house.w} suffix="м" min={3} step={0.1} onChange={(value) => resizeHouse('w', value)} />
            <NumberField label="Ширина дома" value={project.plan.house.h} suffix="м" min={3} step={0.1} onChange={(value) => resizeHouse('h', value)} />
            <NumberField label="Высота стен" value={project.plan.wallHeight} suffix="м" min={2} step={0.05} onChange={(value) => updatePlan('wallHeight', value)} />
            <NumberField label="Этажей" value={project.meta.floors || 1} min={1} max={3} step={1} onChange={(value) => updateMeta('floors', Math.round(value))} />
            <NumberField label="Толщина наружной стены" value={project.plan.wallThickness * 1000} suffix="мм" min={100} step={1} onChange={(value) => updatePlan('wallThickness', value / 1000)} />
            <NumberField label="Толщина перегородки" value={project.plan.partitionThickness * 1000} suffix="мм" min={50} step={1} onChange={(value) => updatePlan('partitionThickness', value / 1000)} />
          </div>
          <div className="all-params-stats">
            <Stat label="Пятно дома" value={`${formatNumber(metrics.floorArea)} м²`} />
            <Stat label="Площадь помещений" value={`${formatNumber(metrics.roomArea)} м²`} />
            <Stat label="Периметр" value={`${formatNumber(metrics.perimeter)} м`} />
            <Stat label="Перегородки" value={`${formatNumber(metrics.partitionLength)} м`} />
          </div>
          <p className="all-params-hint">Изменение длины или ширины масштабирует связанную геометрию плана, чтобы комнаты, сваи, пристройки и проёмы подтянулись вместе с домом.</p>
        </Section>

        <Section number={3} title="Свайный фундамент и обвязка" subtitle="Параметры свайной схемы и закупочной обвязки" icon={Waves}>
          <div className="form-grid four">
            <NumberField label="Предельный шаг свай" value={piles.spacing} suffix="м" min={0.5} step={0.1} onChange={(value) => updateSetting('piles', 'spacing', value)} />
            <NumberField label="Слоёв обвязки" value={piles.bindingLayers} suffix="шт" min={1} max={6} step={1} onChange={(value) => updateSetting('piles', 'bindingLayers', Math.round(value))} />
            <NumberField label="Ширина доски обвязки" value={piles.bindingBoardWidthMm} suffix="мм" min={25} step={5} onChange={(value) => updateSetting('piles', 'bindingBoardWidthMm', value)} />
            <NumberField label="Высота доски обвязки" value={piles.bindingBoardHeightMm} suffix="мм" min={100} step={5} onChange={(value) => updateSetting('piles', 'bindingBoardHeightMm', value)} />
            <NumberField label="Закупочная длина доски" value={piles.boardStockLength} suffix="м" min={3} step={0.5} onChange={(value) => updateSetting('piles', 'boardStockLength', value)} />
            <NumberField label="Объём доски на 1 м" value={piles.boardVolumePerMeter} suffix="м³/м" min={0} step={0.0005} onChange={(value) => updateSetting('piles', 'boardVolumePerMeter', value)} />
          </div>
          <p className="all-params-hint">Количество и расположение свай задаются в редакторе плана. Здесь хранятся расчётные параметры самой фундаментной системы.</p>
        </Section>

        <Section number={4} title="СИП-конструкция" subtitle="Толщины панелей, раскладка, соединительный брус и запас" icon={Layers3}>
          <div className="form-grid four">
            <SelectField label="СИП-пол" value={sip.floorThickness} onChange={(value) => updateSetting('sip', 'floorThickness', value)} options={[{value:'124',label:'124 мм'},{value:'174',label:'174 мм'},{value:'224',label:'224 мм'}]} />
            <SelectField label="СИП-стены" value={sip.wallThickness} onChange={(value) => updateSetting('sip', 'wallThickness', value)} options={[{value:'124',label:'124 мм'},{value:'174',label:'174 мм'},{value:'224',label:'224 мм'}]} />
            <SelectField label="СИП-потолок" value={sip.ceilingThickness} onChange={(value) => updateSetting('sip', 'ceilingThickness', value)} options={[{value:'124',label:'124 мм'},{value:'174',label:'174 мм'},{value:'224',label:'224 мм'}]} />
            <SelectField label="Силовой соединительный элемент" value={sip.connectorType} onChange={(value) => updateSetting('sip', 'connectorType', value)} options={[
              { value:'thermal', label:'Термобрус' },
              { value:'board-pack', label:'Пакет клеёных досок' },
              { value:'solid', label:'Брус естественной влажности' }
            ]} />
            <SelectField label="Ширина раскладки пола" value={String(sip.floorPanelWidth)} onChange={(value) => updateSetting('sip', 'floorPanelWidth', value)} options={[{value:'1.25',label:'1250 мм'},{value:'0.625',label:'625 мм'}]} />
            <SelectField label="Ширина раскладки потолка" value={String(sip.ceilingPanelWidth)} onChange={(value) => updateSetting('sip', 'ceilingPanelWidth', value)} options={[{value:'1.25',label:'1250 мм'},{value:'0.625',label:'625 мм'}]} />
            <NumberField label="Запас СИП" value={sip.wastePercent} suffix="%" min={0} max={30} step={1} onChange={(value) => updateSetting('sip', 'wastePercent', value)} />
          </div>
        </Section>

        <Section number={5} title="Стропильная система и кровля" subtitle="Несущая схема, геометрия скатов, обрешётка и доборные элементы" icon={Hammer}>
          <Subhead>Несущая система</Subhead>
          <div className="form-grid four">
            <SelectField label="Режим расчёта" value={roof.structureMode || 'auto'} onChange={(value) => updateSetting('roof', 'structureMode', value)} options={[{value:'auto',label:'Автоматически'},{value:'manual',label:'Ручной выбор'}]} />
            <SelectField label="Стропильная система" value={roof.rafterSystem || 'hanging'} onChange={(value) => updateSetting('roof', 'rafterSystem', value)} options={[
              {value:'hanging',label:'Висячая'},
              {value:'layered',label:'Наслонная'},
              {value:'truss',label:'Фермы'}
            ]} />
            <NumberField label="Шаг стропил / ферм" value={roof.rafterStep} suffix="м" min={0.3} max={1.5} step={0.05} onChange={(value) => updateSetting('roof', 'rafterStep', value)} />
            <SelectField label="Сечение стропил" value={roof.rafterSection || '50x150'} onChange={(value) => updateSetting('roof', 'rafterSection', value)} options={[
              {value:'50x100',label:'50×100 мм'},
              {value:'50x150',label:'50×150 мм'},
              {value:'50x200',label:'50×200 мм'},
              {value:'100x150',label:'100×150 мм'}
            ]} />
          </div>

          <Subhead>Геометрия кровли</Subhead>
          <div className="form-grid four">
            <SelectField label="Форма кровли" value={roof.shape || 'gable'} onChange={(value) => updateSetting('roof', 'shape', value)} options={[{value:'gable',label:'Двускатная'},{value:'flat',label:'Плоская'}]} />
            <SelectField label="Тип кровли" value={roof.type || 'cold'} onChange={(value) => updateSetting('roof', 'type', value)} options={[{value:'cold',label:'Холодная'},{value:'sip',label:'Тёплая СИП'},{value:'combo',label:'Комбинированная'}]} />
            {roof.shape !== 'flat' ? <NumberField label="Высота конька" value={roof.ridgeHeight} suffix="м" min={0.1} step={0.1} onChange={(value) => updateSetting('roof', 'ridgeHeight', value)} /> : null}
            <NumberField label={roof.shape === 'flat' ? 'Длина кровли' : 'Длина конька'} value={roof.ridgeLength} suffix="м" min={0.1} step={0.1} onChange={(value) => updateSetting('roof', 'ridgeLength', value)} />
            <NumberField label="Карнизный свес" value={roof.eaveOverhang} suffix="м" min={0} max={2} step={0.05} onChange={(value) => updateSetting('roof', 'eaveOverhang', value)} />
            <NumberField label="Торцевой свес" value={roof.gableOverhang} suffix="м" min={0} max={2} step={0.05} onChange={(value) => updateSetting('roof', 'gableOverhang', value)} />
            <NumberField label="Шаг обрешётки" value={roof.lathStep} suffix="м" min={0.1} max={1} step={0.05} onChange={(value) => updateSetting('roof', 'lathStep', value)} />
            <SelectField label="Доска обрешётки" value={roof.lathSection || '25x100'} onChange={(value) => updateSetting('roof', 'lathSection', value)} options={[{value:'25x100',label:'25×100 мм'},{value:'25x150',label:'25×150 мм'}]} />
            <NumberField label="Запас покрытия" value={roof.wastePercent} suffix="%" min={0} max={50} step={1} onChange={(value) => updateSetting('roof', 'wastePercent', value)} />
            {roof.type === 'combo' ? <NumberField label="Тёплая часть" value={roof.warmPercent} suffix="%" min={0} max={100} step={5} onChange={(value) => updateSetting('roof', 'warmPercent', value)} /> : null}
            <SelectField label="Тип фронтонов" value={roof.gableType || 'auto'} onChange={(value) => updateSetting('roof', 'gableType', value)} options={[
              {value:'auto',label:'Автоматически'},
              {value:'cold',label:'Каркасные'},
              {value:'sip',label:'СИП'},
              {value:'none',label:'Не считать'}
            ]} />
            <NumberField label="Количество фронтонов" value={roof.gableCount ?? 2} suffix="шт" min={0} max={2} step={1} onChange={(value) => updateSetting('roof', 'gableCount', Math.round(value))} />
          </div>
          <Subhead>Комплектация кровли</Subhead>
          <div className="all-params-toggle-grid">
            <Toggle label="Карнизные планки" checked={roof.includeEaveTrim !== false} onChange={(value) => updateSetting('roof', 'includeEaveTrim', value)} />
            <Toggle label="Торцевые / ветровые планки" checked={roof.includeVergeTrim !== false} onChange={(value) => updateSetting('roof', 'includeVergeTrim', value)} />
            <Toggle label="Уплотнитель под конёк" checked={roof.includeRidgeSeal !== false} onChange={(value) => updateSetting('roof', 'includeRidgeSeal', value)} />
            <Toggle label="Водосточная система" checked={roof.includeGutter === true} onChange={(value) => updateSetting('roof', 'includeGutter', value)} />
          </div>
        </Section>

        <Section number={6} title="Террасы и крыльцо" subtitle={`${project.plan.platforms.length} пристроек · размеры, лестницы, фундамент и кровля`} icon={Factory}>
          {project.plan.platforms.length ? (
            <div className="all-params-repeat">
              {project.plan.platforms.map((platform, index) => (
                <article className="all-params-item-card" key={platform.id}>
                  <header><strong>{index + 1}. {platform.kind === 'porch' ? 'Крыльцо' : 'Терраса'}</strong><span>{formatNumber(platform.w * platform.h)} м²</span></header>
                  <Subhead>Габариты и ступени</Subhead>
                  <div className="form-grid four">
                    <NumberField label="Ширина" value={platform.w} suffix="м" min={0.3} step={0.1} onChange={(value) => updatePlatform(platform.id, (item) => { item.w = value; })} />
                    <NumberField label="Глубина" value={platform.h} suffix="м" min={0.3} step={0.1} onChange={(value) => updatePlatform(platform.id, (item) => { item.h = value; })} />
                    <NumberField label="Количество ступеней" value={platform.steps || 0} suffix="шт" min={0} max={12} step={1} onChange={(value) => updatePlatform(platform.id, (item) => { item.steps = Math.round(value); })} />
                    <NumberField label="Ширина лестницы" value={platform.stairWidth || 1} suffix="м" min={0.5} step={0.1} onChange={(value) => updatePlatform(platform.id, (item) => { item.stairWidth = value; })} />
                    <NumberField label="Высота ступени" value={platform.riser || 0.18} suffix="м" min={0.1} step={0.005} onChange={(value) => updatePlatform(platform.id, (item) => { item.riser = value; })} />
                    <NumberField label="Глубина проступи" value={platform.tread || 0.3} suffix="м" min={0.15} step={0.01} onChange={(value) => updatePlatform(platform.id, (item) => { item.tread = value; })} />
                    <SelectField label="Сторона лестницы" value={platform.stairSide || 'bottom'} onChange={(value) => updatePlatform(platform.id, (item) => { item.stairSide = value; })} options={[
                      {value:'top',label:'Сверху'},{value:'right',label:'Справа'},{value:'bottom',label:'Снизу'},{value:'left',label:'Слева'}
                    ]} />
                  </div>

                  <Subhead>Фундамент и обвязка пристройки</Subhead>
                  <div className="form-grid three">
                    <SelectField label="Фундамент" value={platform.foundation?.mode || 'shared'} onChange={(value) => updatePlatform(platform.id, (item) => { item.foundation = {...item.foundation, mode:value}; })} options={[
                      {value:'shared',label:'Общий с домом'},{value:'separate',label:'Отдельный'},{value:'none',label:'Без свай'}
                    ]} />
                    <SelectField label="Обвязка" value={platform.binding?.mode || 'shared'} onChange={(value) => updatePlatform(platform.id, (item) => { item.binding = {...item.binding, mode:value}; })} options={[
                      {value:'shared',label:'Общая'},{value:'separate',label:'Отдельная'},{value:'none',label:'Без обвязки'}
                    ]} />
                  </div>

                  <Subhead>Кровля пристройки</Subhead>
                  <div className="form-grid four">
                    <SelectField label="Режим кровли" value={platform.roof?.mode || 'none'} onChange={(value) => updatePlatform(platform.id, (item) => { item.roof.mode = value; })} options={[
                      {value:'none',label:'Без кровли'},{value:'cold',label:'Холодная'},{value:'warm',label:'Тёплая'}
                    ]} />
                    <SelectField label="Форма" value={platform.roof?.shape || 'shed'} onChange={(value) => updatePlatform(platform.id, (item) => { item.roof.shape = value; })} options={[
                      {value:'shed',label:'Односкатная'},{value:'continuation',label:'Продолжение основного ската'},{value:'gable',label:'Двускатная'}
                    ]} />
                    <NumberField label="Передний свес" value={platform.roof?.frontOverhang ?? 0.3} suffix="м" min={0} step={0.05} onChange={(value) => updatePlatform(platform.id, (item) => { item.roof.frontOverhang = value; })} />
                    <NumberField label="Боковой свес" value={platform.roof?.sideOverhang ?? 0.3} suffix="м" min={0} step={0.05} onChange={(value) => updatePlatform(platform.id, (item) => { item.roof.sideOverhang = value; })} />
                    <NumberField label="Высокая сторона" value={platform.roof?.highHeight ?? 2.6} suffix="м" min={1.5} step={0.1} onChange={(value) => updatePlatform(platform.id, (item) => { item.roof.highHeight = value; })} />
                    <NumberField label="Низкая сторона" value={platform.roof?.lowHeight ?? 2.2} suffix="м" min={1.5} step={0.1} onChange={(value) => updatePlatform(platform.id, (item) => { item.roof.lowHeight = value; })} />
                    <NumberField label="Высота конька пристройки" value={platform.roof?.ridgeHeight ?? 0.8} suffix="м" min={0} step={0.1} onChange={(value) => updatePlatform(platform.id, (item) => { item.roof.ridgeHeight = value; })} />
                    <NumberField label="Запас кровли пристройки" value={platform.roof?.wastePercent ?? 10} suffix="%" min={0} step={1} onChange={(value) => updatePlatform(platform.id, (item) => { item.roof.wastePercent = value; })} />
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="all-params-empty">Террасы и крыльцо пока не добавлены. Геометрия создаётся в редакторе плана.</p>}
        </Section>

        <Section number={7} title="Окна и двери" subtitle={`${project.plan.openings.length} проёмов · размеры и основные свойства`} icon={DoorOpen}>
          {project.plan.openings.length ? (
            <div className="all-params-repeat">
              {project.plan.openings.map((opening, index) => (
                <article className="all-params-item-card" key={opening.id}>
                  <header><strong>{index + 1}. {opening.type === 'window' ? 'Окно' : 'Дверь'}</strong><span>{opening.outer === false ? 'внутренний' : 'наружный'} проём</span></header>
                  <div className="form-grid four">
                    <NumberField label="Ширина" value={opening.width || 0.9} suffix="м" min={0.3} step={0.05} onChange={(value) => updateOpening(opening.id, 'width', value)} />
                    <NumberField label="Высота" value={opening.height || (opening.type === 'window' ? 1.35 : 2.05)} suffix="м" min={0.5} step={0.05} onChange={(value) => updateOpening(opening.id, 'height', value)} />
                    {opening.type === 'window' ? <NumberField label="Высота подоконника" value={opening.sillHeight ?? 0.9} suffix="м" min={0} step={0.05} onChange={(value) => updateOpening(opening.id, 'sillHeight', value)} /> : null}
                    {opening.type === 'door' ? <SelectField label="Петли" value={opening.hinge || 'right'} onChange={(value) => updateOpening(opening.id, 'hinge', value)} options={[{value:'left',label:'Слева'},{value:'right',label:'Справа'}]} /> : null}
                    {opening.type === 'door' ? <SelectField label="Открывание" value={opening.swing || 'out'} onChange={(value) => updateOpening(opening.id, 'swing', value)} options={[{value:'in',label:'Внутрь'},{value:'out',label:'Наружу'}]} /> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="all-params-empty">Проёмы пока не добавлены. Положение окна или двери задаётся в редакторе плана.</p>}
        </Section>

        <Section number={8} title="Инженерные сети" subtitle="Электрика, вода, канализация и вентиляция" icon={Settings2}>
          <div className="form-grid four">
            <NumberField label="Маршрут кабеля" value={project.settings.engineering.cableRoute} suffix="м" min={0} step={1} onChange={(value) => updateSetting('engineering', 'cableRoute', value)} />
            <NumberField label="Электроточки" value={project.settings.engineering.electricPoints} suffix="шт" min={0} step={1} onChange={(value) => updateSetting('engineering', 'electricPoints', Math.round(value))} />
            <NumberField label="Водопровод" value={project.settings.engineering.waterPipe} suffix="м" min={0} step={1} onChange={(value) => updateSetting('engineering', 'waterPipe', value)} />
            <NumberField label="Водоточки" value={project.settings.engineering.waterPoints} suffix="шт" min={0} step={1} onChange={(value) => updateSetting('engineering', 'waterPoints', Math.round(value))} />
            <NumberField label="Канализация" value={project.settings.engineering.sewerLength} suffix="м" min={0} step={1} onChange={(value) => updateSetting('engineering', 'sewerLength', value)} />
            <NumberField label="Точки канализации" value={project.settings.engineering.sewerPoints} suffix="шт" min={0} step={1} onChange={(value) => updateSetting('engineering', 'sewerPoints', Math.round(value))} />
            <NumberField label="Вентканал" value={project.settings.engineering.ventDuct} suffix="м" min={0} step={1} onChange={(value) => updateSetting('engineering', 'ventDuct', value)} />
            <NumberField label="Вентрешётки" value={project.settings.engineering.ventGrilles} suffix="шт" min={0} step={1} onChange={(value) => updateSetting('engineering', 'ventGrilles', Math.round(value))} />
          </div>
        </Section>

        <Section number={9} title="Внутренняя отделка" subtitle="Расчётные площади и количество внутренних дверей" icon={PaintRoller}>
          <div className="form-grid four">
            <NumberField label="Стены под отделку" value={project.settings.internal.wallArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('internal', 'wallArea', value)} />
            <NumberField label="Потолки" value={project.settings.internal.ceilingArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('internal', 'ceilingArea', value)} />
            <NumberField label="Ламинат" value={project.settings.internal.laminateArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('internal', 'laminateArea', value)} />
            <NumberField label="Плитка" value={project.settings.internal.tileArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('internal', 'tileArea', value)} />
            <NumberField label="Межкомнатные двери" value={project.settings.internal.doors} suffix="шт" min={0} step={1} onChange={(value) => updateSetting('internal', 'doors', Math.round(value))} />
          </div>
        </Section>

        <Section number={10} title="Фасад и наружная отделка" subtitle="Фасадные площади, утепление, металл и подшивка" icon={Home}>
          <div className="form-grid four">
            <NumberField label="Площадь фасада" value={project.settings.external.facadeArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('external', 'facadeArea', value)} />
            <NumberField label="Ветрозащита" value={project.settings.external.windArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('external', 'windArea', value)} />
            <NumberField label="Утепление фасада" value={project.settings.external.insulationArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('external', 'insulationArea', value)} />
            <NumberField label="Имитация / дерево" value={project.settings.external.woodArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('external', 'woodArea', value)} />
            <NumberField label="Металлический фасад" value={project.settings.external.metalArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('external', 'metalArea', value)} />
            <NumberField label="Подшивка свесов" value={project.settings.external.soffitArea} suffix="м²" min={0} step={1} onChange={(value) => updateSetting('external', 'soffitArea', value)} />
            <NumberField label="Наружные углы" value={project.settings.external.cornerLength} suffix="м" min={0} step={1} onChange={(value) => updateSetting('external', 'cornerLength', value)} />
          </div>
        </Section>

        <Section number={11} title="Доставка и разгрузка" subtitle="Расстояние, рейсы, объём и базовые параметры логистики" icon={Truck}>
          <div className="form-grid four">
            <NumberField label="Расстояние" value={project.settings.delivery.distance} suffix="км" min={0} step={1} onChange={(value) => updateSetting('delivery', 'distance', value)} />
            <NumberField label="Количество рейсов" value={project.settings.delivery.trips} suffix="шт" min={0} step={1} onChange={(value) => updateSetting('delivery', 'trips', Math.round(value))} />
            <NumberField label="Объём груза" value={project.settings.delivery.cargoVolume} suffix="м³" min={0} step={1} onChange={(value) => updateSetting('delivery', 'cargoVolume', value)} />
            <NumberField label="Базовая цена рейса" value={project.settings.delivery.baseTrip} suffix="₽" min={0} step={500} onChange={(value) => updateSetting('delivery', 'baseTrip', value)} />
            <NumberField label="Цена за километр" value={project.settings.delivery.perKm} suffix="₽" min={0} step={5} onChange={(value) => updateSetting('delivery', 'perKm', value)} />
            <NumberField label="Разгрузка за 1 м³" value={project.settings.delivery.unloadingPerM3} suffix="₽" min={0} step={50} onChange={(value) => updateSetting('delivery', 'unloadingPerM3', value)} />
          </div>
        </Section>

        <Section number={12} title="Состав проекта и сметы" subtitle={`${activeServices} разделов сейчас включено в расчёт`} icon={PackageCheck}>
          <div className="mobile-service-groups all-service-groups">
            {SERVICE_GROUPS.map(([group, items]) => (
              <section key={group}>
                <h3>{group}</h3>
                {items.map(([key, label]) => <Toggle key={key} label={label} checked={Boolean(project.services[key])} onChange={(value) => updateService(key, value)} />)}
              </section>
            ))}
          </div>
        </Section>

        <Section number={13} title="Автоматические связи" subtitle="Что пересчитывать из основного плана автоматически" icon={ClipboardList}>
          <div className="all-params-toggle-grid">
            {LINK_ROWS.map(([key, label]) => <Toggle key={key} label={label} checked={project.settings.links[key] !== false} onChange={(value) => updateLink(key, value)} />)}
          </div>
          <p className="all-params-hint">При включённой связи соответствующее значение берётся из геометрии плана. При выключении используется ручное значение из разделов выше.</p>
        </Section>

        <Section number={14} title="Расчётные коэффициенты" subtitle="Полный набор внутренних норм и запасов проекта" icon={Settings2}>
          <p className="all-params-warning">Это рабочие коэффициенты расчёта. Они вынесены сюда специально, чтобы в проекте не оставалось скрытых чисел. Менять их стоит осознанно.</p>
          <div className="form-grid four all-formulas-grid">
            {FORMULA_FIELDS.map(([key, label, suffix, step]) => (
              <NumberField key={key} label={label} value={project.settings.formulas[key]} suffix={suffix} min={0} step={step} onChange={(value) => updateFormula(key, value)} />
            ))}
          </div>
        </Section>

        <Section number={15} title="Печать и отображение" subtitle="Какие схемы и слои попадут в печатные материалы" icon={Printer}>
          <div className="all-params-toggle-grid">
            <Toggle label="Добавлять план в печать" checked={project.settings.print.includePlan !== false} onChange={(value) => updateSetting('print', 'includePlan', value)} />
            <Toggle label="Добавлять кровлю в печать" checked={project.settings.print.includeRoof === true} onChange={(value) => updateSetting('print', 'includeRoof', value)} />
            <Toggle label="Показывать сваи" checked={project.settings.print.showPiles !== false} onChange={(value) => updateSetting('print', 'showPiles', value)} />
            <Toggle label="Показывать обвязку" checked={project.settings.print.showBinding !== false} onChange={(value) => updateSetting('print', 'showBinding', value)} />
            <Toggle label="Показывать размеры" checked={project.settings.print.showDimensions !== false} onChange={(value) => updateSetting('print', 'showDimensions', value)} />
          </div>
        </Section>
      </div>

      <div className="all-params-finish">
        <MapPin />
        <div><strong>Проверка закончена</strong><span>Вы дошли до конца полного списка параметров проекта.</span></div>
      </div>
    </div>
  );
}
