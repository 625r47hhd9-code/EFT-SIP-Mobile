import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { loadInitialProject, migrateProject, REACT_AUTOSAVE_KEY, REACT_BACKUPS_KEY } from './project-model.js';

const ProjectContext = createContext(null);
const HISTORY_LIMIT = 60;

function reducer(state, action) {
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return { past: state.past.slice(0, -1), present: state.past.at(-1), future: [state.present, ...state.future] };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: state.future[0], future: state.future.slice(1) };
  }
  if (action.type === 'replace') return { past: [], present: migrateProject(action.project), future: [] };
  if (action.type === 'commit') {
    const next = action.update(structuredClone(state.present));
    return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: next, future: [] };
  }
  return state;
}

export function ProjectProvider({ children }) {
  const [history, dispatch] = useReducer(reducer, null, () => ({ past: [], present: loadInitialProject(), future: [] }));
  const [saveState, setSaveState] = useState({ status: 'saved', message: 'Автосохранение включено' });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const snapshot = { ...history.present, savedAt: new Date().toISOString() };
        localStorage.setItem(REACT_AUTOSAVE_KEY, JSON.stringify(snapshot));
        setSaveState({ status: 'saved', message: `Сохранено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` });
      } catch (error) {
        setSaveState({ status: 'error', message: `Автосохранение недоступно: ${error.message}` });
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [history.present]);

  const commit = useCallback((update) => dispatch({ type: 'commit', update }), []);
  const replace = useCallback((project) => dispatch({ type: 'replace', project }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const checkpoint = useCallback(() => {
    try {
      const existing = JSON.parse(localStorage.getItem(REACT_BACKUPS_KEY) || '[]');
      const snapshot = { ...history.present, backupId: Date.now(), savedAt: new Date().toISOString() };
      localStorage.setItem(REACT_BACKUPS_KEY, JSON.stringify([snapshot, ...existing].slice(0, 10)));
      setSaveState({ status: 'saved', message: 'Создана резервная копия' });
      return snapshot;
    } catch (error) {
      setSaveState({ status: 'error', message: `Не создана копия: ${error.message}` });
      return null;
    }
  }, [history.present]);
  const value = useMemo(() => ({
    project: history.present, commit, replace, undo, redo, checkpoint, saveState,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0
  }), [history, commit, replace, undo, redo, checkpoint, saveState]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject должен использоваться внутри ProjectProvider');
  return context;
}
