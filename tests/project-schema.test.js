import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPriceCatalogPayload,
  createProjectPayload,
  safeFilePart,
  validatePriceCatalog,
  validateProject
} from '../src/storage/project-schema.js';

test('project payload keeps plan and both price lists', () => {
  const payload = createProjectPayload({
    plan: {
      house: { w: 10, h: 8 },
      rooms: [{ id: 1 }],
      platforms: [{ id: 't1', foundation: { mode: 'shared' }, binding: { mode: 'shared' }, roof: { mode: 'cold', shape: 'shed' } }]
    },
    estimate: [],
    priceMat: [{ id: 'MAT-1', price: 100 }],
    priceLab: [{ id: 'LAB-1', price: 50 }]
  }, { sketchLibrary: [{ id: 'sketch-1' }] });
  assert.equal(payload.format, 'eft-project');
  assert.equal(payload.plan.rooms.length, 1);
  assert.equal(payload.plan.platforms[0].foundation.mode, 'shared');
  assert.equal(payload.plan.platforms[0].roof.mode, 'cold');
  assert.equal(payload.priceMat.length, 1);
  assert.equal(payload.priceLab.length, 1);
  assert.equal(payload.sketchLibrary.length, 1);
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.appVersion, 45);
});

test('legacy project without format remains supported', () => {
  assert.doesNotThrow(() => validateProject({ estimate: [], params: [] }));
});

test('price catalog requires materials and labor', () => {
  const catalog = createPriceCatalogPayload({ priceMat: [], priceLab: [], priceMode: 'custom' });
  assert.equal(catalog.format, 'eft-price-catalog');
  assert.equal(catalog.priceMode, 'custom');
  assert.throws(() => validatePriceCatalog({ priceMat: [] }), /материалы и работы/);
});

test('file names are safe on Windows', () => {
  assert.equal(safeFilePart('Иванов / дом: 21'), 'Иванов___дом__21');
});
