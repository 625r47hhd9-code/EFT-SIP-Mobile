const FOUNDATION_MODES = new Set(['shared', 'separate', 'none']);
const BINDING_MODES = new Set(['shared', 'separate', 'none']);
const ROOF_MODES = new Set(['none', 'cold', 'warm']);
const ROOF_SHAPES = new Set(['shed', 'continuation', 'gable']);
const AREA_MODES = new Set(['auto', 'manual']);
const GABLE_TYPES = new Set(['none', 'auto', 'cold', 'sip']);
const POST_SECTIONS = new Set(['auto', '100x100', '150x100']);

const positive = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const choice = (value, choices, fallback) => choices.has(value) ? value : fallback;
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

export const TERRACE_PROJECT_DEFAULTS = Object.freeze({
  foundation: Object.freeze({ mode: 'shared' }),
  binding: Object.freeze({ mode: 'shared' }),
  roof: Object.freeze({
    mode: 'none',
    shape: 'shed',
    areaMode: 'auto',
    manualArea: 0,
    frontOverhang: 0.3,
    sideOverhang: 0.3,
    highHeight: 2.6,
    lowHeight: 2.2,
    ridgeHeight: 0.8,
    gableType: 'auto',
    gableCount: 1,
    postSection: 'auto',
    wastePercent: 10
  })
});

export function normalizeTerracePlatform(platform = {}) {
  const foundationMode = choice(platform.foundation?.mode, FOUNDATION_MODES, TERRACE_PROJECT_DEFAULTS.foundation.mode);
  const bindingFallback = foundationMode === 'none' ? 'none' : TERRACE_PROJECT_DEFAULTS.binding.mode;
  const bindingMode = foundationMode === 'none'
    ? 'none'
    : choice(platform.binding?.mode, BINDING_MODES, bindingFallback);
  const roof = platform.roof || {};
  return {
    ...platform,
    foundation: { ...platform.foundation, mode: foundationMode },
    binding: { ...platform.binding, mode: bindingMode },
    roof: {
      ...roof,
      mode: choice(roof.mode, ROOF_MODES, TERRACE_PROJECT_DEFAULTS.roof.mode),
      shape: choice(roof.shape, ROOF_SHAPES, TERRACE_PROJECT_DEFAULTS.roof.shape),
      areaMode: choice(roof.areaMode, AREA_MODES, TERRACE_PROJECT_DEFAULTS.roof.areaMode),
      manualArea: positive(roof.manualArea, TERRACE_PROJECT_DEFAULTS.roof.manualArea),
      frontOverhang: positive(roof.frontOverhang, TERRACE_PROJECT_DEFAULTS.roof.frontOverhang),
      sideOverhang: positive(roof.sideOverhang, TERRACE_PROJECT_DEFAULTS.roof.sideOverhang),
      highHeight: positive(roof.highHeight, TERRACE_PROJECT_DEFAULTS.roof.highHeight),
      lowHeight: positive(roof.lowHeight, TERRACE_PROJECT_DEFAULTS.roof.lowHeight),
      ridgeHeight: positive(roof.ridgeHeight, TERRACE_PROJECT_DEFAULTS.roof.ridgeHeight),
      gableType: choice(roof.gableType, GABLE_TYPES, TERRACE_PROJECT_DEFAULTS.roof.gableType),
      gableCount: Math.min(2, Math.round(positive(roof.gableCount, TERRACE_PROJECT_DEFAULTS.roof.gableCount))),
      postSection: choice(roof.postSection, POST_SECTIONS, TERRACE_PROJECT_DEFAULTS.roof.postSection),
      wastePercent: positive(roof.wastePercent, TERRACE_PROJECT_DEFAULTS.roof.wastePercent)
    }
  };
}

export function terraceAttachmentSide(platform = {}, house = {}) {
  const x = Number(platform.x) || 0;
  const y = Number(platform.y) || 0;
  const width = positive(platform.w);
  const height = positive(platform.h);
  const houseWidth = positive(house.w);
  const houseHeight = positive(house.h);
  const candidates = [
    ['top', Math.abs(y + height)],
    ['right', Math.abs(x - houseWidth)],
    ['bottom', Math.abs(y - houseHeight)],
    ['left', Math.abs(x + width)]
  ];
  return candidates.sort((left, right) => left[1] - right[1])[0][0];
}

export function calculateTerraceRoof(platform = {}, house = {}, options = {}) {
  const normalized = normalizeTerracePlatform(platform);
  const { roof } = normalized;
  const side = terraceAttachmentSide(normalized, house);
  const horizontalAttachment = side === 'top' || side === 'bottom';
  const attachedLength = horizontalAttachment ? positive(normalized.w) : positive(normalized.h);
  const projection = horizontalAttachment ? positive(normalized.h) : positive(normalized.w);
  const roofWidth = attachedLength + roof.sideOverhang * 2;
  const roofRun = projection + roof.frontOverhang;
  const gableSlopeEdge = Math.hypot(roofWidth / 2, roof.ridgeHeight);
  const shedSlopeEdge = roof.shape === 'continuation'
    ? roofRun * Math.max(1, positive(options.mainSlopeCoefficient, 1))
    : Math.hypot(roofRun, Math.abs(roof.highHeight - roof.lowHeight));
  let automaticArea = 0;
  if (roof.mode !== 'none') {
    if (roof.shape === 'gable') {
      automaticArea = 2 * roofRun * Math.hypot(roofWidth / 2, roof.ridgeHeight);
    } else if (roof.shape === 'continuation') {
      automaticArea = roofWidth * roofRun * Math.max(1, positive(options.mainSlopeCoefficient, 1));
    } else {
      automaticArea = roofWidth * Math.hypot(roofRun, Math.abs(roof.highHeight - roof.lowHeight));
    }
  }
  const netArea = roof.mode === 'none' ? 0 : (roof.areaMode === 'manual' ? roof.manualArea : automaticArea);
  const resolvedGableType = roof.gableType === 'auto' ? (roof.mode === 'warm' ? 'sip' : 'cold') : roof.gableType;
  const gableArea = roof.mode !== 'none' && roof.shape === 'gable' && resolvedGableType !== 'none'
    ? roofWidth * roof.ridgeHeight / 2 * roof.gableCount
    : 0;
  const requestedSection = roof.postSection === 'auto'
    ? (positive(options.wallPanelThickness, 174) <= 124 ? '100x100' : '150x100')
    : roof.postSection;
  const [postWidthMm, postDepthMm] = requestedSection.split('x').map(Number);
  const postSpacing = Math.max(0.5, positive(options.postSpacing, 3));
  const postCount = roof.mode === 'none' || !attachedLength ? 0 : Math.max(2, Math.ceil(attachedLength / postSpacing) + 1);
  const postLength = postCount * Math.max(0, roof.lowHeight);
  return {
    side,
    attachedLength: round(attachedLength, 3),
    projection: round(projection, 3),
    netArea: round(netArea, 2),
    purchaseArea: round(netArea * (1 + roof.wastePercent / 100), 2),
    ridgeLength: roof.mode !== 'none' && roof.shape === 'gable' ? round(roofRun, 3) : 0,
    eaveLength: roof.mode === 'none' ? 0 : round(roof.shape === 'gable' ? roofRun * 2 : roofWidth, 3),
    vergeLength: roof.mode === 'none' ? 0 : round(roof.shape === 'gable' ? gableSlopeEdge * 4 : shedSlopeEdge * 2, 3),
    gableType: resolvedGableType,
    gableArea: round(gableArea, 2),
    gablePurchaseArea: round(gableArea * (1 + roof.wastePercent / 100), 2),
    postSection: requestedSection,
    postCount,
    postLength: round(postLength, 2),
    postVolume: round(postLength * postWidthMm / 1000 * postDepthMm / 1000, 3),
    wastePercent: roof.wastePercent
  };
}
