import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTerraceRoof, normalizeTerracePlatform, terraceAttachmentSide } from '../src/calculations/terrace-model.js';

test('legacy terrace receives project defaults without losing geometry', () => {
  const platform = normalizeTerracePlatform({ id: 't1', x: 0, y: 8, w: 10, h: 2 });
  assert.equal(platform.w, 10);
  assert.equal(platform.foundation.mode, 'shared');
  assert.equal(platform.binding.mode, 'shared');
  assert.equal(platform.roof.mode, 'none');
});

test('foundation without piles also disables binding', () => {
  const platform = normalizeTerracePlatform({ foundation: { mode: 'none' }, binding: { mode: 'shared' } });
  assert.equal(platform.binding.mode, 'none');
});

test('automatic shed roof uses projection, height difference and overhangs', () => {
  const platform = normalizeTerracePlatform({
    x: 0, y: 8, w: 10, h: 2,
    roof: { mode: 'cold', shape: 'shed', frontOverhang: 0.3, sideOverhang: 0.3, highHeight: 2.6, lowHeight: 2.2, wastePercent: 10 }
  });
  assert.equal(terraceAttachmentSide(platform, { w: 10, h: 8 }), 'bottom');
  const result = calculateTerraceRoof(platform, { w: 10, h: 8 });
  assert.equal(result.netArea, 24.75);
  assert.equal(result.purchaseArea, 27.22);
  assert.equal(result.eaveLength, 10.6);
  assert.equal(result.vergeLength, 4.669);
});

test('manual roof area is preserved and receives waste', () => {
  const result = calculateTerraceRoof({
    x: 10, y: 0, w: 2, h: 8,
    roof: { mode: 'cold', areaMode: 'manual', manualArea: 20, wastePercent: 15 }
  }, { w: 10, h: 8 });
  assert.equal(result.side, 'right');
  assert.equal(result.netArea, 20);
  assert.equal(result.purchaseArea, 23);
});

test('roofed terrace gets posts sized from the wall panel', () => {
  const platform = {
    x: 0, y: 8, w: 10, h: 2,
    roof: { mode: 'cold', shape: 'shed', lowHeight: 2.2 }
  };
  const garage = calculateTerraceRoof(platform, { w: 10, h: 8 }, { wallPanelThickness: 124, postSpacing: 3 });
  const house = calculateTerraceRoof(platform, { w: 10, h: 8 }, { wallPanelThickness: 174, postSpacing: 3 });
  assert.equal(garage.postSection, '100x100');
  assert.equal(house.postSection, '150x100');
  assert.equal(house.postCount, 5);
  assert.equal(house.postLength, 11);
  assert.equal(house.postVolume, 0.165);
});

test('gable terrace returns exposed gable area and ridge length', () => {
  const result = calculateTerraceRoof({
    x: 0, y: 8, w: 6, h: 2,
    roof: { mode: 'cold', shape: 'gable', ridgeHeight: 1, gableType: 'auto', gableCount: 1 }
  }, { w: 10, h: 8 });
  assert.equal(result.gableType, 'cold');
  assert.equal(result.gableArea, 3.3);
  assert.equal(result.ridgeLength, 2.3);
  assert.equal(result.eaveLength, 4.6);
  assert.equal(result.vergeLength, 13.793);
});
