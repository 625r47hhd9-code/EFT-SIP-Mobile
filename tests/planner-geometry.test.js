import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allOpeningSegments, boundsOf, collectSnapAxes, dimensionOutsideHouse, movePoints, nearestSegment,
  pileRowAlignment, planIssues, projectOpeningToWall, rectanglePoints, shouldClosePolygon, snapPoint, snapPointDetails, unifiedWallSegments
} from '../src/react/planner/geometry.js';

const room = (id, name, x1, y1, x2, y2) => ({
  id, name, points: rectanglePoints({ x: x1, y: y1 }, { x: x2, y: y2 })
});

test('adjacent room walls are merged into one shared wall', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.174,
    rooms: [room('a', 'A', 0.174, 0.174, 5, 7.826), room('b', 'B', 5, 0.174, 9.826, 7.826)], walls: []
  };
  const walls = unifiedWallSegments(plan);
  const shared = walls.filter((wall) => wall.axis === 'v' && Math.abs(wall.fixed - 5) < 0.01);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].start, 0.174);
  assert.equal(shared[0].end, 7.826);
  assert.equal(walls.length, 1, 'outer room edges are provided by the exterior wall');
});

test('room faces drawn on the outside wall do not become duplicate partitions', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.174,
    rooms: [room('a', 'A', 0, 0, 5, 8), room('b', 'B', 5, 0, 10, 8)], walls: []
  };
  const walls = unifiedWallSegments(plan);
  assert.equal(walls.length, 1);
  assert.equal(walls[0].axis, 'v');
  assert.equal(walls[0].fixed, 5);
  assert.equal(walls[0].end - walls[0].start, 8);
});

test('room movement can stage a room outside the house and still snaps to the grid', () => {
  const plan = { house: { w: 10, h: 8 }, wallThickness: 0.174 };
  const moved = movePoints(rectanglePoints({ x: 1, y: 1 }, { x: 4, y: 3 }), -4, 10, plan, { xs: [0.174], ys: [5.826] });
  assert.deepEqual(boundsOf(moved), { x: -3, y: 11, x2: 0, y2: 13, w: 3, h: 2 });
});

test('pointer snaps to a nearby real node without an exact hit', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.174,
    rooms: [room('a', 'A', 1.237, 1.456, 4, 4)], walls: [], pileRows: [], dimensions: [], platforms: [], piles: []
  };
  const axes = collectSnapAxes(plan);
  assert.deepEqual(snapPoint({ x: 1.48, y: 1.69 }, axes, { tolerance: 0.15, pointTolerance: 0.35 }), { x: 1.237, y: 1.456 });
  const resolved = snapPointDetails({ x: 1.48, y: 1.69 }, axes, { tolerance: 0.15, pointTolerance: 0.35 });
  assert.equal(resolved.snap.kind, 'node');
  assert.deepEqual(resolved.point, { x: 1.237, y: 1.456 });
});

test('pile row alignment distinguishes an exact axis from a small accidental offset', () => {
  assert.equal(pileRowAlignment({ x1: 0, y1: 2, x2: 8, y2: 2 }).state, 'aligned');
  assert.equal(pileRowAlignment({ x1: 0, y1: 2, x2: 8, y2: 2.1 }).state, 'warning');
  assert.equal(pileRowAlignment({ x1: 0, y1: 0, x2: 3, y2: 2 }).state, 'diagonal');
});

test('opening placement selects the closest shared or outside wall', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.174,
    rooms: [room('a', 'A', 0.174, 0.174, 5, 7.826), room('b', 'B', 5, 0.174, 9.826, 7.826)], walls: []
  };
  const inside = nearestSegment({ x: 5.08, y: 4 }, allOpeningSegments(plan));
  const outside = nearestSegment({ x: 9.95, y: 4 }, allOpeningSegments(plan));
  assert.equal(inside.outer, false);
  assert.equal(inside.fixed, 5);
  assert.equal(outside.outer, true);
  assert.equal(outside.fixed, 10);
});

test('windows and doors move to walls while garage gates stay on the outside contour', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.174,
    rooms: [room('a', 'A', 0.174, 0.174, 5, 7.826), room('b', 'B', 5, 0.174, 9.826, 7.826)], walls: []
  };
  const movedDoor = projectOpeningToWall({ type: 'door', doorType: 'entrance', width: 0.9 }, { x: 5.08, y: 4 }, plan);
  assert.equal(movedDoor.x, 5);
  assert.equal(movedDoor.outer, false);
  assert.equal(movedDoor.doorType, 'interior');
  const movedWindow = projectOpeningToWall({ type: 'window', width: 1.2 }, { x: 9.9, y: 3 }, plan);
  assert.equal(movedWindow.x, 10);
  assert.equal(movedWindow.outer, true);
  const garage = projectOpeningToWall({ type: 'door', doorType: 'garage', width: 2.5 }, { x: 5, y: 4 }, plan, { lockDoorType: true });
  assert.equal(garage.outer, true);
  assert.equal(garage.orientation, 'h');
  assert.equal(garage.y, 0);
  assert.equal(garage.doorType, 'garage');
  const cornerGarage = projectOpeningToWall({ type: 'door', doorType: 'garage', width: 2.5 }, { x: 0.1, y: 0 }, plan, { lockDoorType: true });
  assert.equal(cornerGarage.x, 1.25, 'the full gate stays inside its wall segment');
});

test('plan diagnostics marks overlaps and rooms outside the house', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.174,
    rooms: [room('a', 'A', 1, 1, 5, 5), room('b', 'B', 4, 4, 7, 7), room('c', 'C', -1, 2, 0.5, 3)], walls: []
  };
  const issues = planIssues(plan);
  assert.ok(issues.some((issue) => issue.type === 'overlap' && issue.roomIds.includes('a') && issue.roomIds.includes('b')));
  assert.ok(issues.some((issue) => issue.type === 'outside' && issue.roomIds.includes('c')));
});

test('plan diagnostics marks a gap between formerly adjacent rooms', () => {
  const plan = {
    house: { w: 10, h: 8 }, wallThickness: 0.174,
    rooms: [room('a', 'A', 0.174, 0.174, 4.8, 7.826), room('b', 'B', 5, 0.174, 9.826, 7.826)], walls: []
  };
  const issues = planIssues(plan);
  assert.ok(issues.some((issue) => issue.type === 'gap' && issue.roomIds.includes('a')));
  assert.ok(issues.some((issue) => issue.type === 'gap' && issue.roomIds.includes('b')));
});

test('new dimension lines are moved outside the house and keep their measured span', () => {
  const horizontal = dimensionOutsideHouse({ x1: 2, y1: 3, x2: 8, y2: 3.2 }, { w: 10, h: 8 });
  assert.deepEqual(horizontal, { x1: 2, y1: -0.8, x2: 8, y2: -0.8 });
  const vertical = dimensionOutsideHouse({ x1: 7, y1: 2, x2: 7.1, y2: 7 }, { w: 10, h: 8 });
  assert.deepEqual(vertical, { x1: 10.8, y1: 2, x2: 10.8, y2: 7 });
});

test('polygon closes only after three points when the pointer returns to the first node', () => {
  const points = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }];
  assert.equal(shouldClosePolygon(points, { x: 1.2, y: 1.1 }), true);
  assert.equal(shouldClosePolygon(points, { x: 2, y: 2 }), false);
  assert.equal(shouldClosePolygon(points.slice(0, 2), { x: 1, y: 1 }), false);
});
