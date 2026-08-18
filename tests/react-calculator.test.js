import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProject } from '../src/react/calculations/estimate-engine.js';
import { buildCommercialScope } from '../src/react/calculations/commercial-scope.js';
import { bindingLinesFromPileRows, calculateFoundation, generateAutoPileRows, generatePileGrid, generateAutoBindingLines } from '../src/react/calculations/foundation-model.js';
import { createDefaultProject, createProjectWithCurrentPrices, migrateProject } from '../src/react/state/project-model.js';
import { verifyPricePasscode } from '../src/react/security/price-access.js';

test('price editor accepts only the configured passcode', () => {
  assert.equal(verifyPricePasscode('1455'), true);
  assert.equal(verifyPricePasscode(' 1455 '), true);
  assert.equal(verifyPricePasscode('1454'), false);
  assert.equal(verifyPricePasscode(''), false);
});

test('a new project inherits current protected prices without sharing array references', () => {
  const current = createDefaultProject();
  current.priceMat[0].price = 12345;
  current.priceLab[0].price = 54321;
  const next = createProjectWithCurrentPrices(current);
  assert.equal(next.priceMat[0].price, 12345);
  assert.equal(next.priceLab[0].price, 54321);
  next.priceMat[0].price = 1;
  assert.equal(current.priceMat[0].price, 12345);
});

test('React project produces a priced estimate from one shared model', () => {
  const project = createDefaultProject();
  const result = calculateProject(project);
  assert.ok(result.sections.some((section) => section.key === 'foundation'));
  assert.ok(result.sections.some((section) => section.key === 'sip'));
  assert.ok(result.sections.some((section) => section.key === 'roof'));
  assert.ok(result.totals.materials > 0);
  assert.ok(result.totals.labor > 0);
  assert.equal(result.totals.total, result.totals.materials + result.totals.labor);
});

test('print plan layers default to piles, binding and dimensions and survive migration', () => {
  const project = createDefaultProject();
  assert.deepEqual(project.settings.print, {
    includePlan: true, includeRoof: false, showPiles: true, showBinding: true, showDimensions: true
  });
  project.settings.print.showPiles = false;
  project.settings.print.showDimensions = false;
  const restored = migrateProject(project);
  assert.equal(restored.settings.print.showPiles, false);
  assert.equal(restored.settings.print.showBinding, true);
  assert.equal(restored.settings.print.showDimensions, false);
});

test('625 mm SIP layout increases floor and ceiling joints and cutting without doubling panels', () => {
  const standardProject = createDefaultProject();
  const standard = calculateProject(standardProject);
  const reinforcedProject = createDefaultProject();
  reinforcedProject.settings.sip.floorPanelWidth = '0.625';
  reinforcedProject.settings.sip.ceilingPanelWidth = '0.625';
  const reinforced = calculateProject(reinforcedProject);

  for (const key of ['floor', 'ceiling']) {
    const baseCut = standard.sip.cutting.find((row) => row.key === key);
    const reinforcedCut = reinforced.sip.cutting.find((row) => row.key === key);
    const baseJoint = standard.sip.joinery.rows.find((row) => row.key === key);
    const reinforcedJoint = reinforced.sip.joinery.rows.find((row) => row.key === key);
    assert.equal(reinforcedCut.panels, baseCut.panels);
    assert.ok(reinforcedCut.cutMeters > baseCut.cutMeters);
    assert.ok(reinforcedJoint.jointLength > baseJoint.jointLength);
    assert.equal(reinforced.lines.find((line) => line.id === `sip:cut-${key}`).qty, reinforcedCut.cutMeters);
    assert.equal(reinforced.lines.find((line) => line.id === `sip:${key}-connector`).qty, Math.round(reinforcedJoint.jointLength * 100) / 100);
  }
});

test('commercial proposal lists only priced sections and explains their scope', () => {
  const project = createDefaultProject();
  project.services.engineeringElectric = true;
  project.services.internalFinish = false;
  const calculation = calculateProject(project);
  const scope = buildCommercialScope(project, calculation);
  const foundation = scope.find((item) => item.key === 'foundation');
  const engineering = scope.find((item) => item.key === 'engineering');

  assert.match(foundation.summary, new RegExp(`^${calculation.foundation.totalPiles} сва`));
  assert.deepEqual(foundation.coverage, ['Материалы', 'Работы']);
  assert.match(foundation.total, /₽/);
  assert.match(engineering.summary, /электрика/);
  assert.equal(scope.some((item) => item.key === 'internal'), false);
});

test('commercial proposal follows project estimate edits instead of promising removed sections', () => {
  const project = createDefaultProject();
  project.services.openings = false;
  project.services.delivery = false;
  const scope = buildCommercialScope(project, calculateProject(project));

  assert.equal(scope.some((item) => item.key === 'openings'), false);
  assert.equal(scope.some((item) => item.key === 'delivery'), false);
});

test('warm main roof and terrace roofs are cut only in the roof section', () => {
  const project = createDefaultProject();
  project.settings.roof.type = 'sip';
  project.plan.platforms[0].roof.mode = 'warm';
  const result = calculateProject(project);
  assert.ok(result.roof.warmArea > 0);
  assert.deepEqual(result.sip.cutting.map((row) => row.key), ['floor', 'walls', 'ceiling']);
  assert.ok(result.roof.sipCutting.area > 0);
  assert.ok(result.roof.sipCutting.panels > 0);
  assert.equal(result.lines.filter((line) => line.id === 'roof:sip-panel').length, 1);
});

test('cold roof defaults to 50x150 rafters and includes cold gables', () => {
  const project = createDefaultProject();
  const result = calculateProject(project);
  const rafters = result.lines.find((line) => line.id === 'roof:rafters');
  assert.match(rafters.name, /50×150/);
  assert.equal(rafters.catalogId, 'MAT-023');
  assert.ok(result.roof.gableArea > 0);
  assert.equal(result.roof.coldGableArea, result.roof.geometry.gableArea);
  assert.ok(result.lines.some((line) => line.id === 'roof:gable-frame-work' && line.catalogId === 'LAB-027'));
  const coverWork = result.lines.find((line) => line.id === 'roof:cover-work');
  assert.equal(coverWork.catalogId, 'LAB-031');
  assert.ok(coverWork.qty > 0);
});

test('gable roof includes mauerlat and adds the ridge board to matching rafter material', () => {
  const project = createDefaultProject();
  const result = calculateProject(project);
  const houseLength = project.plan.house.w;
  const mauerlat = result.lines.find((line) => line.id === 'roof:mauerlat-timber');
  const mauerlatWork = result.lines.find((line) => line.id === 'roof:mauerlat-work');
  const anchors = result.lines.find((line) => line.id === 'roof:mauerlat-anchors');
  const rafters = result.lines.find((line) => line.id === 'roof:rafters');
  assert.equal(mauerlat.catalogId, 'MAT-018');
  assert.equal(mauerlat.qty, Math.round(result.roof.mauerlatBoardCount * 6 * 0.1 * 0.15 * 1000) / 1000);
  assert.match(mauerlat.name, /шт × 6 м/);
  assert.equal(mauerlatWork.catalogId, 'LAB-033');
  assert.equal(mauerlatWork.qty, houseLength * 2);
  assert.equal(anchors.catalogId, 'MAT-067');
  assert.equal(anchors.qty, 2 * (Math.ceil(houseLength / result.inputs.formulas.mauerlatAnchorSpacing) + 1));
  assert.equal(rafters.catalogId, 'MAT-023');
  assert.equal(rafters.qty, result.roof.rafterBoardCount * 6 * 0.05 * 0.15);
  assert.equal(result.roof.rafterStructure.step, 0.6);
  assert.equal(result.roof.rafterStructure.pairCount, Math.ceil(project.plan.house.w / 0.65) + 1);
  assert.match(rafters.name, /включая коньковый прогон/);
  assert.equal(result.lines.some((line) => line.id === 'roof:ridge-beam'), false);
  assert.equal(result.lines.some((line) => line.id === 'roof:ridge-beam-work'), false);
  assert.ok(result.lines.some((line) => line.id === 'roof:eave-trim' && line.catalogId === 'MAT-038'));
  assert.ok(result.lines.some((line) => line.id === 'roof:eave-trim-work' && line.catalogId === 'LAB-028'));
  assert.ok(result.lines.some((line) => line.id === 'roof:verge-trim' && line.catalogId === 'MAT-040'));
  assert.ok(result.lines.some((line) => line.id === 'roof:verge-trim-work' && line.catalogId === 'LAB-039'));
  assert.ok(result.lines.some((line) => line.id === 'roof:ridge-work' && line.catalogId === 'LAB-029'));
});

test('main roof overhangs increase covering, rafters, ridge, trims and gutter length', () => {
  const project = createDefaultProject();
  project.settings.roof.eaveOverhang = 0;
  project.settings.roof.gableOverhang = 0;
  project.settings.roof.includeGutter = true;
  const withoutOverhangs = calculateProject(project);
  project.settings.roof.eaveOverhang = 0.5;
  project.settings.roof.gableOverhang = 0.3;
  const withOverhangs = calculateProject(project);
  assert.ok(withOverhangs.roof.geometry.totalSlopeArea > withoutOverhangs.roof.geometry.totalSlopeArea);
  assert.ok(withOverhangs.roof.rafterLegLength > withoutOverhangs.roof.rafterLegLength);
  assert.equal(withOverhangs.roof.ridgeBeamLength, withoutOverhangs.roof.ridgeBeamLength + 0.6);
  assert.equal(withOverhangs.roof.mainEaveLength, withoutOverhangs.roof.mainEaveLength + 1.2);
  assert.ok(withOverhangs.roof.mainVergeLength > withoutOverhangs.roof.mainVergeLength);
  assert.equal(withOverhangs.roof.gutterLength, withOverhangs.roof.mainEaveLength);
});

test('main roof switches to one flat plane without ridge and gables', () => {
  const project = createDefaultProject();
  project.settings.roof.shape = 'flat';
  const result = calculateProject(project);
  assert.equal(result.roof.mainRoofShape, 'flat');
  assert.equal(result.roof.geometry.totalSlopeArea, Math.round((project.plan.house.h + project.settings.roof.eaveOverhang * 2) * (result.inputs.roof.ridgeLength + project.settings.roof.gableOverhang * 2) * 100) / 100);
  assert.equal(result.roof.gableArea, 0);
  assert.equal(result.lines.some((line) => line.id === 'roof:ridge'), false);
  assert.equal(result.lines.some((line) => line.id === 'roof:gable-frame'), false);
  assert.ok(result.lines.some((line) => line.id === 'roof:cover-work' && line.catalogId === 'LAB-031'));
});

test('main roof can count one exposed gable instead of two', () => {
  const project = createDefaultProject();
  project.settings.roof.gableCount = 1;
  const result = calculateProject(project);
  assert.equal(result.roof.gableArea, result.roof.geometry.gableArea / 2);
});

test('warm gables use wall SIP panels instead of a cold timber frame', () => {
  const project = createDefaultProject();
  project.settings.roof.type = 'sip';
  project.settings.roof.gableType = 'auto';
  project.settings.sip.wallThickness = '174';
  const result = calculateProject(project);
  assert.equal(result.roof.warmGableArea, result.roof.geometry.gableArea);
  assert.ok(result.lines.some((line) => line.id === 'roof:gable-sip-panel' && line.name.includes('174')));
  assert.equal(result.lines.some((line) => line.id === 'roof:gable-frame'), false);
});

test('terrace roof adds its slopes, posts and optional gable to the roof estimate', () => {
  const project = createDefaultProject();
  const terrace = project.plan.platforms[0];
  terrace.roof.mode = 'cold';
  terrace.roof.shape = 'gable';
  terrace.roof.gableType = 'cold';
  terrace.roof.gableCount = 1;
  project.settings.sip.wallThickness = '124';
  const result = calculateProject(project);
  assert.ok(result.roof.terraceRoofs[0].result.netArea > 0);
  assert.ok(result.roof.terraceRoofs[0].result.gableArea > 0);
  assert.ok(result.roof.terracePostCount > 0);
  const posts = result.roof.extensionLines.find((line) => line.source === 'platform-terrace-main-roof' && line.name.includes('Опорные столбы'));
  assert.equal(posts.catalogId, 'MAT-017');
  assert.match(posts.name, /100×100/);
  assert.ok(result.roof.extensionLines.some((line) => line.source === 'platform-terrace-main-roof' && line.name.includes('Профлист')));
  assert.ok(result.roof.extensionLines.some((line) => line.source === 'platform-terrace-main-roof' && line.name.includes('Монтаж профлиста') && line.catalogId === 'LAB-031'));
  const terraceRafters = result.roof.extensionLines.find((line) => line.source === 'platform-terrace-main-roof' && line.kind === 'material' && line.id.endsWith('-rafters'));
  assert.equal(terraceRafters.catalogId, 'MAT-023');
  assert.match(terraceRafters.name, /коньковый прогон/);
  assert.equal(result.roof.extensionLines.some((line) => line.id.includes('ridge-beam')), false);
  assert.ok(result.roof.extensionLines.some((line) => line.source === 'platform-terrace-main-roof' && line.name.includes('карнизная') && line.catalogId === 'MAT-038'));
  assert.ok(result.roof.extensionLines.some((line) => line.source === 'platform-terrace-main-roof' && line.name.includes('торцевая') && line.catalogId === 'MAT-040'));
});

test('50x200 rafters use the same 50x200 board for the ridge', () => {
  const project = createDefaultProject();
  project.settings.roof.structureMode = 'manual';
  project.settings.roof.rafterSection = '50x200';
  const result = calculateProject(project);
  const rafters = result.lines.find((line) => line.id === 'roof:rafters');
  assert.equal(rafters.catalogId, 'MAT-024');
  assert.equal(rafters.qty, Math.round(result.roof.rafterBoardCount * 6 * 0.05 * 0.2 * 1000) / 1000);
  assert.match(rafters.name, /50×200.*коньковый прогон/);
  assert.equal(result.lines.some((line) => line.name.includes('Коньковый прогон · брус 100×150')), false);
});

test('manual rafter step changes pair count and six-meter board purchase', () => {
  const project = createDefaultProject();
  project.settings.roof.structureMode = 'manual';
  project.settings.roof.rafterSystem = 'layered';
  project.settings.roof.rafterStep = 0.8;
  const result = calculateProject(project);
  assert.equal(result.roof.rafterStructure.system, 'layered');
  assert.equal(result.roof.rafterStructure.step, 0.8);
  assert.equal(result.roof.rafterStructure.pairCount, Math.ceil(project.plan.house.w / 0.85) + 1);
  assert.equal(result.roof.rafterPurchaseLength, result.roof.rafterBoardCount * 6);
});

test('rafter pairs use the house length, clear spacing and 50 mm board width', () => {
  const project = createDefaultProject();
  project.plan.house.w = 8;
  project.settings.roof.structureMode = 'manual';
  project.settings.roof.rafterStep = 0.6;
  const result = calculateProject(project);
  assert.equal(result.roof.rafterStructure.frameLength, 8);
  assert.equal(result.roof.rafterStructure.module, 0.65);
  assert.equal(result.roof.rafterStructure.pairCount, 14);
  assert.equal(result.roof.rafterStructure.legCount, 28);
});

test('manual roof supports trusses and lath quantity follows its selected step', () => {
  const project = createDefaultProject();
  project.settings.roof.structureMode = 'manual';
  project.settings.roof.rafterSystem = 'truss';
  project.settings.roof.lathStep = 0.4;
  const widerStep = calculateProject(project);
  project.settings.roof.lathStep = 0.2;
  const tighterStep = calculateProject(project);
  assert.equal(tighterStep.roof.rafterStructure.system, 'truss');
  assert.equal(tighterStep.roof.lathStep, 0.2);
  assert.ok(tighterStep.roof.mainLathBoardCount > widerStep.roof.mainLathBoardCount);
  assert.match(tighterStep.lines.find((line) => line.id === 'roof:lath').name, /шаг 200 мм/);
  assert.match(tighterStep.lines.find((line) => line.id === 'roof:rafters-work').name, /ферм/);
});

test('optional gutter adds a fully priced material and labor set', () => {
  const project = createDefaultProject();
  project.settings.roof.includeGutter = true;
  const result = calculateProject(project);
  const gutterIds = ['gutter', 'gutter-connectors', 'gutter-end-caps', 'gutter-brackets', 'gutter-outlets', 'downpipes', 'gutter-elbows', 'downpipe-clamps', 'gutter-work', 'downpipe-work'];
  gutterIds.forEach((key) => {
    const line = result.lines.find((item) => item.id === `roof:${key}`);
    assert.ok(line, `missing ${key}`);
    assert.ok(line.catalogId, `unpriced ${key}`);
    assert.ok(line.price > 0, `zero price ${key}`);
  });
  assert.equal(result.roof.gutterLength, result.roof.mainEaveLength);
  assert.ok(result.roof.gutterOutlets >= 2);
  assert.ok(result.roof.downpipeLength > 0);
});

test('optional roof trims can be removed while ridge remains included', () => {
  const project = createDefaultProject();
  project.settings.roof.includeEaveTrim = false;
  project.settings.roof.includeVergeTrim = false;
  project.settings.roof.includeRidgeSeal = false;
  const result = calculateProject(project);
  assert.equal(result.lines.some((line) => line.id === 'roof:eave-trim'), false);
  assert.equal(result.lines.some((line) => line.id === 'roof:verge-trim'), false);
  assert.equal(result.lines.some((line) => line.id === 'roof:ridge-seal'), false);
  assert.ok(result.lines.some((line) => line.id === 'roof:ridge'));
  assert.ok(result.lines.some((line) => line.id === 'roof:ridge-work'));
});

test('terrace and porch roof materials are listed separately in the roof estimate', () => {
  const project = createDefaultProject();
  const terrace = project.plan.platforms.find((platform) => platform.kind === 'terrace');
  const porch = project.plan.platforms.find((platform) => platform.kind === 'porch');
  terrace.roof.mode = 'cold';
  porch.roof.mode = 'warm';
  const result = calculateProject(project);
  const materialLines = result.roof.extensionLines.filter((line) => line.kind === 'material');
  assert.ok(materialLines.some((line) => line.source === 'platform-terrace-main-roof' && /террасы/.test(line.name)));
  assert.ok(materialLines.some((line) => line.source === 'platform-porch-main-roof' && /крыльца/.test(line.name)));
  assert.ok(materialLines.every((line) => result.sections.find((section) => section.key === 'roof').lines.includes(line)));
});

test('SIP joinery switches between thermobeam, board pack and solid beam', () => {
  const project = createDefaultProject();
  [['MAT-186', 'MAT-015'], ['MAT-187', 'MAT-013'], ['MAT-188', 'MAT-014']].forEach(([packageId, thermalId]) => {
    const packagePrice = project.priceMat.find((item) => item.id === packageId).price;
    const thermalPrice = project.priceMat.find((item) => item.id === thermalId).price;
    assert.equal(packagePrice, thermalPrice / 2);
  });
  const thermal = calculateProject(project);
  assert.ok(thermal.lines.some((line) => line.source === 'sip-walls-joints' && line.name.includes('Термобрус 95×145')));
  assert.ok(thermal.lines.some((line) => line.source === 'sip-walls-edges' && line.name.includes('145×45')));
  assert.ok(thermal.lines.some((line) => line.id === 'sip:fasteners-floor' && line.qty > 0));
  assert.ok(thermal.lines.some((line) => line.id === 'sip:seam-screws-walls' && line.qty > 0));
  project.settings.sip.connectorType = 'board-pack';
  const boardPack = calculateProject(project);
  const packageLine = boardPack.lines.find((line) => line.source === 'sip-walls-joints');
  assert.ok(packageLine.name.includes('95×145'));
  assert.equal(packageLine.price, project.priceMat.find((item) => item.id === 'MAT-187').price);
  project.settings.sip.connectorType = 'solid';
  const solid = calculateProject(project);
  const solidWall = solid.lines.find((line) => line.source === 'sip-walls-joints');
  assert.ok(solidWall.name.includes('100×150'));
  assert.equal(solidWall.unit, 'м.п.');
  assert.equal(solidWall.price, 396);
  const baseWallJoints = solid.sip.joinery.rows.find((row) => row.key === 'walls').jointLength;
  project.plan.wallHeight = 3;
  const tallWallJoints = calculateProject(project).sip.joinery.rows.find((row) => row.key === 'walls').jointLength;
  assert.ok(tallWallJoints > baseWallJoints, 'horizontal wall seams are added above one panel height');
});

test('SIP estimate is grouped by floor, walls, ceiling and partitions', () => {
  const project = createDefaultProject();
  const result = calculateProject(project);
  const sipLines = result.sections.find((section) => section.key === 'sip').lines;
  assert.deepEqual([...new Set(sipLines.map((line) => line.estimateGroup))], ['Пол', 'Наружные стены', 'Потолок', 'Перегородки']);
  assert.ok(sipLines.some((line) => line.estimateGroup === 'Пол' && line.name.includes('Пеноклей')));
  assert.ok(sipLines.some((line) => line.estimateGroup === 'Наружные стены' && line.source === 'sip-walls-joints'));
});

test('SIP adhesive uses the 650 ml catalog item at 550 rubles', () => {
  const project = createDefaultProject();
  const item = project.priceMat.find((line) => line.id === 'MAT-009');
  assert.equal(item.name, 'Пеноклей для СИП-панелей 650 мл');
  assert.equal(item.price, 550);
  const result = calculateProject(project);
  const adhesives = result.lines.filter((line) => line.catalogId === 'MAT-009');
  assert.ok(adhesives.length >= 3);
  assert.ok(adhesives.every((line) => line.price === 550 && line.name.includes('Пеноклей')));
});

test('roof has one general fastener line in addition to roofing screws', () => {
  const project = createDefaultProject();
  project.plan.platforms[0].roof.mode = 'cold';
  const result = calculateProject(project);
  const general = result.lines.filter((line) => line.id === 'roof:general-fasteners');
  assert.equal(general.length, 1);
  assert.equal(general[0].catalogId, 'MAT-068');
  assert.equal(general[0].qty, Math.round(result.roof.totalArea * result.inputs.formulas.roofGeneralFastenerKgPerM2 * 100) / 100);
  assert.ok(result.lines.some((line) => line.id === 'roof:roof-screws' && line.catalogId === 'MAT-082'));
});

test('all three SIP frame families use matching profiles and linear-meter prices', () => {
  const project = createDefaultProject();
  const expected = [
    ['MAT-015', 'Термобрус 95×95 мм', 1174], ['MAT-013', 'Термобрус 95×145 мм', 1682], ['MAT-014', 'Термобрус 95×195 мм', 2242],
    ['MAT-186', 'Пакет клеёных досок 95×95 мм для СИП 124 мм', 587], ['MAT-187', 'Пакет клеёных досок 95×145 мм для СИП 174 мм', 841], ['MAT-188', 'Пакет клеёных досок 95×195 мм для СИП 224 мм', 1121],
    ['MAT-190', 'Брус соединительный ест. влажности 100×100 мм', 264], ['MAT-191', 'Брус соединительный ест. влажности 100×150 мм', 396], ['MAT-192', 'Брус соединительный ест. влажности 100×200 мм', 528]
  ];
  expected.forEach(([id, name, price]) => {
    const item = project.priceMat.find((row) => row.id === id);
    assert.equal(item.name, name);
    assert.equal(item.unit, 'м.п.');
    assert.equal(item.price, price);
  });
});

test('SIP floor and ceiling cover an empty house without drawn rooms', () => {
  const project = createDefaultProject();
  project.plan.house = { w: 10, h: 8 };
  project.plan.rooms = [];
  const result = calculateProject(project);
  assert.equal(result.sip.cutting.find((row) => row.key === 'floor').area, 80);
  assert.equal(result.sip.cutting.find((row) => row.key === 'ceiling').area, 80);
});

test('garage gates from the plan reach the openings estimate as their own item', () => {
  const project = createDefaultProject();
  project.plan.openings.push({ id: 'garage-1', type: 'door', doorType: 'garage', width: 2.5, height: 2.2, x: 4, y: 0, orientation: 'h', outer: true });
  const result = calculateProject(project);
  const gate = result.lines.find((line) => line.id === 'openings:opening-1');
  const work = result.lines.find((line) => line.id === 'openings:work-1');
  assert.equal(gate.catalogId, 'MAT-189');
  assert.equal(work.catalogId, 'LAB-110');
  assert.match(gate.name, /Гаражные ворота/);
  assert.equal(result.lines.some((line) => line.id === 'openings:fastener-1'), false);
});

test('second light moves room area from SIP ceiling to insulated rafters', () => {
  const project = createDefaultProject();
  const room = project.plan.rooms[0];
  room.ceilingMode = 'open-rafter';
  const roomArea = (room.w || 0) * (room.h || 0);
  const result = calculateProject(project);
  assert.ok(result.metrics.openCeilingArea > 0);
  assert.equal(result.metrics.ceilingArea, result.metrics.floorArea - result.metrics.openCeilingArea);
  assert.ok(result.roof.insulatedRafterArea > result.metrics.openCeilingArea);
  assert.ok(result.lines.some((line) => line.id === 'roof:open-rafter-insulation' && line.catalogId));
  assert.ok(result.lines.some((line) => line.id === 'roof:open-rafter-vapor-work' && line.catalogId));
  const insulationWork = result.lines.find((line) => line.id === 'roof:open-rafter-insulation-work');
  assert.equal(insulationWork.qty, result.roof.insulatedRafterArea);
  assert.equal(insulationWork.price, project.priceLab.find((item) => item.id === insulationWork.catalogId).price * 4);
  assert.deepEqual(result.lines.filter((line) => line.source === 'open-rafter' && (!line.catalogId || line.price <= 0)), []);
  assert.ok(result.metrics.openCeilingArea >= roomArea - 0.1);
});

test('shared terrace foundation removes coincident piles and can be disabled', () => {
  const project = createDefaultProject();
  const shared = calculateFoundation(project.plan, project.settings.piles);
  assert.ok(shared.sharedPiles > 0);
  project.plan.platforms.forEach((platform) => { platform.foundation.mode = 'none'; platform.binding.mode = 'none'; });
  const houseOnly = calculateFoundation(project.plan, project.settings.piles);
  assert.ok(houseOnly.totalPiles < shared.totalPiles);
  assert.equal(houseOnly.platformPiles, 0);
  assert.equal(houseOnly.platformBindingLength, 0);
});

test('drawn binding lines drive board volume rounded to six-meter stock', () => {
  const project = createDefaultProject();
  project.plan.platforms.forEach((platform) => { platform.binding.mode = 'none'; });
  project.plan.bindingLines = [
    { id: 'b1', x1: 0, y1: 0, x2: 6.1, y2: 0, include: true },
    { id: 'b2', x1: 0, y1: 2, x2: 4, y2: 2, include: true },
    { id: 'ignored', x1: 0, y1: 3, x2: 20, y2: 3, include: false }
  ];
  const result = calculateFoundation(project.plan, project.settings.piles);

  assert.equal(result.bindingLength, 10.1);
  assert.equal(result.bindingLayers, 3);
  assert.equal(result.requiredBoardLength, 30.3);
  assert.equal(result.boardCount, 6);
  assert.equal(result.purchaseBoardLength, 36);
  assert.equal(result.boardWasteLength, 5.7);
  assert.equal(result.boardVolume, 0.27);
});

test('old projects receive editable binding lines from their pile rows', () => {
  const project = createDefaultProject();
  delete project.plan.bindingLines;
  const restored = migrateProject(project);
  assert.deepEqual(restored.plan.bindingLines, bindingLinesFromPileRows(restored.plan.pileRows));
});

test('migration preserves plan, services and price list independently', () => {
  const project = createDefaultProject();
  project.plan.house.w = 12.4;
  project.services.roof = false;
  project.priceMat[0].price = 12345;
  const restored = migrateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(restored.plan.house.w, 12.4);
  assert.equal(restored.services.roof, false);
  assert.equal(restored.priceMat[0].price, 12345);
});

test('known empty starter rates are repaired from the current catalog', () => {
  const project = createDefaultProject();
  const roofWork = project.priceLab.find((item) => item.id === 'LAB-038');
  const expected = roofWork.price;
  roofWork.price = 0;
  const restored = migrateProject(project);
  assert.equal(restored.priceLab.find((item) => item.id === 'LAB-038').price, expected);
});

test('new catalog rows are added to an older saved project', () => {
  const project = createDefaultProject();
  project.priceLab = project.priceLab.filter((item) => !['LAB-108', 'LAB-110'].includes(item.id));
  project.priceMat = project.priceMat.filter((item) => !['MAT-187', 'MAT-189'].includes(item.id));
  const restored = migrateProject(project);
  assert.equal(restored.priceLab.find((item) => item.id === 'LAB-108').price, 1500);
  assert.equal(restored.priceLab.find((item) => item.id === 'LAB-110').price, 0);
  assert.equal(restored.priceMat.find((item) => item.id === 'MAT-187').price, 841);
  assert.equal(restored.priceMat.find((item) => item.id === 'MAT-189').price, 0);
  assert.equal(restored.priceMat.find((item) => item.id === 'MAT-190').price, 264);
  assert.equal(restored.priceMat.find((item) => item.id === 'MAT-191').price, 396);
  assert.equal(restored.priceMat.find((item) => item.id === 'MAT-192').price, 528);
});

test('version 60 adhesive is upgraded to the new 650 ml name and price', () => {
  const project = createDefaultProject();
  project.appVersion = 60;
  const adhesive = project.priceMat.find((item) => item.id === 'MAT-009');
  adhesive.name = 'Пена монтажная 800мл';
  adhesive.price = 450;
  const restored = migrateProject(project);
  const upgraded = restored.priceMat.find((item) => item.id === 'MAT-009');
  assert.equal(upgraded.name, 'Пеноклей для СИП-панелей 650 мл');
  assert.equal(upgraded.price, 550);
});

test('version 50 catalog is upgraded to the new frame names and prices once', () => {
  const project = createDefaultProject();
  project.appVersion = 50;
  const thermal = project.priceMat.find((item) => item.id === 'MAT-013');
  thermal.name = 'Термобрус 145х90мм';
  thermal.price = 1;
  const restored = migrateProject(project);
  const upgraded = restored.priceMat.find((item) => item.id === 'MAT-013');
  assert.equal(upgraded.name, 'Термобрус 95×145 мм');
  assert.equal(upgraded.price, 1682);
});

test('version 64 projects receive the uploaded default price list once', () => {
  const project = createDefaultProject();
  project.appVersion = 64;
  project.priceMat.find((item) => item.id === 'MAT-001').price = 2300;
  project.priceLab.find((item) => item.id === 'LAB-041').price = 3500;
  const upgraded = migrateProject(project);
  assert.equal(upgraded.priceMat.find((item) => item.id === 'MAT-001').price, 4000);
  assert.equal(upgraded.priceLab.find((item) => item.id === 'LAB-041').price, 6500);
  upgraded.priceMat.find((item) => item.id === 'MAT-001').price = 4100;
  assert.equal(migrateProject(upgraded).priceMat.find((item) => item.id === 'MAT-001').price, 4100);
});

test('plan geometry drives roof, engineering, finishing and delivery inputs', () => {
  const project = createDefaultProject();
  const before = calculateProject(project);
  project.plan.house.w += 2;
  project.plan.rooms[0].points[1].x += 1;
  project.plan.rooms[0].points[2].x += 1;
  const after = calculateProject(project);
  assert.equal(after.inputs.roof.ridgeLength, before.inputs.roof.ridgeLength + 2);
  assert.ok(after.inputs.engineering.cableRoute > before.inputs.engineering.cableRoute);
  assert.ok(after.inputs.internal.ceilingArea > before.inputs.internal.ceilingArea);
  assert.ok(after.inputs.delivery.cargoVolume > before.inputs.delivery.cargoVolume);
});

test('automatic links can be disabled and formulas are editable project data', () => {
  const project = createDefaultProject();
  project.settings.links.roofRidgeFromPlan = false;
  project.settings.roof.ridgeLength = 7.25;
  project.settings.formulas.pileLagScrews = 6;
  const calculation = calculateProject(project);
  assert.equal(calculation.inputs.roof.ridgeLength, 7.25);
  const lagScrews = calculation.lines.find((line) => line.id === 'foundation:binding-lag-screws');
  assert.equal(lagScrews.qty, calculation.foundation.totalPiles * 6);
  assert.equal(lagScrews.catalogId, 'MAT-069');
  assert.equal(calculation.lines.some((line) => /Уголок металлический/.test(line.name)), false);
});

test('project estimate overrides do not change the price list and can be reset', () => {
  const project = createDefaultProject();
  const base = calculateProject(project);
  const pileLine = base.lines.find((line) => line.id === 'foundation:piles');
  const catalogPrice = project.priceMat.find((item) => item.id === pileLine.catalogId).price;
  project.estimateOverrides = [{ lineId: pileLine.id, section: 'foundation', price: catalogPrice + 123 }];
  const overridden = calculateProject(project).lines.find((line) => line.id === pileLine.id);
  assert.equal(overridden.price, catalogPrice + 123);
  assert.equal(overridden.projectOverride, true);
  assert.equal(project.priceMat.find((item) => item.id === pileLine.catalogId).price, catalogPrice);
  project.estimateOverrides = [];
  assert.equal(calculateProject(project).lines.find((line) => line.id === pileLine.id).price, catalogPrice);
});

test('price-list changes reach non-overridden estimate lines while custom project rows join the estimate', () => {
  const project = createDefaultProject();
  const base = calculateProject(project).lines.find((line) => line.id === 'foundation:piles');
  project.priceMat.find((item) => item.id === base.catalogId).price += 500;
  project.customEstimateLines = [{ id: 'custom-foundation-test', section: 'foundation', name: 'Проектная позиция', kind: 'material', unit: 'шт', qty: 3, price: 120, source: 'project-custom', custom: true }];
  const calculation = calculateProject(project);
  assert.equal(calculation.lines.find((line) => line.id === base.id).price, base.price + 500);
  assert.ok(calculation.sections.find((section) => section.key === 'foundation').lines.some((line) => line.id === 'custom-foundation-test'));
  assert.ok(calculation.totals.materials >= 360);
});

test('every default estimate line resolves to a priced catalog item', () => {
  const calculation = calculateProject(createDefaultProject());
  assert.deepEqual(calculation.lines.filter((line) => !line.catalogId || line.price <= 0), []);
});

test('automatic pile rows cover the house perimeter and internal walls at the configured spacing', () => {
  const project = createDefaultProject();
  project.settings.piles.spacing = 2;
  const rows = generateAutoPileRows(project.plan, project.settings.piles.spacing);
  assert.ok(rows.length > 4);
  assert.ok(rows.every((row) => row.auto && row.count >= 2));
  assert.ok(rows.every((row) => Math.hypot(row.x2 - row.x1, row.y2 - row.y1) / (row.count - 1) <= 2.001));
  assert.deepEqual(rows.slice(0, 4).map((row) => row.id), ['auto-top', 'auto-right', 'auto-bottom', 'auto-left']);
});

test('pile rows share one pile at corners and crossing nodes', () => {
  const project = createDefaultProject();
  project.plan.platforms = [];
  project.plan.piles = [];
  project.plan.pileRows = [
    { id: 'horizontal', x1: 0, y1: 4, x2: 10, y2: 4, count: 3, group: 'house' },
    { id: 'vertical', x1: 5, y1: 0, x2: 5, y2: 8, count: 3, group: 'house' },
    { id: 'corner', x1: 10, y1: 4, x2: 10, y2: 8, count: 2, group: 'house' }
  ];
  const foundation = calculateFoundation(project.plan, project.settings.piles);
  assert.equal(foundation.totalPiles, 6, 'the crossing and shared corner are each counted once');
  assert.equal(foundation.points.filter((point) => point.x === 5 && point.y === 4).length, 1);
  assert.equal(foundation.points.filter((point) => point.x === 10 && point.y === 4).length, 1);
});


test('automatic pile grid respects requested width/length counts and matching binding grid', () => {
  const project = createDefaultProject();
  project.plan.house = { w: 10, h: 8 };
  project.plan.platforms = []; project.plan.piles = [];
  project.plan.pileRows = generatePileGrid(project.plan, 4, 3);
  project.plan.bindingLines = generateAutoBindingLines(project.plan, 4, 3);
  const foundation = calculateFoundation(project.plan, project.settings.piles);
  assert.equal(project.plan.pileRows.length, 3);
  assert.ok(project.plan.pileRows.every((row) => row.count === 4));
  assert.equal(foundation.housePiles, 12);
  assert.equal(project.plan.bindingLines.length, 7);
});
