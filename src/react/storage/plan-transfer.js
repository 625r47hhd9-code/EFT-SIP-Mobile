import { normalizePlan, REACT_PROJECT_VERSION } from '../state/project-model.js';

const PLAN_SERVICES = [
  'foundation', 'sipFloor', 'sipWalls', 'sipCeiling', 'partitions', 'roof', 'terrace', 'openings'
];

export function createPlanTransfer(project) {
  return {
    format: 'eft-house-plan',
    schemaVersion: 1,
    appVersion: REACT_PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    sourceProject: project.meta?.projectNum || '',
    plan: structuredClone(project.plan),
    settings: {
      piles: structuredClone(project.settings?.piles || {}),
      sip: structuredClone(project.settings?.sip || {}),
      roof: structuredClone(project.settings?.roof || {})
    },
    services: Object.fromEntries(PLAN_SERVICES.map((key) => [key, project.services?.[key] !== false]))
  };
}

export function validatePlanTransfer(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Файл плана пуст или повреждён');
  const plan = raw.format === 'eft-house-plan' ? raw.plan : raw.format === 'eft-project' || raw.plan ? raw.plan : null;
  if (!plan?.house || !Number(plan.house.w) || !Number(plan.house.h)) throw new Error('В файле не найден корректный план дома');
  return {
    plan: normalizePlan(plan),
    settings: raw.settings || {},
    services: raw.services || {},
    sourceProject: raw.sourceProject || raw.meta?.projectNum || ''
  };
}

export function applyPlanTransfer(project, raw) {
  const incoming = validatePlanTransfer(raw);
  const next = structuredClone(project);
  next.plan = incoming.plan;
  next.settings.piles = { ...next.settings.piles, ...(incoming.settings.piles || {}) };
  next.settings.sip = { ...next.settings.sip, ...(incoming.settings.sip || {}) };
  next.settings.roof = { ...next.settings.roof, ...(incoming.settings.roof || {}) };
  for (const key of PLAN_SERVICES) {
    if (typeof incoming.services[key] === 'boolean') next.services[key] = incoming.services[key];
  }
  return next;
}

export function planTransferFile(project) {
  const payload = createPlanTransfer(project);
  return new File([JSON.stringify(payload, null, 2)], `План_ЭФТ_${project.meta?.projectNum || 'без_номера'}.eft-plan.json`, { type: 'application/json;charset=utf-8' });
}

export function downloadPlanTransfer(project) {
  const file = planTransferFile(project);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  return file;
}

export async function sharePlanTransfer(project) {
  const file = planTransferFile(project);
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: `План дома ЭФТ № ${project.meta?.projectNum || '—'}`,
      text: 'Откройте этот файл в разделе «План дома» калькулятора ЭФТ.',
      files: [file]
    });
    return 'shared';
  }
  downloadPlanTransfer(project);
  return 'downloaded';
}
