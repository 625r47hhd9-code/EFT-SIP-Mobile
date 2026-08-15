import { memo } from 'react';
import { ChevronDown, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { formatMoney, formatNumber } from '../utils/format.js';
import { isPriceEditorUnlocked } from '../security/price-access.js';

export function Field({ label, hint, children, className = '' }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

export function NumberField({ label, value, onChange, min = 0, max, step = 0.1, suffix, hint, disabled }) {
  return (
    <Field label={label} hint={hint}>
      <div className="input-with-suffix">
        <input type="number" value={Number.isFinite(Number(value)) ? value : 0} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, disabled, hint }) {
  return <Field label={label} hint={hint}><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>;
}

export function Toggle({ label, checked, onChange, hint }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{hint ? <small>{hint}</small> : null}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

export function ScreenHeader({ title, description, actions }) {
  return <header className="screen-header"><div><h1>{title}</h1><p>{description}</p></div>{actions ? <div className="screen-actions">{actions}</div> : null}</header>;
}

export function Panel({ title, description, children, className = '' }) {
  return <section className={`panel ${className}`}><header><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div></header>{children}</section>;
}

export function Stat({ label, value, tone = '' }) {
  return <div className={`stat ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

export const PreviewTable = memo(function PreviewTable({ lines, empty = 'Нет позиций для расчёта' }) {
  if (!lines?.length) return <div className="empty-state">{empty}</div>;
  const total = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Номенклатура</th><th>Вид</th><th>Ед.</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
        <tbody>
          {lines.map((line) => <tr key={line.id}><td>{line.name}</td><td><span className={`kind ${line.kind}`}>{line.kind === 'labor' ? 'Работа' : 'Материал'}</span></td><td>{line.unit}</td><td>{formatNumber(line.qty, line.qty % 1 ? 2 : 0)}</td><td>{formatMoney(line.price)}</td><td>{formatMoney(line.qty * line.price)}</td></tr>)}
        </tbody>
        <tfoot><tr><td colSpan="5">Итого раздела</td><td>{formatMoney(total)}</td></tr></tfoot>
      </table>
    </div>
  );
});

function MobileEstimateList({ lines, grouped, priceUnlocked, onChangeLine, onRemoveLine, onResetLine }) {
  const chunks = [];
  for (const line of lines || []) {
    const group = grouped ? (line.estimateGroup || 'Дополнительные позиции') : null;
    const last = chunks[chunks.length - 1];
    if (!last || last.group !== group) chunks.push({ group, lines: [line] });
    else last.lines.push(line);
  }

  return <div className="mobile-estimate-list no-print">
    {chunks.map((chunk, chunkIndex) => <section className="mobile-estimate-group" key={`${chunk.group || 'all'}-${chunkIndex}`}>
      {grouped ? <div className="mobile-estimate-group-title"><span>{chunk.group}</span><strong>{formatMoney(chunk.lines.reduce((sum, line) => sum + line.qty * line.price, 0))}</strong></div> : null}
      <div className="mobile-estimate-lines">{chunk.lines.map((line) => <details className={`mobile-estimate-line ${line.custom ? 'custom' : line.projectOverride ? 'overridden' : ''}`} key={line.id}>
        <summary>
          <div className="mobile-estimate-main">
            <strong>{line.name}</strong>
            <span>{formatNumber(line.qty, line.qty % 1 ? 2 : 0)} {line.unit} × {formatMoney(line.price)}</span>
          </div>
          <div className="mobile-estimate-amount"><strong>{formatMoney(line.qty * line.price)}</strong><ChevronDown /></div>
        </summary>
        <div className="mobile-estimate-edit">
          <label className="mobile-estimate-wide"><span>Номенклатура</span><input value={line.name} onChange={(event) => onChangeLine(line, { name: event.target.value })} /></label>
          <label><span>Количество</span><input type="number" min="0" step="0.01" value={line.qty} onChange={(event) => onChangeLine(line, { qty: Number(event.target.value) })} /></label>
          <label><span>Ед.</span><input value={line.unit} onChange={(event) => onChangeLine(line, { unit: event.target.value })} /></label>
          <label><span>Цена</span><input type="number" min="0" step="1" disabled={!priceUnlocked} value={line.price} onChange={(event) => onChangeLine(line, { price: Number(event.target.value) })} /></label>
          <label><span>Вид</span><select value={line.kind} onChange={(event) => onChangeLine(line, { kind: event.target.value })}><option value="material">Материал</option><option value="labor">Работа</option></select></label>
          <div className="mobile-estimate-actions">{line.projectOverride ? <button type="button" onClick={() => onResetLine(line)}><RotateCcw />Вернуть</button> : null}<button type="button" className="danger" onClick={() => onRemoveLine(line)}><Trash2 />Удалить</button></div>
        </div>
      </details>)}</div>
    </section>)}
  </div>;
}

export function EditableEstimateTable({ lines, empty = 'Нет позиций для расчёта', onChangeLine, onRemoveLine, onResetLine, onAddLine, onResetSection, hiddenCount = 0, grouped = false }) {
  const total = (lines || []).reduce((sum, line) => sum + line.qty * line.price, 0);
  const changed = hiddenCount > 0 || (lines || []).some((line) => line.custom || line.projectOverride);
  const priceUnlocked = isPriceEditorUnlocked();
  return <div className="estimate-editor">
    <div className="estimate-editor-toolbar no-print">
      <div><strong>Ведомость текущего проекта</strong><span>Правки не изменяют общий прайс-лист · цены {priceUnlocked ? 'разблокированы' : 'защищены паролем'}</span></div>
      <div><button className="button secondary compact-button" onClick={onAddLine}><Plus />Добавить позицию</button>{changed ? <button className="button secondary compact-button" onClick={onResetSection}><RotateCcw />Сбросить правки{hiddenCount ? ` · скрыто ${hiddenCount}` : ''}</button> : null}</div>
    </div>
    {!lines?.length ? <div className="empty-state">{empty}</div> : <>
      <MobileEstimateList lines={lines} grouped={grouped} priceUnlocked={priceUnlocked} onChangeLine={onChangeLine} onRemoveLine={onRemoveLine} onResetLine={onResetLine} />
      <div className="table-wrap desktop-estimate-table">
      <table className="data-table editable-estimate-table">
        <thead><tr><th>Номенклатура</th><th>Вид</th><th>Ед.</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th className="no-print">Действия</th></tr></thead>
        <tbody>{lines.flatMap((line, index) => {
          const group = line.estimateGroup || 'Дополнительные позиции';
          const previousGroup = index ? (lines[index - 1].estimateGroup || 'Дополнительные позиции') : null;
          return [grouped && group !== previousGroup ? <tr className="estimate-group-row" key={`group-${group}`}><th colSpan="7">{group}</th></tr> : null, <tr key={line.id} className={line.custom ? 'custom-estimate-line' : line.projectOverride ? 'overridden-estimate-line' : ''}>
          <td><input className="estimate-cell-input no-print" aria-label={`Наименование: ${line.name}`} value={line.name} onChange={(event) => onChangeLine(line, { name: event.target.value })} /><span className="print-only">{line.name}</span></td>
          <td><select className="estimate-cell-input no-print" aria-label={`Вид: ${line.name}`} value={line.kind} onChange={(event) => onChangeLine(line, { kind: event.target.value })}><option value="material">Материал</option><option value="labor">Работа</option></select><span className={`kind ${line.kind} print-only`}>{line.kind === 'labor' ? 'Работа' : 'Материал'}</span></td>
          <td><input className="estimate-cell-input unit-input no-print" aria-label={`Единица: ${line.name}`} value={line.unit} onChange={(event) => onChangeLine(line, { unit: event.target.value })} /><span className="print-only">{line.unit}</span></td>
          <td><input className="estimate-cell-input number-input no-print" type="number" min="0" step="0.01" aria-label={`Количество: ${line.name}`} value={line.qty} onChange={(event) => onChangeLine(line, { qty: Number(event.target.value) })} /><span className="print-only">{formatNumber(line.qty, line.qty % 1 ? 2 : 0)}</span></td>
          <td><input className="estimate-cell-input number-input no-print" type="number" min="0" step="1" aria-label={`Цена: ${line.name}`} title={priceUnlocked ? 'Цена только для текущего проекта' : 'Разблокируйте цены в разделе «Прайс-лист»'} disabled={!priceUnlocked} value={line.price} onChange={(event) => onChangeLine(line, { price: Number(event.target.value) })} /><span className="print-only">{formatMoney(line.price)}</span></td>
          <td>{formatMoney(line.qty * line.price)}</td>
          <td className="estimate-row-actions no-print">{line.projectOverride ? <button title="Вернуть строку к прайс-листу" onClick={() => onResetLine(line)}><RotateCcw /></button> : null}<button title="Удалить из ведомости" onClick={() => onRemoveLine(line)}><Trash2 /></button></td>
        </tr>];
        })}</tbody>
        <tfoot><tr><td colSpan="5">Итого раздела</td><td>{formatMoney(total)}</td><td className="no-print" /></tr></tfoot>
      </table>
    </div></>}
  </div>;
}
