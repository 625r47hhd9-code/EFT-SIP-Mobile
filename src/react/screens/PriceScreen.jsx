import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Download, KeyRound, LockKeyhole, LockOpen, Plus, RotateCcw, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import catalog from '../data/default-catalog.json' with { type: 'json' };
import { Panel, ScreenHeader, Stat } from '../components/ui.jsx';
import { useProject } from '../state/ProjectContext.jsx';
import { migrateProject, REACT_PROJECT_VERSION } from '../state/project-model.js';
import { formatMoney, uid } from '../utils/format.js';
import { isPriceEditorUnlocked, setPriceEditorUnlocked, verifyPricePasscode } from '../security/price-access.js';

function downloadCatalog(project) {
  const blob = new Blob([JSON.stringify({ format: 'eft-price-catalog', appVersion: REACT_PROJECT_VERSION, priceMat: project.priceMat, priceLab: project.priceLab }, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Прайс-лист_ЭФТ.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

export default function PriceScreen() {
  const { project, commit, checkpoint } = useProject();
  const [kind, setKind] = useState('material');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [unlocked, setUnlocked] = useState(isPriceEditorUnlocked);
  const [passcode, setPasscode] = useState('');
  const [notice, setNotice] = useState(() => isPriceEditorUnlocked() ? 'Редактор цен разблокирован' : 'Просмотр доступен, изменение защищено паролем');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase('ru'));
  const fileRef = useRef(null);
  const key = kind === 'material' ? 'priceMat' : 'priceLab';
  const items = project[key];
  const categories = useMemo(() => [...new Set(items.map((item) => item.cat).filter(Boolean))].sort(), [items]);
  const visible = useMemo(() => items.filter((item) => (category === 'all' || item.cat === category) && (!deferredSearch || `${item.id} ${item.name} ${item.cat}`.toLocaleLowerCase('ru').includes(deferredSearch))), [items, category, deferredSearch]);
  const update = (id, field, value) => {
    if (!unlocked) return;
    commit((next) => {
    const row = next[key].find((item) => item.id === id);
    if (row) row[field] = field === 'price' ? Math.max(0, Number(value) || 0) : value;
    return next;
    });
    setNotice('Изменение сохранено автоматически');
  };
  const add = () => {
    if (!unlocked) return;
    commit((next) => {
    next[key].unshift({ id: uid(kind === 'material' ? 'MAT' : 'LAB').toUpperCase(), kind, cat: category === 'all' ? 'Без категории' : category, name: 'Новая позиция', unit: 'шт', price: 0 });
    return next;
    });
    setNotice('Добавлена новая позиция');
  };
  const remove = (id) => {
    if (!unlocked) return;
    commit((next) => { next[key] = next[key].filter((item) => item.id !== id); return next; });
    setNotice('Позиция удалена; действие можно отменить стрелкой сверху');
  };
  const unlock = (event) => {
    event.preventDefault();
    if (!verifyPricePasscode(passcode)) {
      setNotice('Неверный пароль');
      setPasscode('');
      return;
    }
    checkpoint();
    setPriceEditorUnlocked(true);
    setUnlocked(true);
    setPasscode('');
    setNotice('Редактор разблокирован; перед изменениями создана резервная копия');
  };
  const lock = () => {
    setPriceEditorUnlocked(false);
    setUnlocked(false);
    setPasscode('');
    setNotice('Редактор цен заблокирован');
  };
  const importCatalog = async (event) => {
    if (!unlocked) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.priceMat) || !Array.isArray(data.priceLab)) throw new Error('в файле нет таблиц материалов и работ');
      commit((next) => migrateProject({ ...next, appVersion: Number(data.appVersion) || 0, priceMat: data.priceMat, priceLab: data.priceLab }));
      setNotice(`Загружен прайс: ${file.name}`);
    } catch (error) { setNotice(`Ошибка загрузки: ${error.message}`); }
    event.target.value = '';
  };
  const reset = () => {
    if (!unlocked) return;
    if (!window.confirm('Вернуть встроенный прайс-лист? Текущие цены останутся в истории отмены.')) return;
    commit((next) => ({ ...next, priceMat: structuredClone(catalog.priceMat), priceLab: structuredClone(catalog.priceLab) }));
    setNotice('Восстановлен встроенный прайс-лист');
  };
  return <div className="screen price-screen"><ScreenHeader title="Прайс-лист" description="Единый источник цен для всех калькуляторов и итоговой сметы" actions={<><button className="button secondary" disabled={!unlocked} title={!unlocked ? 'Сначала разблокируйте редактор' : ''} onClick={() => fileRef.current?.click()}><Upload />Загрузить</button><button className="button secondary" onClick={() => downloadCatalog(project)}><Download />Скачать</button><button className="button ghost" disabled={!unlocked} title={!unlocked ? 'Сначала разблокируйте редактор' : ''} onClick={reset}><RotateCcw />Исходный</button><input ref={fileRef} className="visually-hidden" type="file" accept=".json" disabled={!unlocked} onChange={importCatalog} /></>} />
    <Panel className={`price-access-panel ${unlocked ? 'unlocked' : 'locked'}`} title={unlocked ? 'Редактор цен разблокирован' : 'Изменение цен защищено'} description={unlocked ? 'Доступ действует до закрытия этой вкладки браузера или до ручной блокировки.' : 'Для изменения цен, импорта, добавления и удаления позиций введите пароль.'}>
      {unlocked ? <div className="price-access-state"><ShieldCheck /><div><strong>Изменения разрешены</strong><span>Перед разблокировкой автоматически создана резервная копия проекта.</span></div><button className="button secondary" onClick={lock}><LockKeyhole />Заблокировать</button></div> : <form className="price-unlock-form" onSubmit={unlock}><LockKeyhole /><label><span>Пароль редактора</span><div><KeyRound /><input type="password" inputMode="numeric" autoComplete="current-password" value={passcode} onChange={(event) => setPasscode(event.target.value)} placeholder="Введите пароль" aria-label="Пароль редактора цен" /></div></label><button className="button primary" type="submit"><LockOpen />Разблокировать</button></form>}
    </Panel>
    <div className="stats-row"><Stat label="Материалы" value={`${project.priceMat.length} позиций`} /><Stat label="Работы" value={`${project.priceLab.length} позиций`} /><Stat label="Показано" value={`${visible.length} позиций`} /><Stat label="Доступ" value={unlocked ? 'Разблокирован' : 'Только просмотр'} tone={unlocked ? 'accent' : ''} /><Stat label="Статус" value={notice} /></div>
    <Panel title="Как не потерять прайс" description="Цены входят в проект, но для надёжности используйте несколько уровней сохранения."><div className="price-save-guide"><article><strong>1. Автосохранение</strong><span>После изменения цена автоматически записывается в этом браузере.</span></article><article><strong>2. Дискета сверху</strong><span>Создаёт резервную копию и скачивает полный проект вместе с прайсом.</span></article><article><strong>3. Кнопка «Скачать»</strong><span>Сохраняет отдельный файл прайса. Это главная внешняя копия цен.</span></article><article><strong>4. Новый и старый проект</strong><span>Новый проект наследует текущие цены. Открытый старый проект восстановит прайс, сохранённый внутри него.</span></article></div></Panel>
    <Panel title="Редактор цен" description="Изменение цены сразу пересчитывает верхние итоги и смету"><div className="price-toolbar"><div className="segmented"><button className={kind === 'material' ? 'active' : ''} onClick={() => { setKind('material'); setCategory('all'); }}>Материалы</button><button className={kind === 'labor' ? 'active' : ''} onClick={() => { setKind('labor'); setCategory('all'); }}>Работы</button></div><label className="search-box"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти позицию…" /></label><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Все категории</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><button className="button primary" disabled={!unlocked} title={!unlocked ? 'Сначала разблокируйте редактор' : ''} onClick={add}><Plus />Добавить</button></div>
      <div className="table-wrap price-table-wrap"><table className="data-table editable-table"><thead><tr><th>Код</th><th>Категория</th><th>Номенклатура</th><th>Ед.</th><th>Цена</th><th /></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td><input disabled={!unlocked} value={item.id} onChange={(event) => update(item.id, 'id', event.target.value)} /></td><td><input disabled={!unlocked} value={item.cat} onChange={(event) => update(item.id, 'cat', event.target.value)} /></td><td><input disabled={!unlocked} value={item.name} onChange={(event) => update(item.id, 'name', event.target.value)} /></td><td><input disabled={!unlocked} value={item.unit} onChange={(event) => update(item.id, 'unit', event.target.value)} /></td><td><input className="price-input" type="number" min="0" disabled={!unlocked} value={item.price} onChange={(event) => update(item.id, 'price', event.target.value)} /><small>{formatMoney(item.price)}</small></td><td><button className="icon-button danger" disabled={!unlocked} onClick={() => remove(item.id)} aria-label={`Удалить ${item.name}`}><Trash2 /></button></td></tr>)}</tbody></table></div>
    </Panel>
  </div>;
}
