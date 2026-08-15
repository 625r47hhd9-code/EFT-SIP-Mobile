import { formatMoney, formatNumber } from '../utils/format.js';

const ROOF_TYPES = { cold: 'холодная', sip: 'тёплая SIP', combo: 'комбинированная' };
const ROOF_SHAPES = { flat: 'плоская', gable: 'двускатная' };
const CONNECTOR_TYPES = { thermal: 'термобрус', 'board-pack': 'клеёный пакет досок', solid: 'брус естественной влажности' };

function openingCounts(openings = []) {
  return openings.reduce((counts, opening) => {
    if (opening.type === 'window') counts.windows += 1;
    else if (opening.doorType === 'garage') counts.garage += 1;
    else counts.doors += 1;
    return counts;
  }, { windows: 0, doors: 0, garage: 0 });
}

function joinParts(parts) {
  return parts.filter(Boolean).join(' · ');
}

function pluralRu(value, one, few, many) {
  const amount = Math.abs(Math.round(Number(value) || 0));
  const lastTwo = amount % 100;
  const last = amount % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${amount} ${word}`;
}

function sectionCoverage(lines) {
  const hasMaterials = lines.some((line) => line.kind !== 'labor');
  const hasLabor = lines.some((line) => line.kind === 'labor');
  return [hasMaterials && 'Материалы', hasLabor && 'Работы'].filter(Boolean);
}

function sectionAmount(lines) {
  return lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.price) || 0), 0);
}

function scopeDescription(key, project, calculation, lineCount) {
  const { metrics, foundation, roof, terrace } = calculation;
  const platforms = (project.plan.platforms || []).filter((platform) => platform.include !== false);
  const openings = openingCounts(project.plan.openings);

  if (key === 'foundation') return {
    summary: `${pluralRu(foundation.totalPiles, 'свая', 'сваи', 'свай')}, обвязка ${formatNumber(foundation.bindingLength)} м`,
    details: `Разбивка, монтаж свай, оголовки, крепёж и ${foundation.boardCount} досок обвязки по 6 м`
  };
  if (key === 'sip') {
    const surfaces = [
      project.services.sipFloor && `пол ${formatNumber(metrics.floorArea)} м²`,
      project.services.sipWalls && `стены ${formatNumber(metrics.exteriorWallNetArea)} м²`,
      project.services.sipCeiling && `потолок ${formatNumber(metrics.ceilingArea)} м²`,
      project.services.partitions && metrics.partitionNetArea > 0 && `перегородки ${formatNumber(metrics.partitionNetArea)} м²`
    ];
    return {
      summary: joinParts(surfaces),
      details: `Панели, раскладка пола ${Math.round(Number(project.settings.sip.floorPanelWidth || 1.25) * 1000)} мм и потолка ${Math.round(Number(project.settings.sip.ceilingPanelWidth || 1.25) * 1000)} мм, соединения (${CONNECTOR_TYPES[project.settings.sip.connectorType] || 'термобрус'}), резка, торцевые доски, крепёж и монтаж`
    };
  }
  if (key === 'roof') {
    const coveredPlatforms = platforms.filter((platform) => platform.roof?.mode && platform.roof.mode !== 'none').length;
    return {
      summary: `${ROOF_SHAPES[project.settings.roof.shape] || 'двускатная'} ${ROOF_TYPES[project.settings.roof.type] || 'холодная'} кровля, ${formatNumber(roof.totalArea)} м²`,
      details: joinParts([
        `основная кровля, ${roof.rafterStructure?.system === 'layered' ? 'наслонная система' : roof.rafterStructure?.system === 'truss' ? 'стропильные фермы' : 'висячая система'} с чистым шагом ${formatNumber(roof.rafterStructure?.step || .6)} м`,
        `обрешётка с шагом ${formatNumber(roof.lathStep || .35, 2)} м`,
        `конёк включён`,
        project.settings.roof.includeGutter === true && `водосточная система ${formatNumber(roof.gutterLength)} м`,
        roof.gableArea > 0 && `фронтоны ${formatNumber(roof.gableArea)} м²`,
        coveredPlatforms > 0 && `кровля ${pluralRu(coveredPlatforms, 'пристройки', 'пристроек', 'пристроек')}`
      ])
    };
  }
  if (key === 'terrace') {
    const terraces = platforms.filter((platform) => platform.kind !== 'porch').length;
    const porches = platforms.filter((platform) => platform.kind === 'porch').length;
    const steps = platforms.reduce((sum, platform) => sum + (Number(platform.steps) || 0), 0);
    return {
      summary: `${pluralRu(platforms.length, 'площадка', 'площадки', 'площадок')}, ${formatNumber(terrace.area)} м²`,
      details: joinParts([terraces && `террасы: ${terraces}`, porches && `крыльца: ${porches}`, steps && `ступени: ${steps}`, 'каркас и настил'])
    };
  }
  if (key === 'openings') return {
    summary: joinParts([`окна: ${openings.windows}`, `двери: ${openings.doors}`, openings.garage && `ворота: ${openings.garage}`]),
    details: 'Комплектация и монтаж проёмов по размерам плана'
  };
  if (key === 'engineering') {
    const systems = [
      project.services.engineeringElectric && 'электрика',
      project.services.engineeringPlumbing && 'водоснабжение',
      project.services.engineeringSewerage && 'канализация',
      project.services.engineeringVentilation && 'вентиляция'
    ].filter(Boolean);
    return { summary: systems.join(', '), details: 'Материалы и монтаж выбранных инженерных систем' };
  }
  if (key === 'internal') return {
    summary: `внутренняя отделка ${formatNumber(calculation.inputs.internal.wallArea)} м² стен`,
    details: 'Выбранные отделочные материалы и монтажные работы'
  };
  if (key === 'external') return {
    summary: `наружная отделка ${formatNumber(calculation.inputs.external.facadeArea)} м² фасада`,
    details: 'Фасадные материалы, крепёж и монтажные работы'
  };
  if (key === 'delivery') return {
    summary: `${formatNumber(project.settings.delivery.distance)} км, ${pluralRu(project.settings.delivery.trips, 'рейс', 'рейса', 'рейсов')}`,
    details: 'Доставка материалов и погрузочно-разгрузочные работы'
  };
  return { summary: `${lineCount} поз.`, details: 'Позиции, включённые в текущую смету проекта' };
}

export function buildCommercialScope(project, calculation) {
  return calculation.sections.filter((section) => section.lines.length).map((section) => {
    const description = scopeDescription(section.key, project, calculation, section.lines.length);
    const estimateGroups = section.key === 'sip' ? [...new Set(section.lines.map((line) => line.estimateGroup).filter(Boolean))] : [];
    return {
      key: section.key,
      title: section.title,
      ...description,
      coverage: [...sectionCoverage(section.lines), ...estimateGroups],
      total: formatMoney(sectionAmount(section.lines))
    };
  });
}
