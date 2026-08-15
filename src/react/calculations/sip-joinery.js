const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

export const SIP_JOINERY_TYPES = [
  { value: 'thermal', label: 'Термобрус · дорогой' },
  { value: 'board-pack', label: 'Клеёный пакет · средний' },
  { value: 'solid', label: 'Брус ест. влажности · эконом' }
];

export function sipTimberProfile(panelThickness) {
  const thickness = Number(panelThickness) || 174;
  const core = thickness <= 124 ? 100 : thickness <= 174 ? 150 : 200;
  return { panelThickness: thickness, core, endBoardDepth: core - 5, thermalDepth: core - 5 };
}

function gridJointLength(width, height, panelWidth, panelLength) {
  const seams = (across, along, unitAcross, unitAlong) => (
    Math.max(0, Math.ceil(across / unitAcross) - 1) * along +
    Math.max(0, Math.ceil(along / unitAlong) - 1) * across
  );
  return Math.min(
    seams(width, height, panelWidth, panelLength),
    seams(width, height, panelLength, panelWidth)
  );
}

export function calculateSipJoinery(plan, services, sipSettings, formulas = {}) {
  const width = Math.max(0, Number(plan.house?.w) || 0);
  const height = Math.max(0, Number(plan.house?.h) || 0);
  const wallHeight = Math.max(0, Number(plan.wallHeight) || 2.5);
  const panelWidth = Math.max(0.2, Number(formulas.panelWidth) || 1.25);
  const panelLength = Math.max(0.5, Number(formulas.panelLength) || 2.5);
  const floorLayoutWidth = Math.min(panelWidth, Math.max(0.2, Number(sipSettings.floorPanelWidth) || panelWidth));
  const ceilingLayoutWidth = Math.min(panelWidth, Math.max(0.2, Number(sipSettings.ceilingPanelWidth) || panelWidth));
  const reserve = 1 + Math.max(0, Number(formulas.sipTimberReservePercent) || 5) / 100;
  const perimeter = 2 * (width + height);
  const wallSeams = (wallLength) => (
    Math.max(0, Math.ceil(wallLength / panelWidth) - 1) * wallHeight +
    Math.max(0, Math.ceil(wallHeight / panelLength) - 1) * wallLength
  );
  const wallJointLength = 2 * wallSeams(width) + 2 * wallSeams(height);
  const openingEdgeLength = (plan.openings || []).reduce((sum, opening) => (
    opening.outer === false ? sum : sum + 2 * (Math.max(0, Number(opening.width) || 0) + Math.max(0, Number(opening.height) || 0))
  ), 0);
  const rows = [
    services.sipFloor ? { key: 'floor', label: 'Пол', thickness: sipSettings.floorThickness, layoutWidth: floorLayoutWidth, jointLength: gridJointLength(width, height, floorLayoutWidth, panelLength), endBoardLength: perimeter } : null,
    services.sipWalls ? { key: 'walls', label: 'Наружные стены', thickness: sipSettings.wallThickness, jointLength: wallJointLength, endBoardLength: 2 * perimeter + 4 * wallHeight + openingEdgeLength } : null,
    services.sipCeiling ? { key: 'ceiling', label: 'Потолок', thickness: sipSettings.ceilingThickness, layoutWidth: ceilingLayoutWidth, jointLength: gridJointLength(width, height, ceilingLayoutWidth, panelLength), endBoardLength: perimeter } : null
  ].filter(Boolean).map((row) => ({
    ...row,
    ...sipTimberProfile(row.thickness),
    jointLength: round(row.jointLength * reserve),
    endBoardLength: round(row.endBoardLength * reserve)
  }));
  return {
    type: sipSettings.connectorType || 'thermal',
    rows,
    totalJointLength: round(rows.reduce((sum, row) => sum + row.jointLength, 0)),
    totalEndBoardLength: round(rows.reduce((sum, row) => sum + row.endBoardLength, 0))
  };
}
