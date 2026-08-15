import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject } from '../src/react/state/project-model.js';
import { applyPlanTransfer, createPlanTransfer, validatePlanTransfer } from '../src/react/storage/plan-transfer.js';

test('shared plan file keeps full geometry and construction settings without prices', () => {
  const source = createDefaultProject();
  source.plan.rooms[0].name = 'План коллеги';
  source.settings.roof.eaveOverhang = 0.75;
  source.settings.piles.spacing = 2.1;
  source.priceMat[0].price = 999999;
  const payload = createPlanTransfer(source);
  assert.equal(payload.format, 'eft-house-plan');
  assert.equal(payload.plan.rooms[0].name, 'План коллеги');
  assert.equal(payload.settings.roof.eaveOverhang, 0.75);
  assert.equal(payload.priceMat, undefined);
  assert.equal(payload.meta, undefined);
});

test('opening a shared plan replaces geometry but preserves colleague prices and estimate edits', () => {
  const source = createDefaultProject();
  source.plan.house.w = 12.4;
  source.settings.roof.gableOverhang = 0.45;
  const colleague = createDefaultProject();
  colleague.priceMat[0].price = 12345;
  colleague.estimateOverrides = [{ lineId: 'foundation:piles', price: 321 }];
  const opened = applyPlanTransfer(colleague, createPlanTransfer(source));
  assert.equal(opened.plan.house.w, 12.4);
  assert.equal(opened.settings.roof.gableOverhang, 0.45);
  assert.equal(opened.priceMat[0].price, 12345);
  assert.deepEqual(opened.estimateOverrides, colleague.estimateOverrides);
});

test('plan loader accepts a complete EFT project and rejects files without a plan', () => {
  const project = createDefaultProject();
  assert.equal(validatePlanTransfer(project).plan.rooms.length, project.plan.rooms.length);
  assert.throws(() => validatePlanTransfer({ format: 'eft-price-catalog' }), /не найден корректный план/);
});
