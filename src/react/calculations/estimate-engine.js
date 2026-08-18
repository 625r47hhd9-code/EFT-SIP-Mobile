import { calculatePlanMetrics, calculateSipCutting, calculateSipRoofCutting, roofGeometry } from '../../calculations/plan-metrics.js';
import { calculateTerraceRoof } from '../../calculations/terrace-model.js';
import { calculateFoundation } from './foundation-model.js';
import { deriveLinkedInputs } from './calculation-links.js';
import { calculateSipJoinery } from './sip-joinery.js';

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

function catalogIndex(project) {
  const entries = [...project.priceMat, ...project.priceLab];
  return {
    entries,
    exact: new Map(entries.map((item) => [item.name.toLocaleLowerCase('ru'), item]))
  };
}

function findCatalog(index, query, kind) {
  const normalized = query.toLocaleLowerCase('ru');
  const exact = index.exact.get(normalized);
  if (exact && (!kind || exact.kind === kind)) return exact;
  return index.entries.find((item) => (!kind || item.kind === kind) && item.name.toLocaleLowerCase('ru').includes(normalized));
}

function makeLine(index, section, query, qty, options = {}) {
  const amount = Math.max(0, Number(qty) || 0);
  if (!amount) return null;
  const item = findCatalog(index, query, options.kind);
  return {
    id: `${section}:${options.key || query}`,
    section,
    catalogId: item?.id,
    name: options.name || item?.name || query,
    unit: options.unit || item?.unit || 'шт',
    qty: round(amount, options.digits ?? 2),
    price: (Number(item?.price) || Number(options.price) || 0) * (Number(options.priceMultiplier) || 1),
    kind: item?.kind || options.kind || 'material',
    source: options.source || section,
    estimateGroup: options.estimateGroup
  };
}

function compact(lines) {
  return lines.filter(Boolean);
}

function resolveRafterStructure(project, geometry, frameLength) {
  const roof = project.settings.roof || {};
  const automatic = (roof.structureMode || 'auto') === 'auto';
  const hasBearingSupport = (project.plan.rooms || []).some((room) => room.include !== false && room.bearing) || (project.plan.walls || []).some((wall) => wall.bearing);
  const clearSpan = Math.max(0, Number(roof.ridgeDirection === 'width' ? project.plan.house?.w : project.plan.house?.h) || 0);
  const system = geometry.shape === 'flat'
    ? 'flat'
    : automatic
      ? (hasBearingSupport || clearSpan > 8 ? 'layered' : 'hanging')
      : ['hanging', 'layered', 'truss'].includes(roof.rafterSystem) ? roof.rafterSystem : 'hanging';
  const step = automatic ? 0.6 : Math.min(1.2, Math.max(0.3, Number(roof.rafterStep) || 0.6));
  const section = automatic
    ? ((geometry.wallSlopeLength || geometry.slopeLength) <= 7 ? '50x150' : '50x200')
    : (['50x100','50x150','50x200'].includes(roof.rafterSection) ? roof.rafterSection : '50x150');
  const boardWidth = 0.05;
  const module = step + boardWidth;
  const pairCount = frameLength > 0 ? Math.ceil(frameLength / module) + 1 : 0;
  const legCount = geometry.shape === 'flat' ? pairCount : pairCount * 2;
  return { automatic, system, step, section, boardWidth, module, frameLength, pairCount, legCount };
}

function applyProjectEstimateEdits(project, sections) {
  const overrides = new Map((project.estimateOverrides || []).map((item) => [item.lineId, item]));
  const customBySection = new Map();
  (project.customEstimateLines || []).forEach((line) => {
    if (!customBySection.has(line.section)) customBySection.set(line.section, []);
    customBySection.get(line.section).push({
      ...line,
      custom: true,
      qty: Math.max(0, Number(line.qty) || 0),
      price: Math.max(0, Number(line.price) || 0),
      kind: line.kind === 'labor' ? 'labor' : 'material'
    });
  });
  return sections.map((section) => {
    const generated = section.lines.flatMap((line) => {
      const override = overrides.get(line.id);
      if (override?.excluded) return [];
      if (!override) return [line];
      return [{
        ...line,
        ...Object.fromEntries(['name', 'kind', 'unit', 'qty', 'price'].filter((key) => override[key] !== undefined).map((key) => [key, override[key]])),
        projectOverride: true
      }];
    });
    return { ...section, lines: [...generated, ...(customBySection.get(section.key) || [])] };
  });
}

function sipPanelName(thickness) {
  return `СИП-панель 2500×1250×${thickness} мм`;
}

function sipSection(project, metrics, index, inputs) {
  const { sip } = project.settings;
  const surfaces = {
    floor: project.services.sipFloor ? metrics.floorArea : 0,
    walls: project.services.sipWalls ? metrics.exteriorWallNetArea : 0,
    ceiling: project.services.sipCeiling ? metrics.ceilingArea : 0
  };
  const f = inputs.formulas;
  const cutting = calculateSipCutting(surfaces, {
    panelArea: f.panelArea,
    panelWidth: f.panelWidth,
    panelLength: f.panelLength,
    extraWastePercent: sip.wastePercent,
    layoutWidths: { floor: sip.floorPanelWidth, ceiling: sip.ceilingPanelWidth }
  });
  const byKey = new Map(cutting.map((row) => [row.key, row]));
  const panelGroups = [
    ['floor', sip.floorThickness], ['walls', sip.wallThickness], ['ceiling', sip.ceilingThickness]
  ];
  const groupNames = { floor: 'Пол', walls: 'Наружные стены', ceiling: 'Потолок', partitions: 'Перегородки' };
  const lines = [];
  panelGroups.forEach(([key, thickness]) => {
    const row = byKey.get(key);
    const lineOptions = { source: `sip-${key}`, estimateGroup: groupNames[key] };
    lines.push(makeLine(index, 'sip', sipPanelName(thickness), row.panels, { key: `panel-${key}`, ...lineOptions }));
    const installQuery = key === 'ceiling' ? 'Монтаж сип-панели потолка' : 'Монтаж сип-панели пол/стены';
    lines.push(makeLine(index, 'sip', installQuery, row.area, { key: `install-${key}`, kind: 'labor', ...lineOptions }));
    lines.push(makeLine(index, 'sip', 'Раскрой сип-панелей', row.cutMeters, { key: `cut-${key}`, kind: 'labor', ...lineOptions }));
    lines.push(makeLine(index, 'sip', 'Пеноклей для СИП-панелей 650 мл', Math.ceil(row.panels * inputs.formulas.foamUnitsPerPanel), { key: `foam-${key}`, ...lineOptions }));
    lines.push(makeLine(index, 'sip', 'Саморезы конст.', row.area * inputs.formulas.structuralFastenerKgPerM2, { key: `fasteners-${key}`, unit: 'кг', ...lineOptions }));
    lines.push(makeLine(index, 'sip', 'Саморезы 4.2 x 75', row.area * inputs.formulas.seamScrewKgPerM2, { key: `seam-screws-${key}`, unit: 'кг', ...lineOptions }));
    lines.push(makeLine(index, 'sip', 'Крепёж спиральный', Math.ceil(row.panels / inputs.formulas.spiralPackPerPanels), { key: `spiral-fasteners-${key}`, unit: 'уп', ...lineOptions }));
  });
  if (project.services.partitions && metrics.partitionNetArea) {
    lines.push(makeLine(index, 'sip', 'Доска ест.влажн. сосна 50*100мм', metrics.partitionNetArea * f.partitionBoardM3PerM2, { key: 'partition-board', unit: 'м³', source: 'partitions', estimateGroup: groupNames.partitions }));
    lines.push(makeLine(index, 'sip', 'Возведение перегородок из доски 100х50', metrics.partitionNetArea, { key: 'partition-work', kind: 'labor', source: 'partitions', estimateGroup: groupNames.partitions }));
  }
  const joinery = calculateSipJoinery(project.plan, project.services, sip, f);
  joinery.rows.forEach((row) => {
    const key = `${row.key}-connector`;
    if (joinery.type === 'thermal') {
      lines.push(makeLine(index, 'sip', `Термобрус 95×${row.thermalDepth} мм`, row.jointLength, { key, unit: 'м.п.', source: `sip-${row.key}-joints`, estimateGroup: groupNames[row.key] }));
    } else if (joinery.type === 'board-pack') {
      lines.push(makeLine(index, 'sip', `Пакет клеёных досок 95×${row.endBoardDepth} мм для СИП ${row.panelThickness} мм`, row.jointLength, { key, unit: 'м.п.', source: `sip-${row.key}-joints`, estimateGroup: groupNames[row.key] }));
    } else {
      const query = `Брус соединительный ест. влажности 100×${row.core} мм`;
      lines.push(makeLine(index, 'sip', query, row.jointLength, { key, unit: 'м.п.', source: `sip-${row.key}-joints`, estimateGroup: groupNames[row.key] }));
    }
    lines.push(makeLine(index, 'sip', `Доска сухая строганая ${row.endBoardDepth}×45 мм`, row.endBoardLength, { key: `${row.key}-edge-board`, unit: 'м.п.', source: `sip-${row.key}-edges`, estimateGroup: groupNames[row.key] }));
  });
  const groupOrder = new Map(['Пол', 'Наружные стены', 'Потолок', 'Перегородки'].map((name, order) => [name, order]));
  return { lines: compact(lines).sort((a, b) => (groupOrder.get(a.estimateGroup) ?? 99) - (groupOrder.get(b.estimateGroup) ?? 99)), cutting, joinery };
}

function foundationSection(project, index, inputs) {
  const foundation = calculateFoundation(project.plan, project.settings.piles);
  if (!project.services.foundation) return { lines: [], foundation };
  const count = foundation.totalPiles;
  return {
    foundation,
    lines: compact([
      makeLine(index, 'foundation', 'Разбивка осей фундамента (1 свая)', count, { key: 'axes', kind: 'labor' }),
      makeLine(index, 'foundation', 'Монтаж свай', count, { key: 'pile-work', kind: 'labor' }),
      makeLine(index, 'foundation', 'Винтовые сваи 108мм', count, { key: 'piles' }),
      makeLine(index, 'foundation', 'Пескобетон М300', count * inputs.formulas.pileConcreteM3, { key: 'concrete', unit: 'м³', digits: 3 }),
      makeLine(index, 'foundation', 'Оголовок для свай', count, { key: 'heads' }),
      makeLine(index, 'foundation', 'Монтаж оголовков', count, { key: 'heads-work', kind: 'labor' }),
      makeLine(index, 'foundation', 'Монтаж обвязки', count, { key: 'binding-work', kind: 'labor' }),
      makeLine(index, 'foundation', 'Доска ест. влажн. сосна 50х150мм', foundation.boardVolume, { key: 'binding-board', unit: 'м³', digits: 3, name: `Доска обвязки 50×150 мм · ${foundation.boardCount} шт × 6 м` }),
      makeLine(index, 'foundation', 'Саморезы 6х120', count * inputs.formulas.pileScrewKg, { key: 'binding-screws', unit: 'кг' }),
      makeLine(index, 'foundation', 'Глухари', count * inputs.formulas.pileLagScrews, { key: 'binding-lag-screws', unit: 'шт', name: 'Глухари для крепления обвязки' })
    ])
  };
}

function roofSection(project, metrics, index, inputs) {
  if (!project.services.roof) return { lines: [], extensionLines: [], geometry: null, terraceRoofs: [], coldArea: 0, warmArea: 0, coldSlopeArea: 0, warmSlopeArea: 0, gableArea: 0, insulatedRafterArea: 0, terracePostCount: 0, totalArea: 0, mauerlatLength: 0, mauerlatPurchaseLength: 0, ridgeBeamLength: 0, ridgeBeamPurchaseLength: 0, mainEaveTrimPurchaseLength: 0, mainVergeTrimPurchaseLength: 0 };
  const { roof } = project.settings;
  const ridgeAlongWidth = roof.ridgeDirection === 'width';
  const span = Number(ridgeAlongWidth ? project.plan.house.w : project.plan.house.h) || 0;
  const mainRoofShape = roof.shape === 'flat' ? 'flat' : 'gable';
  const eaveOverhang = Math.max(0, Number(roof.eaveOverhang) || 0);
  const gableOverhang = Math.max(0, Number(roof.gableOverhang) || 0);
  const geometry = roofGeometry({
    span,
    ridgeLength: inputs.roof.ridgeLength,
    ridgeHeight: roof.ridgeHeight,
    shape: mainRoofShape,
    eaveOverhang,
    gableOverhang
  });
  const mainArea = geometry.totalSlopeArea;
  const mainWarmPercent = roof.type === 'sip' ? 100 : roof.type === 'combo' ? roof.warmPercent : 0;
  const insulatedRafterArea = Math.min(mainArea, (metrics.openCeilingArea || 0) * geometry.slopeCoefficient);
  const mainWarmSlopeArea = Math.max(0, mainArea * mainWarmPercent / 100 - insulatedRafterArea);
  const mainColdSlopeArea = mainArea - mainWarmSlopeArea;
  let warmSlopeArea = mainWarmSlopeArea;
  let coldSlopeArea = mainColdSlopeArea;
  const terraceRoofs = (project.plan.platforms || []).filter((platform) => platform.include !== false).map((platform) => ({
    platform,
    result: calculateTerraceRoof(platform, project.plan.house, {
      mainSlopeCoefficient: geometry.slopeCoefficient,
      wallPanelThickness: project.settings.sip.wallThickness,
      postSpacing: inputs.formulas.terraceRoofPostSpacing
    })
  }));
  terraceRoofs.forEach(({ platform, result }) => {
    if (platform.roof?.mode === 'warm') warmSlopeArea += result.netArea;
    if (platform.roof?.mode === 'cold') coldSlopeArea += result.netArea;
  });
  const mainGableType = mainRoofShape === 'flat' || roof.gableType === 'none' ? 'none' : roof.gableType === 'cold' ? 'cold' : roof.gableType === 'sip' ? 'sip' : roof.type === 'sip' ? 'sip' : 'cold';
  const mainGableCount = mainRoofShape === 'flat' ? 0 : Math.min(2, Math.max(0, Math.round(Number(roof.gableCount) || 0)));
  const mainGableArea = mainGableType === 'none' ? 0 : geometry.gableArea * mainGableCount / 2;
  const mainColdGableArea = mainGableType === 'cold' ? mainGableArea : 0;
  const mainWarmGableArea = mainGableType === 'sip' ? mainGableArea : 0;
  let coldGableArea = mainColdGableArea;
  let warmGableArea = mainWarmGableArea;
  terraceRoofs.forEach(({ result }) => {
    if (result.gableType === 'cold') coldGableArea += result.gableArea;
    if (result.gableType === 'sip') warmGableArea += result.gableArea;
  });
  const coldArea = coldSlopeArea + coldGableArea;
  const warmArea = warmSlopeArea + warmGableArea;
  const gableArea = coldGableArea + warmGableArea;
  const totalSlopeArea = coldSlopeArea + warmSlopeArea;
  const totalArea = totalSlopeArea + gableArea;
  const sipCutting = calculateSipRoofCutting(warmSlopeArea, { panelArea: inputs.formulas.panelArea, extraWastePercent: project.settings.sip.wastePercent });
  const gableSipCutting = calculateSipRoofCutting(warmGableArea, { panelArea: inputs.formulas.panelArea, extraWastePercent: project.settings.sip.wastePercent });
  const mainSipCutting = calculateSipRoofCutting(mainWarmSlopeArea, { panelArea: inputs.formulas.panelArea, extraWastePercent: project.settings.sip.wastePercent });
  const mainGableSipCutting = calculateSipRoofCutting(mainWarmGableArea, { panelArea: inputs.formulas.panelArea, extraWastePercent: project.settings.sip.wastePercent });
  const houseLength = Math.max(0, Number(ridgeAlongWidth ? project.plan.house.h : project.plan.house.w) || 0);
  const rafterStructure = resolveRafterStructure(project, geometry, houseLength);
  const rafterSection = rafterStructure.section;
  const rafterDepth = rafterSection === '50x200' ? 0.2 : rafterSection === '50x100' ? 0.1 : 0.15;
  const rafterCatalogQuery = rafterSection === '50x200' ? 'Доска ест. влажн. сосна 50х200мм' : rafterSection === '50x100' ? 'Доска ест.влажн. сосна 50*100мм' : 'Доска ест. влажн. сосна 50х150мм';
  const terracePostCount = terraceRoofs.reduce((sum, item) => sum + item.result.postCount, 0);
  const mauerlatLength = mainRoofShape === 'flat' ? 0 : houseLength * 2;
  const mauerlatPurchaseLength = mauerlatLength * inputs.formulas.mauerlatReserve;
  const mauerlatBoardCount = mauerlatPurchaseLength ? Math.ceil(mauerlatPurchaseLength / 6) : 0;
  const mauerlatVolume = mauerlatBoardCount * 6 * 0.1 * 0.15;
  const anchorSpacing = Math.max(0.1, inputs.formulas.mauerlatAnchorSpacing);
  const mauerlatAnchors = mauerlatLength ? 2 * (Math.ceil(houseLength / anchorSpacing) + 1) : 0;
  const ridgeBeamLength = mainRoofShape === 'flat' ? 0 : geometry.roofLength;
  // Геометрическая длина конька нужна для кровельной планки всегда, но несущий
  // коньковый элемент зависит от выбранной системы. Для готовых ферм отдельная
  // коньковая доска/прогон не требуется.
  const structuralRidgeBeamLength = rafterStructure.system === 'truss' ? 0 : ridgeBeamLength;
  const ridgeBeamPurchaseLength = structuralRidgeBeamLength * inputs.formulas.ridgeBeamReserve;
  const rafterReserve = rafterStructure.system === 'truss'
    ? inputs.formulas.trussRafterReserve
    : rafterStructure.system === 'hanging' ? inputs.formulas.hangingRafterReserve : inputs.formulas.layeredRafterReserve;
  const mainRafterLegLength = mainColdSlopeArea ? rafterStructure.legCount * geometry.slopeLength : 0;
  const mainRafterRequiredLength = mainRafterLegLength * rafterReserve + ridgeBeamPurchaseLength;
  const mainRafterBoardCount = mainRafterRequiredLength ? Math.ceil(mainRafterRequiredLength / 6) : 0;
  const mainRafterPurchaseLength = mainRafterBoardCount * 6;
  const mainRafterVolume = mainRafterPurchaseLength * 0.05 * rafterDepth;
  const mainEaveLength = mainRoofShape === 'flat' ? 0 : geometry.roofLength * 2;
  const mainVergeLength = mainRoofShape === 'flat' ? 0 : geometry.slopeLength * 4;
  const mainEaveTrimPurchaseLength = mainEaveLength * inputs.formulas.roofTrimReserve;
  const mainVergeTrimPurchaseLength = mainVergeLength * inputs.formulas.roofTrimReserve;
  const mainCoverPurchaseArea = mainArea * (1 + roof.wastePercent / 100);
  const mainGablePurchaseArea = mainGableArea * (1 + roof.wastePercent / 100);
  const mainConstructionArea = mainArea + mainGableArea;
  const mainGableBoardRequiredLength = mainColdGableArea * inputs.formulas.gableBoardM3PerM2 / (0.05 * 0.15);
  const mainGableBoardCount = mainGableBoardRequiredLength ? Math.ceil(mainGableBoardRequiredLength / 6) : 0;
  const mainGableBoardVolume = mainGableBoardCount * 6 * 0.05 * 0.15;
  const lathStep = Math.min(1.2, Math.max(0.1, Number(roof.lathStep) || 0.35));
  const lathSection = roof.lathSection === '25x150' ? '25x150' : '25x100';
  const lathWidth = lathSection === '25x150' ? 0.15 : 0.1;
  const lathCatalogQuery = lathSection === '25x150' ? 'Доска ест.влажн. сосна 25*150мм' : 'Доска ест.влажн. сосна 25*100мм';
  const mainLathRequiredLength = mainArea ? mainArea / lathStep + mainEaveLength : 0;
  const mainLathBoardCount = mainLathRequiredLength ? Math.ceil(mainLathRequiredLength / 6) : 0;
  const mainLathVolume = mainLathBoardCount * 6 * 0.025 * lathWidth;
  const extensionLines = compact(terraceRoofs.flatMap(({ platform, result }) => {
    if (platform.roof?.mode === 'none' || !result.netArea) return [];
    const key = `platform-${String(platform.id).replace(/[^a-zа-я0-9-]/gi, '-')}`;
    const title = platform.kind === 'porch' ? 'крыльца' : 'террасы';
    const source = `${key}-roof`;
    const coldSlope = platform.roof.mode === 'cold' ? result.netArea : 0;
    const coldGable = result.gableType === 'cold' ? result.gableArea : 0;
    const warmSlope = platform.roof.mode === 'warm' ? result.netArea : 0;
    const warmGable = result.gableType === 'sip' ? result.gableArea : 0;
    const constructionArea = result.netArea + result.gableArea;
    const slopeSip = calculateSipRoofCutting(warmSlope, { panelArea: inputs.formulas.panelArea, extraWastePercent: project.settings.sip.wastePercent });
    const gableSip = calculateSipRoofCutting(warmGable, { panelArea: inputs.formulas.panelArea, extraWastePercent: project.settings.sip.wastePercent });
    const postQuery = result.postSection === '100x100' ? 'Брус ест.влажн. сосна 100×100 мм' : 'Брус мауэрлата ест.влажн. сосна 150×100 мм';
    const ridgeBeamPurchaseLength = result.ridgeLength * inputs.formulas.ridgeBeamReserve;
    const terraceRafterRequiredLength = coldSlope / rafterStructure.step * rafterReserve + ridgeBeamPurchaseLength;
    const terraceRafterBoardCount = terraceRafterRequiredLength ? Math.ceil(terraceRafterRequiredLength / 6) : 0;
    const terraceRafterVolume = terraceRafterBoardCount * 6 * 0.05 * rafterDepth;
    const gableBoardRequiredLength = coldGable * inputs.formulas.gableBoardM3PerM2 / (0.05 * 0.15);
    const gableBoardCount = gableBoardRequiredLength ? Math.ceil(gableBoardRequiredLength / 6) : 0;
    const gableBoardVolume = gableBoardCount * 6 * 0.05 * 0.15;
    const lathRequiredLength = result.netArea ? result.netArea / lathStep + result.eaveLength : 0;
    const lathBoardCount = lathRequiredLength ? Math.ceil(lathRequiredLength / 6) : 0;
    const lathVolume = lathBoardCount * 6 * 0.025 * lathWidth;
    const eaveTrimPurchaseLength = result.eaveLength * inputs.formulas.roofTrimReserve;
    const vergeTrimPurchaseLength = result.vergeLength * inputs.formulas.roofTrimReserve;
    return [
      makeLine(index, 'roof', 'Монтаж стропильной системы', coldSlope, { key: `${key}-rafters-work`, kind: 'labor', name: `Монтаж стропильной системы ${title}`, source }),
      makeLine(index, 'roof', rafterCatalogQuery, terraceRafterVolume, { key: `${key}-rafters`, unit: 'м³', digits: 3, name: `Стропильная доска ${rafterSection.replace('x', '×')} мм · ${terraceRafterBoardCount} шт × 6 м, включая коньковый прогон · кровля ${title}`, source }),
      makeLine(index, 'roof', 'Доска ест. влажн. сосна 50х150мм', gableBoardVolume, { key: `${key}-gable-frame`, unit: 'м³', digits: 3, name: `Каркас фронтона ${title} · доска 50×150 мм · ${gableBoardCount} шт × 6 м`, source }),
      makeLine(index, 'roof', 'Монтаж каркаса фронтонов', coldGable, { key: `${key}-gable-frame-work`, kind: 'labor', name: `Монтаж каркаса фронтона ${title}`, source }),
      makeLine(index, 'roof', 'Монтаж обрешётки и контробрешётки', result.netArea, { key: `${key}-lath-work`, kind: 'labor', name: `Монтаж обрешётки кровли ${title}`, source }),
      makeLine(index, 'roof', lathCatalogQuery, lathVolume, { key: `${key}-lath`, unit: 'м³', digits: 3, name: `Обрешётка кровли ${title} · шаг ${Math.round(lathStep * 1000)} мм · доска ${lathSection.replace('x','×')} мм · ${lathBoardCount} шт × 6 м`, source }),
      makeLine(index, 'roof', 'Гидро-ветрозащитная мембрана', Math.ceil(constructionArea / 70), { key: `${key}-membrane`, unit: 'рулон', name: `Гидро-ветрозащитная мембрана · кровля ${title}`, source }),
      makeLine(index, 'roof', 'Профлист С-21 окрашенный', result.purchaseArea + result.gablePurchaseArea, { key: `${key}-cover`, unit: 'м²', name: `Профлист С-21 · кровля ${title}`, source }),
      makeLine(index, 'roof', 'Монтаж кровельного покрытия — профлист С-21', constructionArea, { key: `${key}-cover-work`, kind: 'labor', name: `Монтаж профлиста · кровля ${title}`, unit: 'м²', source }),
      makeLine(index, 'roof', 'Саморезы кровельные', Math.ceil(constructionArea * inputs.formulas.roofScrewsPerM2), { key: `${key}-roof-screws`, unit: 'шт', name: `Саморезы кровельные · кровля ${title}`, source }),
      makeLine(index, 'roof', 'Планка конька', result.ridgeLength * inputs.formulas.ridgeReserve, { key: `${key}-ridge`, unit: 'м.п.', name: `Планка конька · кровля ${title}`, source }),
      makeLine(index, 'roof', 'Монтаж конька', result.ridgeLength, { key: `${key}-ridge-work`, kind: 'labor', name: `Монтаж планки конька · кровля ${title}`, source }),
      roof.includeRidgeSeal !== false ? makeLine(index, 'roof', 'Уплотнитель универсальный под конёк', result.ridgeLength * inputs.formulas.ridgeReserve, { key: `${key}-ridge-seal`, unit: 'м.п.', name: `Уплотнитель под конёк · кровля ${title}`, source }) : null,
      roof.includeEaveTrim !== false ? makeLine(index, 'roof', 'Планка карнизная', eaveTrimPurchaseLength, { key: `${key}-eave-trim`, unit: 'м.п.', name: `Планка карнизная · кровля ${title}`, source }) : null,
      roof.includeEaveTrim !== false ? makeLine(index, 'roof', 'Монтаж карнизных планок', result.eaveLength, { key: `${key}-eave-trim-work`, kind: 'labor', name: `Монтаж карнизных планок · кровля ${title}`, source }) : null,
      roof.includeVergeTrim !== false ? makeLine(index, 'roof', 'Планка торцевая', vergeTrimPurchaseLength, { key: `${key}-verge-trim`, unit: 'м.п.', name: `Планка торцевая (ветровая) · кровля ${title}`, source }) : null,
      roof.includeVergeTrim !== false ? makeLine(index, 'roof', 'Монтаж торцевых', result.vergeLength, { key: `${key}-verge-trim-work`, kind: 'labor', name: `Монтаж торцевых (ветровых) планок · кровля ${title}`, source }) : null,
      makeLine(index, 'roof', sipPanelName(project.settings.sip.ceilingThickness), slopeSip.panels, { key: `${key}-sip-panel`, name: `${sipPanelName(project.settings.sip.ceilingThickness)} · кровля ${title}`, source }),
      makeLine(index, 'roof', 'Монтаж СИП-кровли', slopeSip.area, { key: `${key}-sip-install`, kind: 'labor', name: `Монтаж СИП-кровли ${title}`, source }),
      makeLine(index, 'roof', 'Раскрой сип-панелей', slopeSip.cutMeters, { key: `${key}-sip-cut`, kind: 'labor', name: `Раскрой СИП-панелей · кровля ${title}`, source }),
      makeLine(index, 'roof', 'Пеноклей для СИП-панелей 650 мл', Math.ceil(slopeSip.panels * inputs.formulas.foamUnitsPerPanel), { key: `${key}-sip-foam`, name: `Пеноклей для СИП-панелей 650 мл · кровля ${title}`, source }),
      makeLine(index, 'roof', 'Саморезы конст.', slopeSip.area * inputs.formulas.structuralFastenerKgPerM2, { key: `${key}-sip-fasteners`, unit: 'кг', name: `Саморезы конструкционные · СИП-кровля ${title}`, source }),
      makeLine(index, 'roof', sipPanelName(project.settings.sip.wallThickness), gableSip.panels, { key: `${key}-gable-sip-panel`, name: `${sipPanelName(project.settings.sip.wallThickness)} · фронтон ${title}`, source }),
      makeLine(index, 'roof', 'Монтаж сип-панели пол/стены', gableSip.area, { key: `${key}-gable-sip-install`, kind: 'labor', name: `Монтаж тёплого SIP-фронтона ${title}`, source }),
      makeLine(index, 'roof', 'Раскрой сип-панелей', gableSip.cutMeters, { key: `${key}-gable-sip-cut`, kind: 'labor', name: `Раскрой SIP-фронтона ${title}`, source }),
      makeLine(index, 'roof', postQuery, result.postVolume, { key: `${key}-posts-${result.postSection}`, unit: 'м³', digits: 3, name: `Опорные столбы кровли ${title} ${result.postSection.replace('x', '×')} мм · ${result.postCount} шт`, source })
    ];
  }));
  const gutterLength = roof.includeGutter === true ? mainEaveLength : 0;
  const gutterRunCount = mainRoofShape === 'flat' ? 1 : 2;
  const gutterStockLength = 3;
  const gutterPieces = gutterLength ? Math.ceil(gutterLength / gutterStockLength) : 0;
  const gutterConnectors = gutterLength ? Math.max(0, gutterPieces - gutterRunCount) : 0;
  const gutterEndCaps = gutterLength ? gutterRunCount * 2 : 0;
  const gutterBrackets = gutterLength ? Math.ceil(gutterLength / inputs.formulas.gutterBracketSpacing) + gutterRunCount : 0;
  const gutterOutlets = gutterLength ? Math.max(gutterRunCount, gutterRunCount * Math.ceil(houseLength / inputs.formulas.gutterOutletSpacing)) : 0;
  const downpipeLength = gutterOutlets * Math.max(0, Number(project.plan.wallHeight) || 2.5);
  const gutterElbows = gutterOutlets * 2;
  const downpipeClamps = gutterOutlets * (Math.ceil((Number(project.plan.wallHeight) || 2.5) / inputs.formulas.downpipeClampSpacing) + 1);
  const lines = compact([
    makeLine(index, 'roof', 'Брус ест.влажн. сосна 100×150 мм', mauerlatVolume, { key: 'mauerlat-timber', unit: 'м³', digits: 3, name: `Мауэрлат 100×150 мм · ${mauerlatBoardCount} шт × 6 м` }),
    makeLine(index, 'roof', 'Монтаж мауэрлата', mauerlatLength, { key: 'mauerlat-work', kind: 'labor', name: 'Монтаж мауэрлата 100×150 мм' }),
    makeLine(index, 'roof', 'Анкер-шпилька для крепления мауэрлата', mauerlatAnchors, { key: 'mauerlat-anchors', unit: 'шт' }),
    makeLine(index, 'roof', 'Монтаж стропильной системы', mainColdSlopeArea, { key: 'rafters-work', kind: 'labor', name: rafterStructure.system === 'truss' ? 'Монтаж стропильных ферм' : 'Монтаж стропильной системы' }),
    makeLine(index, 'roof', 'Монтаж обрешётки и контробрешётки', mainArea, { key: 'lath-work', kind: 'labor' }),
    makeLine(index, 'roof', rafterCatalogQuery, mainRafterVolume, { key: 'rafters', unit: 'м³', digits: 3, name: `Стропильная доска ${rafterSection.replace('x', '×')} мм · ${mainRafterBoardCount} шт × 6 м, включая коньковый прогон` }),
    makeLine(index, 'roof', 'Доска ест. влажн. сосна 50х150мм', mainGableBoardVolume, { key: 'gable-frame', unit: 'м³', digits: 3, name: `Каркас холодных фронтонов · доска 50×150 мм · ${mainGableBoardCount} шт × 6 м`, source: 'gables' }),
    makeLine(index, 'roof', 'Монтаж каркаса фронтонов', mainColdGableArea, { key: 'gable-frame-work', kind: 'labor', source: 'gables' }),
    makeLine(index, 'roof', lathCatalogQuery, mainLathVolume, { key: 'lath', unit: 'м³', digits: 3, name: `Обрешётка ${lathSection.replace('x','×')} мм · шаг ${Math.round(lathStep * 1000)} мм · ${mainLathBoardCount} шт × 6 м` }),
    makeLine(index, 'roof', 'Гидро-ветрозащитная мембрана', Math.ceil(mainConstructionArea / 70), { key: 'membrane', unit: 'рулон' }),
    makeLine(index, 'roof', 'Профлист С-21 окрашенный', mainCoverPurchaseArea + mainGablePurchaseArea, { key: 'cover', unit: 'м²' }),
    makeLine(index, 'roof', 'Монтаж кровельного покрытия — профлист С-21', mainConstructionArea, { key: 'cover-work', kind: 'labor', name: 'Монтаж профлиста основной кровли', unit: 'м²' }),
    makeLine(index, 'roof', 'Саморезы кровельные', Math.ceil(mainConstructionArea * inputs.formulas.roofScrewsPerM2), { key: 'roof-screws', unit: 'шт' }),
    makeLine(index, 'roof', 'Гвозди/саморезы для обрешётки', totalArea * inputs.formulas.roofGeneralFastenerKgPerM2, { key: 'general-fasteners', unit: 'кг', name: 'Сопутствующий крепёж кровли и фронтонов' }),
    makeLine(index, 'roof', 'Планка конька', ridgeBeamLength * inputs.formulas.ridgeReserve, { key: 'ridge', unit: 'м.п.' }),
    makeLine(index, 'roof', 'Монтаж конька', ridgeBeamLength, { key: 'ridge-work', kind: 'labor', name: 'Монтаж планки конька' }),
    roof.includeRidgeSeal !== false ? makeLine(index, 'roof', 'Уплотнитель универсальный под конёк', ridgeBeamLength * inputs.formulas.ridgeReserve, { key: 'ridge-seal', unit: 'м.п.', name: 'Уплотнитель универсальный под конёк' }) : null,
    roof.includeEaveTrim !== false ? makeLine(index, 'roof', 'Планка карнизная', mainEaveTrimPurchaseLength, { key: 'eave-trim', unit: 'м.п.' }) : null,
    roof.includeEaveTrim !== false ? makeLine(index, 'roof', 'Монтаж карнизных планок', mainEaveLength, { key: 'eave-trim-work', kind: 'labor' }) : null,
    roof.includeVergeTrim !== false ? makeLine(index, 'roof', 'Планка торцевая', mainVergeTrimPurchaseLength, { key: 'verge-trim', unit: 'м.п.', name: 'Планка торцевая (ветровая)' }) : null,
    roof.includeVergeTrim !== false ? makeLine(index, 'roof', 'Монтаж торцевых', mainVergeLength, { key: 'verge-trim-work', kind: 'labor', name: 'Монтаж торцевых (ветровых) планок' }) : null,
    makeLine(index, 'roof', 'Жёлоб водосточный', gutterLength, { key: 'gutter', unit: 'м.п.' }),
    makeLine(index, 'roof', 'Соединитель жёлоба', gutterConnectors, { key: 'gutter-connectors', unit: 'шт' }),
    makeLine(index, 'roof', 'Заглушка жёлоба', gutterEndCaps, { key: 'gutter-end-caps', unit: 'шт' }),
    makeLine(index, 'roof', 'Кронштейн жёлоба', gutterBrackets, { key: 'gutter-brackets', unit: 'шт' }),
    makeLine(index, 'roof', 'Воронка водосточная', gutterOutlets, { key: 'gutter-outlets', unit: 'шт' }),
    makeLine(index, 'roof', 'Труба водосточная', downpipeLength, { key: 'downpipes', unit: 'м.п.' }),
    makeLine(index, 'roof', 'Колено (отвод) трубы', gutterElbows, { key: 'gutter-elbows', unit: 'шт' }),
    makeLine(index, 'roof', 'Хомут крепления трубы', downpipeClamps, { key: 'downpipe-clamps', unit: 'шт' }),
    makeLine(index, 'roof', 'Монтаж водосточной системы (жёлоб)', gutterLength, { key: 'gutter-work', kind: 'labor', unit: 'м.п.' }),
    makeLine(index, 'roof', 'Монтаж водосточных труб', downpipeLength, { key: 'downpipe-work', kind: 'labor', unit: 'м.п.' }),
    makeLine(index, 'roof', 'Утеплитель 100 мм П50-60', insulatedRafterArea * inputs.formulas.rafterInsulationThicknessM, { key: 'open-rafter-insulation', unit: 'м³', digits: 3, source: 'open-rafter' }),
    makeLine(index, 'roof', 'Укладка утеплителя стен 50 мм', insulatedRafterArea, { key: 'open-rafter-insulation-work', kind: 'labor', name: `Укладка минваты в стропила ${Math.round(inputs.formulas.rafterInsulationThicknessM * 1000)} мм`, unit: 'м²', priceMultiplier: inputs.formulas.rafterInsulationThicknessM / 0.05, source: 'open-rafter' }),
    makeLine(index, 'roof', 'Пароизоляция "В"', Math.ceil(insulatedRafterArea / Math.max(1, inputs.formulas.vaporBarrierRollArea)), { key: 'open-rafter-vapor', unit: 'рулон', source: 'open-rafter' }),
    makeLine(index, 'roof', 'Монтаж пароизоляции В', insulatedRafterArea, { key: 'open-rafter-vapor-work', kind: 'labor', source: 'open-rafter' }),
    makeLine(index, 'roof', sipPanelName(project.settings.sip.ceilingThickness), mainSipCutting.panels, { key: 'sip-panel', source: 'sip-roof' }),
    makeLine(index, 'roof', 'Монтаж СИП-кровли', mainSipCutting.area, { key: 'sip-install', kind: 'labor', source: 'sip-roof' }),
    makeLine(index, 'roof', 'Раскрой сип-панелей', mainSipCutting.cutMeters, { key: 'sip-cut', kind: 'labor', source: 'sip-roof' }),
    makeLine(index, 'roof', 'Пеноклей для СИП-панелей 650 мл', Math.ceil(mainSipCutting.panels * inputs.formulas.foamUnitsPerPanel), { key: 'sip-foam', source: 'sip-roof' }),
    makeLine(index, 'roof', 'Саморезы конст.', mainSipCutting.area * inputs.formulas.structuralFastenerKgPerM2, { key: 'sip-fasteners', unit: 'кг', source: 'sip-roof' }),
    makeLine(index, 'roof', sipPanelName(project.settings.sip.wallThickness), mainGableSipCutting.panels, { key: 'gable-sip-panel', source: 'gables' }),
    makeLine(index, 'roof', 'Монтаж сип-панели пол/стены', mainGableSipCutting.area, { key: 'gable-sip-install', kind: 'labor', name: 'Монтаж тёплых SIP-фронтонов', source: 'gables' }),
    makeLine(index, 'roof', 'Раскрой сип-панелей', mainGableSipCutting.cutMeters, { key: 'gable-sip-cut', kind: 'labor', source: 'gables' }),
    makeLine(index, 'roof', 'Пеноклей для СИП-панелей 650 мл', Math.ceil(mainGableSipCutting.panels * inputs.formulas.foamUnitsPerPanel), { key: 'gable-sip-foam', source: 'gables' }),
    makeLine(index, 'roof', 'Саморезы конст.', mainGableSipCutting.area * inputs.formulas.structuralFastenerKgPerM2, { key: 'gable-sip-fasteners', unit: 'кг', source: 'gables' }),
    ...extensionLines
  ]);
  return {
    lines, extensionLines, geometry, mainRoofShape, terraceRoofs, sipCutting, gableSipCutting, mainGableType, rafterStructure,
    coldSlopeArea: round(coldSlopeArea), warmSlopeArea: round(warmSlopeArea),
    coldGableArea: round(coldGableArea), warmGableArea: round(warmGableArea),
    coldArea: round(coldSlopeArea), warmArea: round(warmSlopeArea),
    coldConstructionArea: round(coldArea), warmConstructionArea: round(warmArea), gableArea: round(gableArea),
    insulatedRafterArea: round(insulatedRafterArea), terracePostCount, totalArea: round(totalArea),
    mauerlatLength: round(mauerlatLength, 3), mauerlatPurchaseLength: round(mauerlatPurchaseLength, 3), mauerlatBoardCount, mauerlatAnchors,
    ridgeBeamLength: round(ridgeBeamLength, 3), structuralRidgeBeamLength: round(structuralRidgeBeamLength, 3), ridgeBeamPurchaseLength: round(ridgeBeamPurchaseLength, 3),
    rafterLegLength: round(mainRafterLegLength, 3), rafterRequiredLength: round(mainRafterRequiredLength, 3),
    rafterBoardCount: mainRafterBoardCount, rafterPurchaseLength: round(mainRafterPurchaseLength, 3),
    mainEaveLength: round(mainEaveLength, 3), mainVergeLength: round(mainVergeLength, 3),
    eaveOverhang: round(eaveOverhang, 3), gableOverhang: round(gableOverhang, 3),
    mainEaveTrimPurchaseLength: round(mainEaveTrimPurchaseLength, 3), mainVergeTrimPurchaseLength: round(mainVergeTrimPurchaseLength, 3),
    lathStep, lathSection, mainLathRequiredLength: round(mainLathRequiredLength, 3), mainLathBoardCount,
    gutterLength: round(gutterLength, 3), gutterPieces, gutterConnectors, gutterEndCaps, gutterBrackets, gutterOutlets,
    downpipeLength: round(downpipeLength, 3), gutterElbows, downpipeClamps
  };
}

function terraceSection(project, index, inputs) {
  if (!project.services.terrace) return { lines: [], area: 0 };
  const platforms = project.plan.platforms.filter((platform) => platform.include !== false);
  const area = platforms.reduce((sum, platform) => sum + platform.w * platform.h, 0);
  const perimeter = platforms.reduce((sum, platform) => sum + 2 * (platform.w + platform.h), 0);
  const stairs = platforms.reduce((sum, platform) => sum + (Math.round(platform.steps) || 0), 0);
  const staircases = platforms.filter((platform) => Number(platform.steps) > 0).length;
  return {
    area: round(area),
    lines: compact([
      makeLine(index, 'terrace', 'Монтаж каркаса террасы', area, { key: 'frame-work', kind: 'labor', unit: 'м²' }),
      makeLine(index, 'terrace', 'Монтаж настила террасы', area, { key: 'deck-work', kind: 'labor', unit: 'м²' }),
      makeLine(index, 'terrace', 'Доска ест. влажн. сосна 50х150мм', perimeter * 0.05 * 0.15 + area * inputs.formulas.terraceFrameBoardM3PerM2, { key: 'frame-board', unit: 'м³', digits: 3 }),
      makeLine(index, 'terrace', 'Доска террасная 45×145 мм', area * 0.045 * inputs.formulas.terraceDeckReserve, { key: 'deck', unit: 'м³', digits: 3 }),
      makeLine(index, 'terrace', 'Саморезы 4.2 x 75', area * inputs.formulas.terraceScrewKgPerM2, { key: 'screws', unit: 'кг' }),
      makeLine(index, 'terrace', 'Ступень лестницы', stairs, { key: 'steps' }),
      makeLine(index, 'terrace', 'Изготовление лестниц', staircases, { key: 'steps-work', kind: 'labor', unit: 'шт' })
    ])
  };
}

function openingSection(project, index) {
  if (!project.services.openings) return { lines: [] };
  const lines = [];
  project.plan.openings.forEach((opening, openingIndex) => {
    const width = Math.round((opening.width || 0.8) * 1000);
    const height = Math.round((opening.height || 2) * 1000);
    const garage = opening.type === 'door' && opening.doorType === 'garage';
    const type = opening.type === 'window' ? 'Окно' : garage ? 'Гаражные ворота' : opening.doorType === 'interior' ? 'Комплект межкомнатной двери' : 'Дверь входная';
    const item = findCatalog(index, `${type} ${width}`) || findCatalog(index, type);
    lines.push(makeLine(index, 'openings', item?.name || `${type} ${width}×${height}`, 1, { key: `opening-${openingIndex}`, name: item?.name || `${type} ${width}×${height} мм`, unit: 'шт' }));
    const work = opening.type === 'window' ? 'Монтаж окна' : garage ? 'Монтаж гаражных ворот' : opening.doorType === 'interior' ? 'Установка межкомнатной двери' : 'Монтаж двери';
    lines.push(makeLine(index, 'openings', work, opening.type === 'window' ? opening.width * opening.height : 1, { key: `work-${openingIndex}`, kind: 'labor' }));
    if (!garage) lines.push(makeLine(index, 'openings', 'Комплект крепежа для монтажа окна / двери', 1, { key: `fastener-${openingIndex}`, unit: 'компл' }));
  });
  return { lines: compact(lines) };
}

function engineeringSection(project, index, inputs) {
  const s = inputs.engineering;
  const lines = [];
  if (project.services.engineeringElectric) {
    lines.push(makeLine(index, 'engineering', 'Кабель ВВГнг-LS 3×1,5', s.cableRoute * 0.45, { key: 'cable-light', unit: 'м' }));
    lines.push(makeLine(index, 'engineering', 'Кабель ВВГнг-LS 3×2,5', s.cableRoute * 0.55, { key: 'cable-power', unit: 'м' }));
    lines.push(makeLine(index, 'engineering', 'Монтаж электрической точки', s.electricPoints, { key: 'electric-work', kind: 'labor', unit: 'точка' }));
  }
  if (project.services.engineeringPlumbing) {
    lines.push(makeLine(index, 'engineering', 'Труба полипропиленовая', s.waterPipe, { key: 'water-pipe', unit: 'м' }));
    lines.push(makeLine(index, 'engineering', 'Монтаж точки водоснабжения', s.waterPoints, { key: 'water-work', kind: 'labor', unit: 'точка' }));
  }
  if (project.services.engineeringSewerage) {
    lines.push(makeLine(index, 'engineering', 'Труба канализационная 110', s.sewerLength, { key: 'sewer-pipe', unit: 'м' }));
    lines.push(makeLine(index, 'engineering', 'Монтаж внутренней канализации', s.sewerPoints, { key: 'sewer-work', kind: 'labor', unit: 'точка' }));
  }
  if (project.services.engineeringVentilation) {
    lines.push(makeLine(index, 'engineering', 'Воздуховод', s.ventDuct, { key: 'vent-duct', unit: 'м' }));
    lines.push(makeLine(index, 'engineering', 'Монтаж вентиляционной решётки', s.ventGrilles, { key: 'vent-work', kind: 'labor', unit: 'шт' }));
  }
  return { lines: compact(lines) };
}

function finishSections(project, index, inputs) {
  const internal = inputs.internal;
  const external = inputs.external;
  const internalLines = project.services.internalFinish ? compact([
    makeLine(index, 'internal', 'Монтаж имитации бруса', internal.wallArea, { key: 'wall-work', kind: 'labor', unit: 'м²' }),
    makeLine(index, 'internal', 'Имитация бруса', internal.wallArea * 0.016, { key: 'wall-material', unit: 'м³' }),
    makeLine(index, 'internal', 'Ламинат', internal.laminateArea * 1.05, { key: 'laminate', unit: 'м²' }),
    makeLine(index, 'internal', 'Монтаж ламината', internal.laminateArea, { key: 'laminate-work', kind: 'labor', unit: 'м²' }),
    makeLine(index, 'internal', 'Плитка', internal.tileArea * 1.07, { key: 'tile', unit: 'м²' }),
    makeLine(index, 'internal', 'Укладка плитки', internal.tileArea, { key: 'tile-work', kind: 'labor', unit: 'м²' }),
    makeLine(index, 'internal', 'Комплект межкомнатной двери', internal.doors, { key: 'doors', unit: 'шт' })
  ]) : [];
  const externalLines = project.services.externalFinish ? compact([
    makeLine(index, 'external', 'Монтаж обрешётки фасада', external.facadeArea, { key: 'facade-work', kind: 'labor', unit: 'м²' }),
    makeLine(index, 'external', 'Ветро-влагозащита', Math.ceil(external.windArea / 70), { key: 'wind', unit: 'рулон' }),
    makeLine(index, 'external', 'Утеплитель 50мм', external.insulationArea * 0.05, { key: 'insulation', unit: 'м³' }),
    makeLine(index, 'external', 'Профлист С-21 окрашенный', external.metalArea, { key: 'metal', unit: 'м²' }),
    makeLine(index, 'external', 'Саморезы кровельные', Math.ceil(external.metalArea * 8), { key: 'screws', unit: 'шт' })
  ]) : [];
  return { internalLines, externalLines };
}

function deliverySection(project, index, inputs) {
  if (!project.services.delivery) return { lines: [] };
  const d = project.settings.delivery;
  return {
    lines: compact([
      makeLine(index, 'delivery', 'Доставка — базовая стоимость рейса', d.trips, { key: 'base', unit: 'рейс', price: d.baseTrip }),
      makeLine(index, 'delivery', 'Доставка — стоимость 1 км', d.distance * d.trips, { key: 'distance', unit: 'км', price: d.perKm }),
      makeLine(index, 'delivery', 'Погрузка/разгрузка материала', inputs.delivery.cargoVolume, { key: 'unload', unit: 'м³', price: d.unloadingPerM3 })
    ])
  };
}

export function calculateProject(project) {
  const metrics = calculatePlanMetrics(project.plan);
  const inputs = deriveLinkedInputs(project, metrics);
  const index = catalogIndex(project);
  const foundation = foundationSection(project, index, inputs);
  const roof = roofSection(project, metrics, index, inputs);
  const sip = sipSection(project, metrics, index, inputs);
  const terrace = terraceSection(project, index, inputs);
  const openings = openingSection(project, index);
  const engineering = engineeringSection(project, index, inputs);
  const finishes = finishSections(project, index, inputs);
  const delivery = deliverySection(project, index, inputs);
  const sections = applyProjectEstimateEdits(project, [
    { key: 'foundation', title: 'Свайно-винтовой фундамент и обвязка', lines: foundation.lines },
    { key: 'sip', title: 'СИП-конструкции и перегородки', lines: sip.lines },
    { key: 'roof', title: 'Кровля и фронтоны', lines: roof.lines },
    { key: 'terrace', title: 'Терраса и крыльцо', lines: terrace.lines },
    { key: 'openings', title: 'Окна и двери', lines: openings.lines },
    { key: 'engineering', title: 'Инженерные системы', lines: engineering.lines },
    { key: 'internal', title: 'Внутренняя отделка', lines: finishes.internalLines },
    { key: 'external', title: 'Наружная отделка', lines: finishes.externalLines },
    { key: 'delivery', title: 'Доставка и логистика', lines: delivery.lines }
  ]).filter((section) => section.lines.length || (project.estimateOverrides || []).some((item) => item.section === section.key));
  const lines = sections.flatMap((section) => section.lines);
  const totals = lines.reduce((acc, line) => {
    const sum = line.qty * line.price;
    if (line.kind === 'labor') acc.labor += sum;
    else acc.materials += sum;
    return acc;
  }, { materials: 0, labor: 0 });
  totals.total = totals.materials + totals.labor;
  return { metrics, inputs, foundation: foundation.foundation, sip, roof, terrace, sections, lines, totals };
}
