import eft0003 from './eft-template-0003-70.json' with { type: 'json' };
import { createDefaultProject, createCompactPlan } from '../state/project-model.js';
import { applyPlanTransfer } from '../storage/plan-transfer.js';

const clone = (value) => structuredClone(value);

function defaultTransfer() {
  const project = createDefaultProject();
  return {
    format: 'eft-house-plan',
    sourceProject: project.meta.projectNum,
    plan: clone(project.plan),
    settings: {
      piles: clone(project.settings.piles),
      sip: clone(project.settings.sip),
      roof: clone(project.settings.roof)
    },
    services: {
      foundation: project.services.foundation,
      sipFloor: project.services.sipFloor,
      sipWalls: project.services.sipWalls,
      sipCeiling: project.services.sipCeiling,
      partitions: project.services.partitions,
      roof: project.services.roof,
      terrace: project.services.terrace,
      openings: project.services.openings
    }
  };
}

function compactTransfer() {
  const base = defaultTransfer();
  base.sourceProject = 'M-Compact-70';
  base.plan = createCompactPlan();
  return base;
}

export const PROJECT_TEMPLATES = [
  {
    id: 'eft-0003-70',
    name: 'ЭФТ 0003',
    subtitle: '70 м² · 7 × 10 м',
    tag: '1 этаж',
    description: '2 спальни, гостиная, кухня, санузел, котельная, холл и крыльцо.',
    facts: ['Стены 2,50 м', 'СИП стен 174 мм', 'Пол 224 мм', 'Двускатная кровля'],
    transfer: eft0003
  },
  {
    id: 'eft-family-112',
    name: 'Семейный',
    subtitle: '≈112 м² · 8,66 × 12,98 м',
    tag: '8 помещений',
    description: 'Просторная базовая планировка с террасой и крыльцом.',
    facts: ['Стены 2,50 м', 'СИП стен 174 мм', 'Пол 224 мм', 'Двускатная кровля'],
    transfer: defaultTransfer()
  },
  {
    id: 'eft-compact-70',
    name: 'Компакт',
    subtitle: '70 м² · 10 × 7 м',
    tag: '7 помещений',
    description: 'Компактная одноэтажная схема для быстрого старта проекта.',
    facts: ['Стены 2,50 м', 'СИП стен 174 мм', 'Автообвязка', 'Двускатная кровля'],
    transfer: compactTransfer()
  }
];

export function applyProjectTemplate(project, template) {
  const next = applyPlanTransfer(project, template.transfer);
  next.meta = { ...next.meta, projectNum: template.transfer.sourceProject || template.name };
  return next;
}
