import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import {
  Calculator, ChevronLeft, ChevronRight, FilePlus2, FileUp, History, Home,
  LayoutTemplate,
  Layers3, Moon, MoreHorizontal, PackageOpen, Ruler, Save, Scissors,
  Settings2, Sun, Tags, Truck, X, Hammer, PanelTop, Trees, PaintRoller,
  HardHat, Check, RotateCcw, Box, Printer, FileText, ReceiptText, Share2
} from 'lucide-react';
import { useProject } from '../state/ProjectContext.jsx';
import { calculateProject } from '../calculations/estimate-engine.js';
import {
  createProjectWithCurrentPrices, migrateProject, REACT_BACKUPS_KEY, REACT_PROJECT_VERSION
} from '../state/project-model.js';
import { formatMoney } from '../utils/format.js';
import { PROJECT_TEMPLATES, applyProjectTemplate } from '../data/project-templates.js';

const PlanScreen = lazy(() => import('../screens/PlanScreen.jsx'));
const ParametersScreen = lazy(() => import('../screens/ParametersScreen.jsx'));
const Calculators = lazy(() => import('../screens/Calculators.jsx'));
const PriceScreen = lazy(() => import('../screens/PriceScreen.jsx'));
const EstimateScreen = lazy(() => import('../screens/EstimateScreen.jsx'));
const CalculationSettingsScreen = lazy(() => import('../screens/CalculationSettingsScreen.jsx'));
const VisualizationScreen = lazy(() => import('../screens/VisualizationScreen.jsx'));
const SimpleEstimateScreen = lazy(() => import('../screens/SimpleEstimateScreen.jsx'));

const BOTTOM_NAV = [
  { id: 'home', label: 'Дом', icon: Home },
  { id: 'construction', label: 'Конструкция', icon: Layers3 },
  { id: 'materials', label: 'Материалы', icon: PackageOpen },
  { id: 'cutting', label: 'Раскрой', icon: Scissors },
  { id: 'estimate', label: 'Смета', icon: Calculator }
];

const GROUP_SCREENS = {
  home: [
    { id: 'visualization', label: '3D', icon: Box },
    { id: 'plan', label: 'Редактор плана', icon: Ruler },
    { id: 'parameters', label: 'Параметры', icon: Settings2 }
  ],
  construction: [
    { id: 'piles', label: 'Сваи', icon: HardHat },
    { id: 'sip', label: 'СИП', icon: Layers3 },
    { id: 'roof', label: 'Кровля', icon: Home },
    { id: 'openings', label: 'Окна / двери', icon: PanelTop },
    { id: 'terrace', label: 'Терраса', icon: Trees }
  ],
  materials: [
    { id: 'price', label: 'Прайс', icon: Tags },
    { id: 'finishing', label: 'Отделка', icon: PaintRoller },
    { id: 'delivery', label: 'Доставка', icon: Truck }
  ]
};

const DEFAULT_SCREEN = {
  home: 'visualization',
  construction: 'sip',
  materials: 'price',
  estimate: 'estimate'
};

function downloadProject(project) {
  const payload = {
    ...project,
    savedAt: new Date().toISOString(),
    appVersion: REACT_PROJECT_VERSION,
    schemaVersion: 3
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Проект_ЭФТ_${project.meta.projectNum || 'без_номера'}_${project.meta.date}.eft.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function Screen({ active, onNavigate }) {
  if (active === 'visualization') return <VisualizationScreen />;
  if (active === 'plan') return <PlanScreen onNavigate={onNavigate} />;
  if (active === 'parameters') return <ParametersScreen />;
  if (active === 'price') return <PriceScreen />;
  if (active === 'estimate') return <EstimateScreen />;
  if (active === 'calculation-settings') return <CalculationSettingsScreen />;
  if (active === 'simple-estimate') return <SimpleEstimateScreen />;
  return <Calculators type={active} />;
}

function CuttingScreen({ calculation }) {
  const sipRows = calculation?.sip?.cutting || [];
  const roof = calculation?.roof?.sipCutting;
  const rows = [
    ...sipRows.map((row) => ({
      id: `sip-${row.key}`,
      title: row.key === 'floor' ? 'Пол' : row.key === 'walls' ? 'Наружные стены' : row.key === 'ceiling' ? 'Потолок' : row.key,
      area: row.area,
      panels: row.panels,
      cutMeters: row.cutMeters,
      waste: row.wastePercent
    })),
    ...(roof?.panels ? [{ id: 'roof', title: 'Кровля из СИП', area: roof.area, panels: roof.panels, cutMeters: roof.cutMeters, waste: roof.wastePercent }] : [])
  ];
  const totalPanels = rows.reduce((sum, row) => sum + (Number(row.panels) || 0), 0);
  const totalArea = rows.reduce((sum, row) => sum + (Number(row.area) || 0), 0);
  const totalCuts = rows.reduce((sum, row) => sum + (Number(row.cutMeters) || 0), 0);

  return (
    <section className="mobile-cutting-screen">
      <div className="mobile-screen-intro">
        <span className="eyebrow">Раскрой СИП</span>
        <h1>Панели по зонам</h1>
        <p>Данные берутся из того же расчётного движка, что и смета. Изменения плана и параметров пересчитываются автоматически.</p>
      </div>
      <div className="mobile-result-grid">
        <article><span>Панелей</span><strong>{totalPanels}</strong><small>шт.</small></article>
        <article><span>Площадь</span><strong>{totalArea.toFixed(1)}</strong><small>м²</small></article>
        <article><span>Резка</span><strong>{totalCuts.toFixed(1)}</strong><small>м.п.</small></article>
      </div>
      <div className="mobile-card-list">
        {rows.length ? rows.map((row) => (
          <article className="mobile-cut-card" key={row.id}>
            <div className="mobile-cut-card-head">
              <div><span className="cut-icon"><Scissors size={18} /></span><strong>{row.title}</strong></div>
              <b>{row.panels} шт.</b>
            </div>
            <div className="mobile-cut-stats">
              <span>Площадь <strong>{Number(row.area || 0).toFixed(1)} м²</strong></span>
              <span>Линии реза <strong>{Number(row.cutMeters || 0).toFixed(1)} м</strong></span>
              {row.waste !== undefined ? <span>Запас <strong>{Number(row.waste || 0).toFixed(1)}%</strong></span> : null}
            </div>
          </article>
        )) : <div className="mobile-empty"><Scissors /><strong>Нет данных раскроя</strong><span>Сначала задайте план дома и включите СИП-конструкции.</span></div>}
      </div>
    </section>
  );
}

function ActionSheet({ open, onClose, actions, theme, canUndo, canRedo }) {
  if (!open) return null;
  return (
    <div className="mobile-sheet-backdrop" onMouseDown={onClose}>
      <section className="mobile-action-sheet" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
        <header><div><strong>Меню</strong><span>Проект и настройки</span></div><button onClick={onClose} aria-label="Закрыть"><X /></button></header>
        <div className="sheet-action-grid">
          <button onClick={actions.undo} disabled={!canUndo}><ChevronLeft /><span>Отменить</span></button>
          <button onClick={actions.redo} disabled={!canRedo}><ChevronRight /><span>Повторить</span></button>
          <button onClick={actions.theme}>{theme === 'light' ? <Moon /> : <Sun />}<span>{theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}</span></button>
          <button onClick={actions.print}><Printer /><span>Печать</span></button>
          <button onClick={actions.pdf}><FileText /><span>PDF документ</span></button>
          <button onClick={actions.simpleEstimate}><ReceiptText /><span>Упрощённая смета</span></button>
          <button onClick={actions.share}><Share2 /><span>Поделиться</span></button>
          <button onClick={actions.settings}><Settings2 /><span>Связи расчётов</span></button>
          <button onClick={actions.templates}><LayoutTemplate /><span>Шаблоны домов</span></button>
          <button onClick={actions.newProject}><FilePlus2 /><span>Новый проект</span></button>
          <button onClick={actions.save}><Save /><span>Сохранить</span></button>
          <button onClick={actions.open}><FileUp /><span>Открыть файл</span></button>
          <button onClick={actions.backups}><History /><span>Резервные копии</span></button>
        </div>
      </section>
    </div>
  );
}


function TemplatePreview({ plan }) {
  const w = Number(plan?.house?.w) || 10;
  const h = Number(plan?.house?.h) || 8;
  const scale = Math.min(220 / w, 150 / h);
  const ox = (240 - w * scale) / 2;
  const oy = (170 - h * scale) / 2;
  const points = (room) => (room.points || []).map((p) => `${ox + p.x * scale},${oy + p.y * scale}`).join(' ');
  return (
    <svg viewBox="0 0 240 170" className="template-plan-preview" aria-hidden="true">
      <rect x={ox} y={oy} width={w * scale} height={h * scale} rx="2" className="template-house-outline" />
      {(plan?.rooms || []).map((room) => <polygon key={room.id} points={points(room)} className="template-room" />)}
      {(plan?.openings || []).filter((item) => item.outer).map((item) => {
        const x = ox + Number(item.x || 0) * scale; const y = oy + Number(item.y || 0) * scale;
        return <circle key={item.id} cx={x} cy={y} r="2.5" className={item.type === 'door' ? 'template-door' : 'template-window'} />;
      })}
    </svg>
  );
}

function TemplatesModal({ open, onClose, onApply }) {
  const [selected, setSelected] = useState(PROJECT_TEMPLATES[0]?.id);
  if (!open) return null;
  const active = PROJECT_TEMPLATES.find((item) => item.id === selected) || PROJECT_TEMPLATES[0];
  return (
    <div className="mobile-sheet-backdrop template-backdrop" onMouseDown={onClose}>
      <section className="mobile-template-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Шаблоны домов">
        <div className="sheet-handle" />
        <header className="template-modal-header">
          <div><span className="eyebrow">Библиотека ЭФТ</span><strong>Выберите шаблон дома</strong><small>Планировка и конструктивные настройки загрузятся вместе.</small></div>
          <button onClick={onClose} aria-label="Закрыть"><X /></button>
        </header>
        <div className="template-card-scroll">
          {PROJECT_TEMPLATES.map((template) => (
            <button key={template.id} className={`project-template-card ${selected === template.id ? 'active' : ''}`} onClick={() => setSelected(template.id)}>
              <div className="template-preview-wrap"><TemplatePreview plan={template.transfer.plan} /><span className="template-tag">{template.tag}</span></div>
              <div className="template-card-copy">
                <div><strong>{template.name}</strong><span>{template.subtitle}</span></div>
                <p>{template.description}</p>
                <div className="template-facts">{template.facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
              </div>
              <span className="template-select-indicator">{selected === template.id ? <Check size={18} /> : null}</span>
            </button>
          ))}
        </div>
        <footer className="template-modal-footer">
          <div><span>Будет загружен</span><strong>{active?.name}</strong><small>Цены текущего проекта сохранятся.</small></div>
          <button className="template-apply-button" onClick={() => onApply(active)}>Загрузить шаблон</button>
        </footer>
      </section>
    </div>
  );
}

function BackupModal({ open, backups, onClose, onRestore }) {
  if (!open) return null;
  return (
    <div className="mobile-sheet-backdrop" onMouseDown={onClose}>
      <section className="mobile-backups" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header><div><strong>Резервные копии</strong><span>Хранятся в этом браузере</span></div><button onClick={onClose}><X /></button></header>
        <div className="backup-scroll">
          {backups.length ? backups.map((backup) => (
            <button className="mobile-backup-row" key={backup.backupId || backup.savedAt} onClick={() => onRestore(backup)}>
              <History />
              <span><strong>Проект № {backup.meta?.projectNum || 'без номера'}</strong><small>{backup.meta?.customer || 'Заказчик не указан'}</small></span>
              <time>{new Date(backup.savedAt).toLocaleString('ru-RU')}</time>
            </button>
          )) : <div className="mobile-empty"><RotateCcw /><strong>Копий пока нет</strong><span>Они создаются при сохранении и перед созданием нового проекта.</span></div>}
        </div>
      </section>
    </div>
  );
}

export function App() {
  const { project, replace, undo, redo, canUndo, canRedo, checkpoint, saveState } = useProject();
  const [section, setSection] = useState('home');
  const [active, setActive] = useState('visualization');
  const [lastScreens, setLastScreens] = useState(DEFAULT_SCREEN);
  const [theme, setTheme] = useState(() => localStorage.getItem('eft-react-theme') || 'light');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [notice, setNotice] = useState('Автосохранение включено');
  const fileRef = useRef(null);
  const calculation = useMemo(() => calculateProject(project), [project]);

  const navigateSection = (nextSection) => {
    setSection(nextSection);
    if (nextSection === 'cutting') return;
    if (nextSection === 'home') {
      sessionStorage.setItem('eft-visual-mode', 'plan');
      window.dispatchEvent(new CustomEvent('eft-visual-mode', { detail: 'plan' }));
      setActive('visualization');
      setLastScreens((prev) => ({ ...prev, home: 'visualization' }));
      return;
    }
    const next = lastScreens[nextSection] || DEFAULT_SCREEN[nextSection];
    if (next) setActive(next);
  };

  const navigateScreen = (screenId) => {
    setActive(screenId);
    setLastScreens((prev) => ({ ...prev, [section]: screenId }));
  };

  const changeTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('eft-react-theme', next);
    setSheetOpen(false);
  };

  const importProject = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      replace(migrateProject(JSON.parse(await file.text())));
      setNotice(`Открыт: ${file.name}`);
      setSection('home');
      sessionStorage.setItem('eft-visual-mode', 'plan');
      window.dispatchEvent(new CustomEvent('eft-visual-mode', { detail: 'plan' }));
      setActive('visualization');
    } catch (error) {
      setNotice(`Ошибка открытия: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  };

  const newProject = () => {
    setSheetOpen(false);
    if (!window.confirm('Создать новый проект? Текущий проект сначала будет сохранён резервной копией.')) return;
    checkpoint();
    replace(createProjectWithCurrentPrices(project));
    setSection('home');
    sessionStorage.setItem('eft-visual-mode', 'plan');
    window.dispatchEvent(new CustomEvent('eft-visual-mode', { detail: 'plan' }));
    setActive('visualization');
    setNotice('Создан новый проект');
  };

  const saveProject = () => {
    checkpoint();
    downloadProject(project);
    setNotice('Проект сохранён');
    setSheetOpen(false);
  };

  const backups = useMemo(() => {
    if (!backupOpen) return [];
    try { return JSON.parse(localStorage.getItem(REACT_BACKUPS_KEY) || '[]'); } catch { return []; }
  }, [backupOpen]);

  const sectionTabs = GROUP_SCREENS[section] || [];
  const projectName = project.meta?.projectNum ? `Дом № ${project.meta.projectNum}` : 'Новый дом';

  return (
    <div className={`app mobile-app-shell ${section === 'home' && active === 'plan' ? 'plan-editor-active' : ''}`} data-theme={theme}>
      <header className="mobile-topbar">
        <div className="mobile-topbar-main eft-header-v791">
          <div className="eft-header-brand"><img src="./icons/eft-logo.png" alt="ЭФТ"/><div><span className="eft-header-version">M 7.9.4</span></div></div>
          <div className="mobile-project-title eft-project-center"><strong>{projectName}</strong><span>{Number(project.plan.house?.w||0).toLocaleString('ru-RU')} × {Number(project.plan.house?.h||0).toLocaleString('ru-RU')} м · стены {Number(project.plan.wallHeight||0).toLocaleString('ru-RU')} м</span></div>
          <button className="mobile-more-button mobile-menu-button" onClick={() => setSheetOpen(true)} aria-label="Меню проекта"><MoreHorizontal /><span>Меню</span></button>
        </div>
        <div className="mobile-total-strip">
          <span><small>Материалы</small><strong>{formatMoney(calculation.totals.materials)}</strong></span>
          <span><small>Работы</small><strong>{formatMoney(calculation.totals.labor)}</strong></span>
          <span className="grand"><small>Итого</small><strong>{formatMoney(calculation.totals.total)}</strong></span>
        </div>
        {sectionTabs.length ? (
          <nav className="mobile-subnav" aria-label="Подразделы">
            {sectionTabs.map(({ id, label, icon: Icon }) => (
              <button key={id} className={active === id ? 'active' : ''} onClick={() => navigateScreen(id)}>
                <Icon size={17} /><span>{label}</span>
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="mobile-workspace">
        <Suspense fallback={<div className="mobile-loader"><span /><strong>Загружаю раздел…</strong></div>}>
          {section === 'cutting' ? <CuttingScreen calculation={calculation} /> : <Screen active={active} onNavigate={navigateScreen} />}
        </Suspense>
      </main>

      <div className={`mobile-save-status ${saveState.status}`}><span className="status-dot" />{notice}</div>

      <nav className="mobile-bottom-nav" aria-label="Основные разделы">
        {BOTTOM_NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} className={section === id ? 'active' : ''} onClick={() => navigateSection(id)}>
            <span className="bottom-icon"><Icon /></span><span>{label}</span>
          </button>
        ))}
      </nav>

      <input ref={fileRef} className="visually-hidden" type="file" accept=".json,.eft.json" onChange={importProject} />

      <ActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        theme={theme}
        canUndo={canUndo}
        canRedo={canRedo}
        actions={{
          undo: () => { undo(); setSheetOpen(false); },
          redo: () => { redo(); setSheetOpen(false); },
          theme: () => { changeTheme(); setSheetOpen(false); },
          print: () => { setActive('estimate'); setSection('estimate'); setSheetOpen(false); window.setTimeout(() => window.print(), 250); },
          pdf: () => { setActive('estimate'); setSection('estimate'); setSheetOpen(false); setNotice('В окне печати выберите «Сохранить как PDF»'); window.setTimeout(() => window.print(), 250); },
          simpleEstimate: () => { setActive('simple-estimate'); setSection('home'); setSheetOpen(false); },
          share: async () => { setSheetOpen(false); const text = `ЭФТ · ${projectName} · ${Number(project.plan.house?.w||0).toLocaleString('ru-RU')} × ${Number(project.plan.house?.h||0).toLocaleString('ru-RU')} м · ${formatMoney(calculation.totals.total)}`; if (navigator.share) { try { await navigator.share({ title: projectName, text, url: location.href }); } catch {} } else { await navigator.clipboard?.writeText(text); setNotice('Данные проекта скопированы'); } },
          settings: () => { setActive('calculation-settings'); setSection('home'); setSheetOpen(false); },
          templates: () => { setSheetOpen(false); setTemplatesOpen(true); },
          newProject,
          save: saveProject,
          open: () => { setSheetOpen(false); fileRef.current?.click(); },
          backups: () => { setSheetOpen(false); setBackupOpen(true); }
        }}
      />

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onApply={(template) => {
          checkpoint();
          replace(applyProjectTemplate(project, template));
          setTemplatesOpen(false);
          setSection('home');
          sessionStorage.setItem('eft-visual-mode', 'plan');
          window.dispatchEvent(new CustomEvent('eft-visual-mode', { detail: 'plan' }));
          setActive('visualization');
          setNotice(`Загружен шаблон: ${template.name}`);
        }}
      />

      <BackupModal
        open={backupOpen}
        backups={backups}
        onClose={() => setBackupOpen(false)}
        onRestore={(backup) => {
          replace(backup);
          setBackupOpen(false);
          setNotice('Восстановлена резервная копия');
        }}
      />
    </div>
  );
}
