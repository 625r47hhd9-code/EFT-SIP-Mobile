const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

export const DEFAULT_LINKS = {
  roofRidgeFromPlan: true,
  engineeringFromPlan: true,
  internalFinishFromPlan: true,
  externalFinishFromPlan: true,
  deliveryVolumeFromPlan: true
};

export const DEFAULT_FORMULAS = {
  roofRidgeExtra: 1,
  cableMetersPerM2: 1.2,
  electricPointsPerM2: 0.5,
  waterPipeMetersPerM2: 0.35,
  waterPointsPerWetRoom: 3,
  sewerMetersPerWetRoom: 5,
  sewerPointsPerWetRoom: 2,
  ventMetersPerWetRoom: 3,
  ventGrillesPerWetRoom: 1,
  cargoM3PerM2: 0.18,
  terraceCargoM3PerM2: 0.08,
  internalPartitionFaces: 2,
  laminateShare: 0.75,
  tileShare: 0.25,
  panelArea: 3.125,
  panelWidth: 1.25,
  panelLength: 2.5,
  sipTimberReservePercent: 5,
  partitionBoardM3PerM2: 0.014,
  foamUnitsPerPanel: 0.5,
  structuralFastenerKgPerM2: 0.045,
  seamScrewKgPerM2: 0.012,
  spiralPackPerPanels: 35,
  pileConcreteM3: 0.01333,
  pileScrewKg: 0.12,
  pileLagScrews: 4,
  rafterLinearMPerM2: 2.456,
  hangingRafterReserve: 1.2,
  layeredRafterReserve: 1.12,
  trussRafterReserve: 1.55,
  gableBoardM3PerM2: 0.015,
  lathM3PerM2: 0.00655,
  roofScrewsPerM2: 8,
  roofGeneralFastenerKgPerM2: 0.08,
  ridgeReserve: 1.1,
  mauerlatReserve: 1.05,
  mauerlatAnchorSpacing: 1.2,
  ridgeBeamReserve: 1.05,
  roofTrimReserve: 1.1,
  gutterBracketSpacing: 0.6,
  gutterOutletSpacing: 12,
  downpipeClampSpacing: 1.5,
  rafterInsulationThicknessM: 0.2,
  vaporBarrierRollArea: 70,
  terraceRoofPostSpacing: 3,
  terraceFrameBoardM3PerM2: 0.024,
  terraceDeckReserve: 1.05,
  terraceScrewKgPerM2: 0.12
};

const WET_ROOM = /(сануз|ванн|душ|котель|бойлер|кухн)/i;

export function deriveLinkedInputs(project, metrics) {
  const links = { ...DEFAULT_LINKS, ...(project.settings.links || {}) };
  const f = { ...DEFAULT_FORMULAS, ...(project.settings.formulas || {}) };
  const settings = project.settings;
  const wetRooms = (project.plan.rooms || []).filter((room) => room.include !== false && WET_ROOM.test(room.name || '')).length;
  const interiorDoors = (project.plan.openings || []).filter((opening) => opening.type === 'door' && !opening.outer).length;
  const platformArea = metrics.platformArea || 0;
  const value = (auto, computed, manual) => round(auto ? computed : manual, 3);
  return {
    links,
    formulas: f,
    wetRooms,
    roof: {
      ridgeLength: value(links.roofRidgeFromPlan, project.plan.house.w + f.roofRidgeExtra, settings.roof.ridgeLength)
    },
    engineering: {
      cableRoute: value(links.engineeringFromPlan, metrics.roomArea * f.cableMetersPerM2, settings.engineering.cableRoute),
      electricPoints: Math.round(value(links.engineeringFromPlan, metrics.roomArea * f.electricPointsPerM2, settings.engineering.electricPoints)),
      waterPipe: value(links.engineeringFromPlan, metrics.roomArea * f.waterPipeMetersPerM2, settings.engineering.waterPipe),
      waterPoints: Math.round(value(links.engineeringFromPlan, wetRooms * f.waterPointsPerWetRoom, settings.engineering.waterPoints)),
      sewerLength: value(links.engineeringFromPlan, wetRooms * f.sewerMetersPerWetRoom, settings.engineering.sewerLength),
      sewerPoints: Math.round(value(links.engineeringFromPlan, wetRooms * f.sewerPointsPerWetRoom, settings.engineering.sewerPoints)),
      ventDuct: value(links.engineeringFromPlan, wetRooms * f.ventMetersPerWetRoom, settings.engineering.ventDuct),
      ventGrilles: Math.round(value(links.engineeringFromPlan, wetRooms * f.ventGrillesPerWetRoom, settings.engineering.ventGrilles))
    },
    internal: {
      wallArea: value(links.internalFinishFromPlan, metrics.exteriorWallNetArea + metrics.partitionNetArea * f.internalPartitionFaces, settings.internal.wallArea),
      ceilingArea: value(links.internalFinishFromPlan, metrics.ceilingArea, settings.internal.ceilingArea),
      laminateArea: value(links.internalFinishFromPlan, metrics.roomArea * f.laminateShare, settings.internal.laminateArea),
      tileArea: value(links.internalFinishFromPlan, metrics.roomArea * f.tileShare, settings.internal.tileArea),
      doors: Math.round(value(links.internalFinishFromPlan, interiorDoors, settings.internal.doors))
    },
    external: {
      facadeArea: value(links.externalFinishFromPlan, metrics.exteriorWallNetArea, settings.external.facadeArea),
      windArea: value(links.externalFinishFromPlan, metrics.exteriorWallNetArea, settings.external.windArea),
      insulationArea: value(links.externalFinishFromPlan, metrics.exteriorWallNetArea, settings.external.insulationArea),
      metalArea: value(links.externalFinishFromPlan, metrics.exteriorWallNetArea, settings.external.metalArea),
      soffitArea: value(links.externalFinishFromPlan, metrics.perimeter * 0.6, settings.external.soffitArea)
    },
    delivery: {
      cargoVolume: value(links.deliveryVolumeFromPlan, metrics.roomArea * f.cargoM3PerM2 + platformArea * f.terraceCargoM3PerM2, settings.delivery.cargoVolume)
    }
  };
}

export function calculationFlowRows(project, calculation) {
  const { metrics, inputs } = calculation;
  const f = inputs.formulas;
  return [
    { group: 'Геометрия', source: 'Габарит дома', formula: `${project.plan.house.w} × ${project.plan.house.h}`, result: metrics.floorArea, unit: 'м²', target: 'СИП-пол и базовый потолок даже без комнат' },
    { group: 'Геометрия', source: 'Комнаты «Второй свет»', formula: `${metrics.floorArea} − ${metrics.openCeilingArea}`, result: metrics.ceilingArea, unit: 'м²', target: 'Горизонтальный СИП-потолок' },
    { group: 'Геометрия', source: 'Комнаты плана', formula: 'Сумма площадей включённых комнат', result: metrics.roomArea, unit: 'м²', target: 'Отделка и инженерия' },
    { group: 'Геометрия', source: 'Периметр × высота − окна/двери', formula: `${metrics.perimeter} × ${project.plan.wallHeight} − ${metrics.exteriorOpeningsArea}`, result: metrics.exteriorWallNetArea, unit: 'м²', target: 'СИП-стены, фасад' },
    { group: 'Геометрия', source: 'Уникальные перегородки', formula: `${metrics.partitionLength} × ${project.plan.wallHeight} − ${metrics.interiorOpeningsArea}`, result: metrics.partitionNetArea, unit: 'м²', target: 'Перегородки, внутренняя отделка' },
    { group: 'Фундамент', source: 'Свайные ряды + пристройки', formula: 'Объединение совпадающих точек', result: calculation.foundation.totalPiles, unit: 'шт', target: 'Сваи, оголовки, крепёж, работы' },
    { group: 'Фундамент', source: 'Нарисованные линии обвязки', formula: `ceil(${calculation.foundation.bindingLength} м × ${calculation.foundation.bindingLayers} слоя ÷ 6 м)`, result: calculation.foundation.boardCount, unit: 'досок по 6 м', target: `Доска обвязки 50×150 · ${calculation.foundation.boardVolume} м³` },
    { group: 'СИП', source: 'Пол + наружные стены + потолок', formula: `ceil(площадь ÷ ${f.panelArea} × запас)`, result: calculation.sip.cutting.reduce((sum, row) => sum + row.panels, 0), unit: 'панелей', target: 'Панели, пена, саморезы, раскрой СИП' },
    { group: 'СИП', source: 'Сетка панелей и торцы', formula: `стыки сетки + ${f.sipTimberReservePercent}%`, result: calculation.sip.joinery.totalJointLength, unit: 'м', target: 'Термобрус / пакет досок / цельный брус' },
    { group: 'Кровля', source: 'Габарит дома', formula: `длина дома + ${f.roofRidgeExtra}`, result: inputs.roof.ridgeLength, unit: 'м', target: 'Конёк и площадь скатов', auto: inputs.links.roofRidgeFromPlan },
    { group: 'Кровля', source: 'Две опорные стены двускатной крыши', formula: `2 × длина дома × ${f.mauerlatReserve}`, result: calculation.roof.mauerlatPurchaseLength, unit: 'м.п.', target: 'Мауэрлат 100×150, анкеры и монтаж' },
    { group: 'Кровля', source: 'Стропильная схема', formula: `ceil(${calculation.roof.rafterStructure?.frameLength || 0} ÷ (${calculation.roof.rafterStructure?.step || 0} + 0,05)) + 1 = ${calculation.roof.rafterStructure?.pairCount || 0} пар; пиломатериал ceil(Σ ÷ 6)`, result: calculation.roof.rafterBoardCount, unit: 'досок по 6 м', target: `Стропила ${(calculation.roof.rafterStructure?.section || '50x150').replace('x', '×')}` },
    { group: 'Кровля', source: 'Линия конька', formula: `длина конька × ${f.ridgeBeamReserve}`, result: calculation.roof.ridgeBeamPurchaseLength, unit: 'м.п.', target: 'Коньковая доска и обязательная коньковая планка' },
    { group: 'Кровля', source: 'Карнизы и торцы скатов', formula: `карнизы 2L; торцы 4 × длина ската; запас ${f.roofTrimReserve}`, result: (project.settings.roof.includeEaveTrim === false ? 0 : calculation.roof.mainEaveTrimPurchaseLength) + (project.settings.roof.includeVergeTrim === false ? 0 : calculation.roof.mainVergeTrimPurchaseLength), unit: 'м.п.', target: 'Выбранные доборные планки с монтажом' },
    { group: 'Кровля', source: 'Площадь скатов и шаг обрешётки', formula: `${calculation.roof.geometry?.totalSlopeArea || 0} ÷ ${calculation.roof.lathStep || 0.35} + карнизные ряды; ceil(Σ ÷ 6)`, result: calculation.roof.mainLathBoardCount || 0, unit: 'досок по 6 м', target: 'Обрешётка 25×100 и её монтаж' },
    { group: 'Кровля', source: 'Карнизы основной крыши', formula: project.settings.roof.includeGutter === true ? `жёлоб ${calculation.roof.gutterLength || 0} м; выпусков ${calculation.roof.gutterOutlets || 0}; трубы ${calculation.roof.downpipeLength || 0} м` : 'водосточная система отключена', result: calculation.roof.gutterLength || 0, unit: 'м.п.', target: 'Комплект водостока и монтаж' },
    { group: 'Кровля', source: 'Фронтоны основной крыши и пристроек', formula: 'Σ основание × высота ÷ 2 × количество', result: calculation.roof.gableArea, unit: 'м²', target: 'Каркасные или SIP-фронтоны, облицовка и работы' },
    { group: 'Кровля', source: 'Наружный край кровель террас', formula: `ceil(длина ÷ ${f.terraceRoofPostSpacing}) + 1`, result: calculation.roof.terracePostCount, unit: 'столбов', target: 'Брус 100×100 или 150×100 по толщине стен' },
    { group: 'Кровля', source: 'Зоны второго света', formula: `площадь зоны × коэффициент ската`, result: calculation.roof.insulatedRafterArea, unit: 'м²', target: 'Стропила, минвата и пароизоляция' },
    { group: 'Террасы', source: 'Площадки плана', formula: 'Σ ширина × глубина', result: calculation.terrace.area, unit: 'м²', target: 'Настил, каркас, лестницы, кровля' },
    { group: 'Проёмы', source: 'Окна и двери плана', formula: 'Количество и индивидуальные размеры', result: project.plan.openings.length, unit: 'шт', target: 'Вычеты стен, изделия, монтаж' },
    { group: 'Инженерия', source: 'Площадь + названия мокрых комнат', formula: `${metrics.roomArea} м²; мокрых комнат: ${inputs.wetRooms}`, result: inputs.engineering.cableRoute, unit: 'м кабеля', target: 'Электрика, вода, канализация, вентиляция', auto: inputs.links.engineeringFromPlan },
    { group: 'Отделка', source: 'Стены, перегородки, пол и двери плана', formula: `наружные стены + перегородки × ${f.internalPartitionFaces}`, result: inputs.internal.wallArea, unit: 'м²', target: 'Внутренняя и наружная отделка', auto: inputs.links.internalFinishFromPlan && inputs.links.externalFinishFromPlan },
    { group: 'Доставка', source: 'Дом + террасы', formula: `${metrics.roomArea} × ${f.cargoM3PerM2} + ${metrics.platformArea} × ${f.terraceCargoM3PerM2}`, result: inputs.delivery.cargoVolume, unit: 'м³', target: 'Разгрузка и число рейсов', auto: inputs.links.deliveryVolumeFromPlan }
  ];
}
