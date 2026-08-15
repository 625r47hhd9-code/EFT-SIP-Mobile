import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePlanMetrics, calculateSipCutting, calculateSipRoofCutting, chooseDimensionSides, roofGeometry } from '../src/calculations/plan-metrics.js';

test('shared and partially overlapping room walls count once', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.2, wallHeight: 2.5,
    rooms: [
      { x: 0.2, y: 0.2, w: 4.8, h: 7.6 },
      { x: 5, y: 0.2, w: 4.8, h: 3.8 },
      { x: 5, y: 4, w: 4.8, h: 3.8 }
    ],
    walls: [], openings: []
  };
  const metrics = calculatePlanMetrics(plan);
  assert.equal(metrics.partitionLength, 12.4);
});

test('room faces and drawn lines along the outside wall are not partitions', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.174, wallHeight: 2.5,
    rooms: [
      { x: 0, y: 0, w: 5, h: 8 },
      { x: 5, y: 0, w: 5, h: 8 }
    ],
    walls: [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 5, y1: 0, x2: 5, y2: 8 }
    ],
    openings: []
  };
  const metrics = calculatePlanMetrics(plan);
  assert.equal(metrics.partitionLength, 8);
  assert.equal(metrics.partitionGrossArea, 20);
});

test('outer openings reduce exterior walls and interior doors reduce partitions', () => {
  const plan = {
    house: { w: 6, h: 4 }, wallThickness: 0.2, wallHeight: 2.5,
    rooms: [
      { x: 0.2, y: 0.2, w: 2.8, h: 3.6 },
      { x: 3, y: 0.2, w: 2.8, h: 3.6 }
    ],
    walls: [],
    openings: [
      { type: 'window', width: 1.2, height: 1.2, outer: true },
      { type: 'door', width: 0.8, height: 2, outer: false }
    ]
  };
  const metrics = calculatePlanMetrics(plan);
  assert.equal(metrics.partitionLength, 3.6);
  assert.equal(metrics.partitionNetArea, 7.4);
  assert.equal(metrics.exteriorWallNetArea, 48.56);
});

test('explicit wall gaps are subtracted from wall and partition quantities', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallHeight: 2.5, wallThickness: 0.174,
    rooms: [
      { id: 'a', points: [{ x: .174, y: .174 }, { x: 5, y: .174 }, { x: 5, y: 7.826 }, { x: .174, y: 7.826 }] },
      { id: 'b', points: [{ x: 5, y: .174 }, { x: 9.826, y: .174 }, { x: 9.826, y: 7.826 }, { x: 5, y: 7.826 }] }
    ], walls: [], openings: [], platforms: [],
    wallGaps: [
      { width: 1, x: 5, y: 4, orientation: 'v', outer: false },
      { width: 1.2, x: 10, y: 4, orientation: 'v', outer: true }
    ]
  };
  const metrics = calculatePlanMetrics(plan);
  assert.equal(metrics.partitionLength, 6.65);
  assert.equal(metrics.exteriorWallNetArea, 87);
  assert.equal(metrics.wallGapLength, 2.2);
});

test('SIP cutting covers only floor, outer walls and horizontal ceiling', () => {
  const rows = calculateSipCutting({ floor: 50, walls: 80, ceiling: 50, partitions: 30, roof: 70 });
  assert.deepEqual(rows.map((row) => row.key), ['floor', 'walls', 'ceiling']);
  assert.ok(rows.every((row) => row.panels > 0));
  assert.ok(rows.every((row) => row.cutMeters > 0));
  assert.equal(calculateSipRoofCutting(70).key, 'roof');
});

test('625 mm floor and ceiling layouts keep full-panel purchases but add longitudinal cutting', () => {
  const surfaces = { floor: 50, walls: 80, ceiling: 50 };
  const standard = calculateSipCutting(surfaces, {
    panelWidth: 1.25, panelLength: 2.5,
    layoutWidths: { floor: 1.25, ceiling: 1.25 }
  });
  const reinforced = calculateSipCutting(surfaces, {
    panelWidth: 1.25, panelLength: 2.5,
    layoutWidths: { floor: .625, ceiling: .625 }
  });

  for (const key of ['floor', 'ceiling']) {
    const base = standard.find((row) => row.key === key);
    const half = reinforced.find((row) => row.key === key);
    assert.equal(half.panels, base.panels);
    assert.equal(half.purchasedArea, base.purchasedArea);
    assert.equal(half.layoutWidth, .625);
    assert.equal(half.stripsPerPanel, 2);
    assert.equal(half.splitCutMeters, half.panels * 2.5);
    assert.equal(half.cutMeters, Math.round((base.cutMeters + half.splitCutMeters) * 10) / 10);
  }
  assert.equal(reinforced.find((row) => row.key === 'walls').splitCutMeters, 0);
});

test('empty plan keeps the full house floor and ceiling areas', () => {
  const metrics = calculatePlanMetrics({
    house: { w: 10, h: 8 }, wallThickness: 0.174, wallHeight: 2.5,
    rooms: [], walls: [], openings: [], wallGaps: [], platforms: []
  });
  assert.equal(metrics.roomArea, 0);
  assert.equal(metrics.floorArea, 80);
  assert.equal(metrics.ceilingArea, 80);
  assert.equal(metrics.openCeilingArea, 0);
});

test('second-light room removes only its area from the horizontal ceiling', () => {
  const metrics = calculatePlanMetrics({
    house: { w: 10, h: 8 }, wallThickness: 0.174, wallHeight: 2.5,
    rooms: [{ x: 1, y: 1, w: 5, h: 4, include: true, ceilingMode: 'open-rafter' }],
    walls: [], openings: [], wallGaps: [], platforms: []
  });
  assert.equal(metrics.floorArea, 80);
  assert.equal(metrics.openCeilingArea, 20);
  assert.equal(metrics.ceilingArea, 60);
});

test('second light can occupy only part of a room', () => {
  const metrics = calculatePlanMetrics({
    house: { w: 10, h: 8 }, wallThickness: 0.174, wallHeight: 2.5,
    rooms: [{ x: 1, y: 1, w: 5, h: 4, include: true, ceilingMode: 'open-rafter', openCeilingArea: 12 }],
    walls: [], openings: [], wallGaps: [], platforms: []
  });
  assert.equal(metrics.openCeilingArea, 12);
  assert.equal(metrics.ceilingArea, 68);
});

test('ridge height determines slope and gable areas', () => {
  const geometry = roofGeometry({ span: 8, ridgeLength: 10, ridgeHeight: 3 });
  assert.equal(geometry.slopeLength, 5);
  assert.equal(geometry.slopeArea, 50);
  assert.equal(geometry.totalSlopeArea, 100);
  assert.equal(geometry.gableArea, 24);
  assert.equal(geometry.slopeCoefficient, 1.25);
});

test('flat main roof uses one horizontal plane without ridge or gables', () => {
  const geometry = roofGeometry({ span: 8, ridgeLength: 10, ridgeHeight: 3, shape: 'flat' });
  assert.equal(geometry.shape, 'flat');
  assert.equal(geometry.totalSlopeArea, 80);
  assert.equal(geometry.gableArea, 0);
  assert.equal(geometry.slopeCoefficient, 1);
});

test('main roof geometry includes independent eave and gable overhangs', () => {
  const geometry = roofGeometry({ span: 8, ridgeLength: 10, ridgeHeight: 3, eaveOverhang: 0.5, gableOverhang: 0.3 });
  assert.equal(geometry.roofSpan, 9);
  assert.equal(geometry.roofLength, 10.6);
  assert.equal(geometry.slopeLength, 5.408);
  assert.equal(geometry.totalSlopeArea, 114.66);
  assert.equal(geometry.gableArea, 24);
  assert.equal(geometry.slopeCoefficient, 1.25);
});

test('house dimensions move to the free perimeter side', () => {
  const leftTerrace = chooseDimensionSides({
    house: { w: 10, h: 8 },
    platforms: [{ x: -3, y: 0, w: 3, h: 8, steps: 3, tread: 0.3, stairSide: 'left' }]
  });
  assert.equal(leftTerrace.vertical, 'right');
  assert.equal(leftTerrace.horizontal, 'top');

  const topTerrace = chooseDimensionSides({
    house: { w: 10, h: 8 },
    platforms: [{ x: 0, y: -2, w: 10, h: 2, steps: 2, tread: 0.3, stairSide: 'top' }]
  });
  assert.equal(topTerrace.horizontal, 'bottom');
});
