import { calculatePlanMetrics, calculateSipCutting, chooseDimensionSides, roofGeometry } from '../calculations/plan-metrics.js';
import { calculateTerraceRoof, normalizeTerracePlatform } from '../calculations/terrace-model.js';

const byId = (id) => document.getElementById(id);
const value = (id, fallback = 0) => {
  const parsed = Number.parseFloat(byId(id)?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const setValue = (id, next) => { if (byId(id)) byId(id).value = next; };
const setText = (id, next) => { if (byId(id)) byId(id).textContent = next; };
const format = (next, digits = 1) => Number(next || 0).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function installStyles() {
  if (byId('eft-v44-styles')) return;
  const style = document.createElement('style');
  style.id = 'eft-v44-styles';
  style.textContent = `
    .planner-canvas-wrap[data-tool="terrace"] .fp-dimension,
    .planner-canvas-wrap[data-tool="terrace"] .fp-dimension-text,
    .planner-canvas-wrap[data-tool="porch"] .fp-dimension,
    .planner-canvas-wrap[data-tool="porch"] .fp-dimension-text{display:none}
    .preview-wrap .v37-source{display:none!important}
    .v44-cutting{margin-top:14px;overflow-x:auto;border:1px solid #cfe4ba;border-radius:12px;background:#fff}
    .v44-cutting table{min-width:700px;color:#24351f}
    .v44-cutting th{position:static;background:#edf6e7;color:#476536}
    .v44-cutting td{padding:9px 12px;border-color:#e0ead9}
    .v44-cutting td:not(:first-child){text-align:right;font-family:'JetBrains Mono',monospace}
    .v44-cutting-total td{font-weight:800;background:#f2f8ed}
    .v44-roof-cut-field{margin-top:12px;max-width:320px}
    .v44-roof-help{display:block;margin-top:5px;color:var(--text-muted);font-size:10px;line-height:1.4;text-transform:none;letter-spacing:0}
    .v44-print-specs{display:none}
    .v45-platform-section{grid-column:1/-1;border:1px solid var(--border);border-radius:9px;padding:10px;background:rgba(77,208,225,.035)}
    .v45-platform-section h4{margin:0 0 9px;color:var(--text);font-size:12px}
    .v45-platform-section .planner-field-row{margin-bottom:8px}
    .v45-platform-section label{min-width:0}
    .v45-platform-section input:disabled,.v45-platform-section select:disabled{opacity:.45;cursor:not-allowed}
    .v45-roof-result{display:flex;justify-content:space-between;gap:10px;padding:9px 10px;border-radius:7px;background:var(--info-bg);color:var(--text-muted);font-size:11px}
    .v45-roof-result strong{color:var(--info);font-size:12px}
    .v45-field-hidden{display:none!important}
    :root[data-theme="light"] .planner-shell,
    :root[data-theme="light"] .planner-topbar,
    :root[data-theme="light"] .planner-tools,
    :root[data-theme="light"] .planner-inspector,
    :root[data-theme="light"] .planner-status{background:#fff;color:#172018;border-color:#cbdac5}
    :root[data-theme="light"] .planner-canvas-wrap{background-color:#fff;background-image:linear-gradient(rgba(62,91,54,.13) 1px,transparent 1px),linear-gradient(90deg,rgba(62,91,54,.13) 1px,transparent 1px),linear-gradient(rgba(62,91,54,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(62,91,54,.055) 1px,transparent 1px)}
    :root[data-theme="light"] .fp-room{fill:rgba(90,130,66,.035)}
    :root[data-theme="light"] .fp-room-edge,:root[data-theme="light"] .fp-wall,:root[data-theme="light"] .fp-outer{stroke:#172018}
    :root[data-theme="light"] .fp-room-label,:root[data-theme="light"] .fp-dimension-text,:root[data-theme="light"] .fp-platform-label,:root[data-theme="light"] .fp-empty-title{fill:#172018}
    :root[data-theme="light"] .fp-room-area,:root[data-theme="light"] .fp-room-inner-dim-text,:root[data-theme="light"] .fp-empty-copy{fill:#526057}
    :root[data-theme="light"] .fp-opening-cut,:root[data-theme="light"] .fp-wall-gap{stroke:#fff}
    :root[data-theme="light"] .fp-pile,:root[data-theme="light"] .fp-room-node,:root[data-theme="light"] .fp-handle,:root[data-theme="light"] .fp-vertex-handle{fill:#fff}
    :root[data-theme="light"] .planner-mini-field,:root[data-theme="light"] .planner-btn,:root[data-theme="light"] .planner-view-toggle,:root[data-theme="light"] .planner-floor-select{background:#f6faf3;color:#33402f;border-color:#cbdac5}
    :root[data-theme="light"] .planner-mini-field input,:root[data-theme="light"] .planner-form input,:root[data-theme="light"] .planner-form select{color:#172018;background:#fff;border-color:#cbdac5}
    :root[data-theme="light"] .planner-inspector h3,:root[data-theme="light"] .planner-selection-name,:root[data-theme="light"] .planner-status-item strong{color:#172018}
    @media print{
      .v44-print-specs{display:grid!important;grid-template-columns:1fr 1fr;gap:5px 22px;margin-top:14px;padding:12px;border:1px solid #aaa;color:#000}
      .v44-print-specs h2{grid-column:1/-1;margin:0 0 5px;padding:0 0 5px;border-left:0;border-bottom:1px solid #bbb;color:#000;font-size:14px}
      .v44-print-specs p{margin:1px 0!important;color:#000!important;font-size:11px!important}
      .v44-print-specs .wide{grid-column:1/-1}
      .preview-wrap .v37-source,#table-est .v37-source{display:none!important}
    }
  `;
  document.head.appendChild(style);
}

function installCuttingUi() {
  const panel = document.querySelector('#tab-calc-sip .cut-panel-box');
  if (!panel || byId('v44-cutting-table')) return;
  panel.querySelector('h3').innerHTML = '<i class="fas fa-scissors"></i> Раскрой СИП: пол, стены, потолок, перегородки и крыша';
  const note = panel.querySelector('.calc-note');
  if (note) note.textContent = 'Ведомость показывает чистую площадь, покупные панели, остаток и ориентировочную длину реза. Проёмы из плана вычитаются из стен и перегородок.';
  panel.insertAdjacentHTML('beforeend', `
    <div class="form-group v44-roof-cut-field">
      <label>Площадь крыши СИП, м²
        <span class="v44-roof-help">Рассчитывается по высоте конька; можно уточнить вручную.</span>
      </label>
      <input id="sipRoofCutArea" type="number" min="0" step="0.1" value="0" oninput="window.eftV44RenderCutting()">
    </div>
    <div class="v44-cutting" id="v44-cutting-table"></div>
  `);
}

function normalizeAllPlatforms(plan = window.fpState) {
  if (!plan || !Array.isArray(plan.platforms)) return plan;
  plan.platforms = plan.platforms.map((platform) => normalizeTerracePlatform(platform));
  return plan;
}

function selectedPlatform() {
  const selection = window.fpState?.selected;
  if (selection?.type !== 'platform') return null;
  return window.fpState.platforms?.find((platform) => platform.id === selection.id) || null;
}

function terraceMainSlopeCoefficient() {
  const span = Math.max(0, Number(window.paramsData?.[1]?.val) || Number(window.fpState?.house?.h) || 0);
  const ridgeHeight = Math.max(0, value('autoRoofCoeff', window.paramsData?.[6]?.val || 0));
  return span > 0 ? Math.hypot(span / 2, ridgeHeight) / (span / 2) : 1;
}

function terraceRoofResult(platform) {
  return calculateTerraceRoof(platform, window.fpState?.house, { mainSlopeCoefficient: terraceMainSlopeCoefficient() });
}

function installTerraceProjectUi() {
  const host = byId('fpPlatformFields');
  if (!host || byId('v45-platform-project')) return;
  const includeRow = byId('fpPlatformInclude')?.closest('.planner-toggle-row');
  const html = `
    <section class="v45-platform-section" id="v45-platform-project">
      <h4><i class="fas fa-layer-group"></i> Связь с фундаментом</h4>
      <div class="planner-field-row">
        <label>Свайное поле<select id="fpPlatformFoundationMode" onchange="window.eftV45UpdatePlatformOptions()"><option value="shared">Общее с домом</option><option value="separate">Отдельное</option><option value="none">Без свай</option></select></label>
        <label>Обвязка<select id="fpPlatformBindingMode" onchange="window.eftV45UpdatePlatformOptions()"><option value="shared">Общая с домом</option><option value="separate">Отдельная</option><option value="none">Не учитывать</option></select></label>
      </div>
    </section>
    <section class="v45-platform-section" id="v45-platform-roof">
      <h4><i class="fas fa-house-chimney"></i> Кровля площадки</h4>
      <div class="planner-field-row">
        <label>Тип кровли<select id="fpPlatformRoofMode" onchange="window.eftV45UpdatePlatformOptions()"><option value="none">Без кровли</option><option value="cold">Холодная</option><option value="warm">Тёплая СИП</option></select></label>
        <label>Форма<select id="fpPlatformRoofShape" onchange="window.eftV45UpdatePlatformOptions()"><option value="shed">Односкатная</option><option value="continuation">Продолжение крыши</option><option value="gable">Двускатная</option></select></label>
      </div>
      <div class="planner-field-row v45-roof-auto-field">
        <label>Передний свес, м<input id="fpPlatformRoofFrontOverhang" type="number" min="0" step="0.05" onchange="window.eftV45UpdatePlatformOptions()"></label>
        <label>Боковой свес, м<input id="fpPlatformRoofSideOverhang" type="number" min="0" step="0.05" onchange="window.eftV45UpdatePlatformOptions()"></label>
      </div>
      <div class="planner-field-row v45-roof-shed-field">
        <label>Высота у стены, м<input id="fpPlatformRoofHighHeight" type="number" min="0" step="0.1" onchange="window.eftV45UpdatePlatformOptions()"></label>
        <label>Высота края, м<input id="fpPlatformRoofLowHeight" type="number" min="0" step="0.1" onchange="window.eftV45UpdatePlatformOptions()"></label>
      </div>
      <div class="planner-field-row v45-roof-gable-field">
        <label>Высота конька, м<input id="fpPlatformRoofRidgeHeight" type="number" min="0" step="0.1" onchange="window.eftV45UpdatePlatformOptions()"></label>
        <label>Запас, %<input id="fpPlatformRoofWaste" type="number" min="0" step="1" onchange="window.eftV45UpdatePlatformOptions()"></label>
      </div>
      <div class="planner-field-row v45-roof-area-field">
        <label>Площадь<select id="fpPlatformRoofAreaMode" onchange="window.eftV45UpdatePlatformOptions()"><option value="auto">Рассчитать автоматически</option><option value="manual">Задать вручную</option></select></label>
        <label id="fpPlatformRoofManualWrap">Площадь, м²<input id="fpPlatformRoofManualArea" type="number" min="0" step="0.1" onchange="window.eftV45UpdatePlatformOptions()"></label>
      </div>
      <div class="v45-roof-result"><span>Кровля / с запасом</span><strong id="fpPlatformRoofAreaReadout">0,0 / 0,0 м²</strong></div>
    </section>`;
  if (includeRow) includeRow.insertAdjacentHTML('beforebegin', html);
  else host.insertAdjacentHTML('beforeend', html);
}

function refreshTerraceFieldVisibility(platform) {
  const roofEnabled = platform.roof.mode !== 'none';
  const manual = platform.roof.areaMode === 'manual';
  const shed = platform.roof.shape === 'shed';
  const gable = platform.roof.shape === 'gable';
  byId('fpPlatformRoofShape').disabled = !roofEnabled;
  document.querySelectorAll('.v45-roof-auto-field,.v45-roof-area-field,.v45-roof-gable-field').forEach((row) => row.classList.toggle('v45-field-hidden', !roofEnabled));
  document.querySelector('.v45-roof-shed-field')?.classList.toggle('v45-field-hidden', !roofEnabled || !shed);
  byId('fpPlatformRoofRidgeHeight')?.closest('label')?.classList.toggle('v45-field-hidden', !gable);
  byId('fpPlatformRoofManualWrap')?.classList.toggle('v45-field-hidden', !manual);
  byId('fpPlatformBindingMode').disabled = platform.foundation.mode === 'none';
  const result = terraceRoofResult(platform);
  setText('fpPlatformRoofAreaReadout', `${format(result.netArea)} / ${format(result.purchaseArea)} м²`);
}

function populateTerraceProjectUi(platform) {
  if (!platform || !byId('v45-platform-project')) return;
  const normalized = normalizeTerracePlatform(platform);
  Object.assign(platform, normalized);
  setValue('fpPlatformFoundationMode', platform.foundation.mode);
  setValue('fpPlatformBindingMode', platform.binding.mode);
  setValue('fpPlatformRoofMode', platform.roof.mode);
  setValue('fpPlatformRoofShape', platform.roof.shape);
  setValue('fpPlatformRoofFrontOverhang', platform.roof.frontOverhang);
  setValue('fpPlatformRoofSideOverhang', platform.roof.sideOverhang);
  setValue('fpPlatformRoofHighHeight', platform.roof.highHeight);
  setValue('fpPlatformRoofLowHeight', platform.roof.lowHeight);
  setValue('fpPlatformRoofRidgeHeight', platform.roof.ridgeHeight);
  setValue('fpPlatformRoofWaste', platform.roof.wastePercent);
  setValue('fpPlatformRoofAreaMode', platform.roof.areaMode);
  setValue('fpPlatformRoofManualArea', platform.roof.manualArea);
  refreshTerraceFieldVisibility(platform);
}

window.eftV45UpdatePlatformOptions = function eftV45UpdatePlatformOptions() {
  const platform = selectedPlatform();
  if (!platform) return;
  if (typeof window.fpPushHistory === 'function') window.fpPushHistory();
  const foundationMode = byId('fpPlatformFoundationMode').value;
  platform.foundation = { ...platform.foundation, mode: foundationMode };
  platform.binding = { ...platform.binding, mode: foundationMode === 'none' ? 'none' : byId('fpPlatformBindingMode').value };
  platform.roof = {
    ...platform.roof,
    mode: byId('fpPlatformRoofMode').value,
    shape: byId('fpPlatformRoofShape').value,
    frontOverhang: value('fpPlatformRoofFrontOverhang', 0.3),
    sideOverhang: value('fpPlatformRoofSideOverhang', 0.3),
    highHeight: value('fpPlatformRoofHighHeight', 2.6),
    lowHeight: value('fpPlatformRoofLowHeight', 2.2),
    ridgeHeight: value('fpPlatformRoofRidgeHeight', 0.8),
    wastePercent: value('fpPlatformRoofWaste', 10),
    areaMode: byId('fpPlatformRoofAreaMode').value,
    manualArea: value('fpPlatformRoofManualArea')
  };
  Object.assign(platform, normalizeTerracePlatform(platform));
  populateTerraceProjectUi(platform);
  if (typeof window.fpSave === 'function') window.fpSave();
  if (typeof window.fpRender === 'function') window.fpRender();
};

function installTerracePersistence() {
  const originalEnsure = window.fpEnsurePlanState;
  if (typeof originalEnsure === 'function') window.fpEnsurePlanState = function fpEnsurePlanStateV45(state) {
    return normalizeAllPlatforms(originalEnsure(state));
  };
  const originalSave = window.fpSave;
  if (typeof originalSave === 'function') window.fpSave = function fpSaveV45() {
    normalizeAllPlatforms();
    return originalSave();
  };
  const originalInspector = window.fpUpdateInspector;
  if (typeof originalInspector === 'function') window.fpUpdateInspector = function fpUpdateInspectorV45() {
    const result = originalInspector();
    populateTerraceProjectUi(selectedPlatform());
    return result;
  };
  normalizeAllPlatforms();
}

function updateCeilingNote() {
  const row = byId('sipCeilArea')?.closest('tr');
  const note = row?.querySelector('.v40-inline-note');
  if (note) note.textContent = 'При передаче плана подставляется площадь дома; значение можно изменить.';
}

function currentSurfaces() {
  return {
    floor: value('sipFloorArea'),
    walls: value('sipWallsArea'),
    ceiling: value('sipCeilArea'),
    partitions: value('sipPartArea'),
    roof: value('sipRoofCutArea')
  };
}

window.eftV44RenderCutting = function eftV44RenderCutting() {
  const host = byId('v44-cutting-table');
  if (!host) return;
  const rows = calculateSipCutting(currentSurfaces(), { extraWastePercent: value('sipWaste') });
  const totals = rows.reduce((acc, row) => ({
    area: acc.area + row.area,
    panels: acc.panels + row.panels,
    purchasedArea: acc.purchasedArea + row.purchasedArea,
    offcutArea: acc.offcutArea + row.offcutArea,
    cutMeters: acc.cutMeters + row.cutMeters
  }), { area: 0, panels: 0, purchasedArea: 0, offcutArea: 0, cutMeters: 0 });
  host.innerHTML = `<table><thead><tr><th>Конструкция</th><th>Чистая площадь</th><th>Панели</th><th>Куплено, м²</th><th>Остаток, м²</th><th>Раскрой, м.п.</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.label}</td><td>${format(row.area)}</td><td>${row.panels} шт</td><td>${format(row.purchasedArea)}</td><td>${format(row.offcutArea)}</td><td>${format(row.cutMeters)}</td></tr>`).join('')}<tr class="v44-cutting-total"><td>Всего</td><td>${format(totals.area)}</td><td>${totals.panels} шт</td><td>${format(totals.purchasedArea)}</td><td>${format(totals.offcutArea)}</td><td>${format(totals.cutMeters)}</td></tr></tbody></table>`;
};

function doorOpenSign(opening) {
  const inside = opening.orientation === 'v'
    ? (opening.x < window.fpState.house.w / 2 ? 1 : -1)
    : (opening.y < window.fpState.house.h / 2 ? 1 : -1);
  if (!opening.outer) return opening.swing === 'out' ? -1 : 1;
  return opening.swing === 'out' ? -inside : inside;
}

window.fpOpeningSvg = function fpOpeningSvgV44(opening, layout) {
  const point = window.fpSvgPoint(opening.x, opening.y);
  const selected = window.fpState.selected?.type === 'opening' && window.fpState.selected.id === opening.id;
  const length = Math.max(28, Math.min(170, (opening.width || 0.8) * layout.s));
  const half = length / 2;
  const outer = Boolean(opening.outer);
  const cut = Math.max(10, (outer ? window.fpState.wallThickness : window.fpState.partitionThickness) * layout.s + 5);
  const cssClass = `fp-opening${opening.type === 'door' && opening.doorType === 'entrance' ? ' door-entrance' : ''}${selected ? ' selected' : ''}`;
  if (opening.type === 'window') {
    const label = selected ? `<text class="fp-opening-size" x="${point.x}" y="${point.y - 11}">${Math.round((opening.width || 1.2) * 1000)}×${Math.round((opening.height || 1.2) * 1000)}</text>` : '';
    if (opening.orientation === 'v') return `<g data-type="opening" data-id="${opening.id}"><line class="fp-opening-cut" style="stroke-width:${cut}" data-type="opening" data-id="${opening.id}" x1="${point.x}" y1="${point.y - half}" x2="${point.x}" y2="${point.y + half}"/><line class="${cssClass}" data-type="opening" data-id="${opening.id}" x1="${point.x - 4}" y1="${point.y - half}" x2="${point.x - 4}" y2="${point.y + half}"/><line class="${cssClass}" x1="${point.x + 4}" y1="${point.y - half}" x2="${point.x + 4}" y2="${point.y + half}"/>${label}</g>`;
    return `<g data-type="opening" data-id="${opening.id}"><line class="fp-opening-cut" style="stroke-width:${cut}" data-type="opening" data-id="${opening.id}" x1="${point.x - half}" y1="${point.y}" x2="${point.x + half}" y2="${point.y}"/><line class="${cssClass}" data-type="opening" data-id="${opening.id}" x1="${point.x - half}" y1="${point.y - 4}" x2="${point.x + half}" y2="${point.y - 4}"/><line class="${cssClass}" x1="${point.x - half}" y1="${point.y + 4}" x2="${point.x + half}" y2="${point.y + 4}"/>${label}</g>`;
  }
  const along = opening.hinge === 'left' ? -1 : 1;
  const openSign = doorOpenSign(opening);
  const tag = opening.doorType === 'entrance' ? `<text class="fp-opening-tag" x="${point.x}" y="${point.y - 10}">ВХ</text>` : '';
  const size = selected ? `<text class="fp-opening-size" x="${point.x}" y="${point.y + 14}">${Math.round((opening.width || 0.8) * 1000)} мм</text>` : '';
  let hingeX; let hingeY; let closedX; let closedY; let openX; let openY;
  if (opening.orientation === 'v') {
    hingeX = point.x; hingeY = point.y - along * half;
    closedX = hingeX; closedY = hingeY + along * length;
    openX = hingeX + openSign * length; openY = hingeY;
  } else {
    hingeX = point.x - along * half; hingeY = point.y;
    closedX = hingeX + along * length; closedY = hingeY;
    openX = hingeX; openY = hingeY + openSign * length;
  }
  const cross = (closedX - hingeX) * (openY - hingeY) - (closedY - hingeY) * (openX - hingeX);
  const sweep = cross > 0 ? 1 : 0;
  const cutLine = opening.orientation === 'v'
    ? `<line class="fp-opening-cut" style="stroke-width:${cut}" data-type="opening" data-id="${opening.id}" x1="${point.x}" y1="${point.y - half}" x2="${point.x}" y2="${point.y + half}"/>`
    : `<line class="fp-opening-cut" style="stroke-width:${cut}" data-type="opening" data-id="${opening.id}" x1="${point.x - half}" y1="${point.y}" x2="${point.x + half}" y2="${point.y}"/>`;
  return `<g data-type="opening" data-id="${opening.id}">${cutLine}<line class="${cssClass}" data-type="opening" data-id="${opening.id}" x1="${hingeX}" y1="${hingeY}" x2="${openX}" y2="${openY}"/><path class="${cssClass}" d="M ${closedX} ${closedY} A ${length} ${length} 0 0 ${sweep} ${openX} ${openY}"/>${tag}${size}</g>`;
};

window.fpOuterDimension = function fpOuterDimensionV44(x1, y1, x2, y2, millimeters) {
  const layout = window.fpLayout();
  const sides = chooseDimensionSides(window.fpState);
  const vertical = Math.abs(x2 - x1) < 2;
  const houseWidth = window.fpState.house.w * layout.s;
  const houseHeight = window.fpState.house.h * layout.s;
  const clearance = 30;
  const label = Number(millimeters || 0).toLocaleString('ru-RU');
  if (vertical) {
    const side = sides.vertical;
    const x = side === 'left' ? layout.ox - clearance : layout.ox + houseWidth + clearance;
    const textX = side === 'left' ? x - 12 : x + 15;
    const centerY = layout.oy + houseHeight / 2;
    return `<g class="fp-outer-dimension" data-dimension-side="${side}"><line class="fp-dimension" x1="${x}" y1="${layout.oy}" x2="${x}" y2="${layout.oy + houseHeight}"/><line class="fp-dimension" x1="${x - 7}" y1="${layout.oy}" x2="${x + 7}" y2="${layout.oy}"/><line class="fp-dimension" x1="${x - 7}" y1="${layout.oy + houseHeight}" x2="${x + 7}" y2="${layout.oy + houseHeight}"/><text class="fp-dimension-text" transform="rotate(-90 ${textX} ${centerY})" x="${textX}" y="${centerY}">${label}</text></g>`;
  }
  const side = sides.horizontal;
  const y = side === 'top' ? layout.oy - clearance : layout.oy + houseHeight + clearance;
  const textY = side === 'top' ? y - 9 : y + 20;
  return `<g class="fp-outer-dimension" data-dimension-side="${side}"><line class="fp-dimension" x1="${layout.ox}" y1="${y}" x2="${layout.ox + houseWidth}" y2="${y}"/><line class="fp-dimension" x1="${layout.ox}" y1="${y - 7}" x2="${layout.ox}" y2="${y + 7}"/><line class="fp-dimension" x1="${layout.ox + houseWidth}" y1="${y - 7}" x2="${layout.ox + houseWidth}" y2="${y + 7}"/><text class="fp-dimension-text" x="${layout.ox + houseWidth / 2}" y="${textY}">${label}</text></g>`;
};

window.fpPartitionMetrics = function fpPartitionMetrics() {
  return calculatePlanMetrics(window.fpState);
};

const originalUpdateStats = window.fpUpdateStats;
window.fpUpdateStats = function fpUpdateStatsV44() {
  if (typeof originalUpdateStats === 'function') originalUpdateStats();
  if (!window.fpState) return;
  const metrics = calculatePlanMetrics(window.fpState);
  setText('fpPartitions', format(metrics.partitionLength));
};

function nearestOpeningId(opening, candidates) {
  const width = Math.round((opening.width || 0) * 1000);
  const height = Math.round((opening.height || 0) * 1000);
  let best = null;
  candidates.forEach((candidate) => {
    const match = String(candidate.name || '').match(/(\d{3,4})\s*[xх×*]\s*(\d{3,4})/i);
    if (!match) return;
    const score = Math.abs(width - Number(match[1])) + Math.abs(height - Number(match[2]));
    if (!best || score < best.score) best = { id: candidate.id, score };
  });
  return best?.id || null;
}

window.fpTransferOpeningsToCalc = function fpTransferOpeningsToCalcV44() {
  const candidates = (window.wdConfig || []).filter((item) => item.type === 'win' || item.type === 'door');
  const counts = {};
  candidates.forEach((item) => { counts[item.id] = 0; });
  let interior = 0;
  (window.fpState.openings || []).forEach((opening) => {
    if (opening.type === 'door' && opening.doorType !== 'entrance') { interior += 1; return; }
    const type = opening.type === 'window' ? 'win' : 'door';
    const id = nearestOpeningId(opening, candidates.filter((candidate) => candidate.type === type));
    if (id) counts[id] += 1;
  });
  candidates.forEach((item) => setValue(`${item.id}Qty`, counts[item.id] || 0));
  setValue('intDoorQty', interior);
  return { unmatched: 0, interior };
};

function setParameter(index, next) {
  if (window.paramsData?.[index]) window.paramsData[index].val = next;
  const inputs = byId('params-container')?.querySelectorAll('input');
  if (inputs?.[index]) inputs[index].value = next;
}

window.autoFillRoof = function autoFillRoofV44() {
  const houseArea = value('autoRoofHouse', window.paramsData?.[2]?.val || 0);
  const ridgeHeight = Math.max(0, value('autoRoofCoeff', window.paramsData?.[6]?.val || 1.8));
  const ridgeLength = Math.max(0, value('autoRoofRidge', window.paramsData?.[5]?.val || 0));
  const span = Math.max(0, window.paramsData?.[1]?.val || (houseArea && ridgeLength ? houseArea / ridgeLength : 0));
  const geometry = roofGeometry({ span, ridgeLength, ridgeHeight });
  setValue('roofSlopeArea', geometry.slopeArea.toFixed(1));
  setValue('roofGableArea', geometry.gableArea.toFixed(1));
  setValue('roofRidgeLen', ridgeLength.toFixed(1));
  setValue('roofEaveLen', (ridgeLength * 2).toFixed(1));
  setValue('sipRoofCutArea', geometry.totalSlopeArea.toFixed(1));
  setParameter(6, ridgeHeight);
  if (typeof window.calcRoof === 'function') window.calcRoof();
  window.eftV44RenderCutting();
};

window.fpTransferToCalc = function fpTransferToCalcV44() {
  const plan = window.fpState;
  const metrics = calculatePlanMetrics(plan);
  const width = Number(plan.house.w) || 0;
  const height = Number(plan.house.h) || 0;
  const wallHeight = Number(plan.wallHeight) || 2.5;
  const ridgeLength = width + 1;
  setParameter(0, width);
  setParameter(1, height);
  setParameter(2, metrics.roomArea);
  setParameter(3, wallHeight);
  setParameter(4, metrics.exteriorOpeningsArea);
  setParameter(5, ridgeLength);
  setValue('area', metrics.roomArea);
  setValue('autoHouseArea', metrics.roomArea);
  setValue('autoWallHeight', wallHeight);
  setValue('autoOpenings', metrics.exteriorOpeningsArea);
  setValue('autoRoofHouse', metrics.roomArea);
  setValue('autoRoofRidge', ridgeLength);
  setValue('calcL', width);
  setValue('calcW', height);
  setValue('sipFloorArea', metrics.roomArea);
  setValue('sipWallsArea', metrics.exteriorWallNetArea);
  setValue('sipCeilArea', metrics.roomArea);
  setValue('sipPartArea', metrics.partitionNetArea);
  const ceilingService = byId('svcWarmSipCeiling');
  if (ceilingService) ceilingService.checked = true;
  const partitionService = byId('svcInternalPartitions');
  if (partitionService) partitionService.checked = true;

  const allPiles = window.fpAllPiles();
  const mainPiles = allPiles.filter((pile) => pile.x >= -0.05 && pile.y >= -0.05 && pile.x <= width + 0.05 && pile.y <= height + 0.05).length;
  setValue('calcPileQty', mainPiles);
  setValue('terPileQty', allPiles.length - mainPiles);
  const bindingLength = (plan.pileRows || []).filter((row) => row.group === 'house').reduce((sum, row) => sum + Math.hypot(row.x2 - row.x1, row.y2 - row.y1), 0);
  setValue('calcBindingBoardLength', bindingLength.toFixed(1));

  const terrace = window.fpPlatformEquivalent('terrace');
  const porch = window.fpPlatformEquivalent('porch');
  setValue('terL', terrace.l); setValue('terW', terrace.w);
  setValue('porchL', porch.l); setValue('porchW', porch.w);
  setValue('terStairsQty', (plan.platforms || []).reduce((sum, platform) => sum + (platform.include === false ? 0 : Math.round(platform.steps || 0)), 0));
  setValue('roofTerraceArea', metrics.platformArea);

  const openingResult = window.fpTransferOpeningsToCalc();
  window.autoFillRoof();
  if (typeof window.calcPiles === 'function') window.calcPiles();
  if (typeof window.calcSip === 'function') window.calcSip();
  if (typeof window.calcTerrace === 'function') window.calcTerrace();
  if (typeof window.calcWindows === 'function') window.calcWindows();
  if (typeof window.calcInternalFinish === 'function') window.calcInternalFinish();
  setParameter(4, metrics.exteriorOpeningsArea);
  setValue('autoOpenings', metrics.exteriorOpeningsArea);
  if (typeof window.updatePrintHeader === 'function') window.updatePrintHeader();
  if (typeof window.saveBackupNow === 'function') window.saveBackupNow();
  window.eftV44RenderCutting();
  window.showToast(`План передан: ${format(metrics.roomArea)} м², перегородки ${format(metrics.partitionNetArea)} м², ${allPiles.length} свай, ${plan.openings.length} проёмов`, 'success');
  return { metrics, openingResult };
};

function installRidgeHeightUi() {
  if (window.paramsData?.[6]) window.paramsData[6].label = 'Высота конька над стеной, м';
  const inputs = byId('params-container')?.querySelectorAll('input');
  const label = inputs?.[6]?.closest('.form-group')?.querySelector('label');
  if (label) label.textContent = 'Высота конька над стеной, м';
  const roofHeight = byId('autoRoofCoeff');
  const roofLabel = roofHeight?.closest('.form-group')?.querySelector('label');
  if (roofLabel) roofLabel.innerHTML = 'Высота конька, м<span class="v44-roof-help">От верха стены до конька</span>';
  if (roofHeight) {
    roofHeight.min = '0'; roofHeight.step = '0.1';
    roofHeight.addEventListener('input', () => window.autoFillRoof());
  }
  byId('autoRoofRidge')?.addEventListener('input', () => window.autoFillRoof());
}

function installPrintSpecs() {
  const header = byId('print-header');
  if (!header || byId('v44-print-specs')) return;
  header.insertAdjacentHTML('beforeend', '<section class="v44-print-specs" id="v44-print-specs"><h2>Характеристики дома и состав расчёта</h2><div id="v44-print-house"></div><div id="v44-print-construction"></div><p class="wide"><strong>Рассчитано для клиента:</strong> <span id="v44-print-sections">—</span></p></section>');
}

function updatePrintSpecs() {
  if (!window.fpState || !byId('v44-print-specs')) return;
  const metrics = calculatePlanMetrics(window.fpState);
  const roofType = document.querySelector('.btn-roofnav.active')?.textContent.trim() || 'не выбрана';
  byId('v44-print-house').innerHTML = `<p><strong>Габариты:</strong> ${format(window.fpState.house.w)} × ${format(window.fpState.house.h)} м</p><p><strong>Высота стен:</strong> ${format(window.fpState.wallHeight)} м</p><p><strong>Площадь комнат:</strong> ${format(metrics.roomArea)} м²</p><p><strong>Периметр:</strong> ${format(metrics.perimeter)} м</p><p><strong>Сваи:</strong> ${window.fpAllPiles().length} шт</p>`;
  byId('v44-print-construction').innerHTML = `<p><strong>Внешняя панель:</strong> ${Math.round(window.fpState.wallThickness * 1000)} мм</p><p><strong>Перегородки:</strong> ${format(metrics.partitionLength)} м / ${format(metrics.partitionNetArea)} м²</p><p><strong>Проёмы:</strong> ${window.fpState.openings.length} шт / ${format(metrics.totalOpeningsArea)} м²</p><p><strong>Терраса и крыльцо:</strong> ${format(metrics.platformArea)} м²</p><p><strong>Кровля:</strong> ${roofType}, конёк ${format(value('autoRoofCoeff'))} м</p>`;
  const sections = (window.estimateData || []).filter((row) => row.type === 'section').map((row) => row.name).filter(Boolean);
  setText('v44-print-sections', sections.length ? sections.join('; ') : 'смета ещё не сформирована');
}

const originalUpdatePrintHeader = window.updatePrintHeader;
window.updatePrintHeader = function updatePrintHeaderV44() {
  if (typeof originalUpdatePrintHeader === 'function') originalUpdatePrintHeader();
  updatePrintSpecs();
};

const originalCalcSip = window.calcSip;
window.calcSip = function calcSipV44() {
  const result = typeof originalCalcSip === 'function' ? originalCalcSip() : undefined;
  window.eftV44RenderCutting();
  return result;
};

const originalUpdateParam = window.updateParam;
window.updateParam = function updateParamV44(index, next) {
  const result = typeof originalUpdateParam === 'function' ? originalUpdateParam(index, next) : undefined;
  ['calcPiles', 'calcSip', 'calcRoof', 'calcTerrace', 'calcDelivery', 'calcWindows', 'calcInternalFinish', 'calcExternalFinish'].forEach((name) => {
    if (typeof window[name] === 'function') window[name]();
  });
  updatePrintSpecs();
  return result;
};

const originalBuildProjectSnapshot = window.buildProjectSnapshot;
window.buildProjectSnapshot = function buildProjectSnapshotV44() {
  normalizeAllPlatforms();
  const snapshot = typeof originalBuildProjectSnapshot === 'function' ? originalBuildProjectSnapshot() : {};
  snapshot.version = 45;
  if (window.fpState) snapshot.planMetrics = calculatePlanMetrics(window.fpState);
  return snapshot;
};

function bindParameterSynchronization() {
  const height = byId('autoWallHeight');
  if (height) height.addEventListener('input', () => {
    setParameter(3, value('autoWallHeight'));
    if (window.fpState) window.fpState.wallHeight = value('autoWallHeight');
    if (typeof window.autoFillSip === 'function') window.autoFillSip();
  });
}

function init() {
  installStyles();
  installTerraceProjectUi();
  installTerracePersistence();
  installCuttingUi();
  updateCeilingNote();
  installRidgeHeightUi();
  installPrintSpecs();
  bindParameterSynchronization();
  document.title = document.title.replace(/v4\d/gi, 'v45');
  const badge = document.querySelector('.v37-badge');
  if (badge) badge.textContent = 'v45 · параметры террасы';
  const note = byId('v37-start-note');
  if (note) note.innerHTML = '<i class="fas fa-circle-check"></i><b> EFT v45:</b> каждая терраса хранит тип свайного поля, обвязки и кровли; параметры сохраняются вместе с планом и проектом.';
  window.autoFillRoof();
  window.eftV44RenderCutting();
  updatePrintSpecs();
  if (typeof window.fpRender === 'function') window.fpRender();
}

init();
