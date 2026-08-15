import { strToU8, zipSync } from 'fflate';

const escapeXml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const columnName = (index) => {
  let value = index + 1;
  let result = '';
  while (value) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

const cell = (value, row, column) => {
  const ref = `${columnName(column)}${row}`;
  return typeof value === 'number' && Number.isFinite(value)
    ? `<c r="${ref}"><v>${value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
};

function worksheet(rows, widths = []) {
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cell(value, rowIndex + 1, columnIndex)).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
}

export function createEstimateWorkbook(project, calculation) {
  const estimateRows = [
    ['ЭФТ — смета проекта'],
    ['Номер проекта', project.meta.projectNum], ['Заказчик', project.meta.customer], ['Адрес', project.meta.address], ['Дата', project.meta.date],
    ['Габариты дома, м', `${project.plan.house.w} × ${project.plan.house.h}`],
    ['Пол всего дома, м²', calculation.metrics.floorArea], ['Площадь помещений, м²', calculation.metrics.roomArea],
    ['Горизонтальный СИП-потолок, м²', calculation.metrics.ceilingArea], ['Второй свет, м²', calculation.metrics.openCeilingArea],
    [], ['Раздел', 'Группа', 'Номенклатура', 'Вид', 'Ед.', 'Количество', 'Цена, ₽', 'Сумма, ₽']
  ];
  calculation.sections.forEach((section) => section.lines.forEach((line) => estimateRows.push([
    section.title, line.estimateGroup || '', line.name, line.kind === 'labor' ? 'Работа' : 'Материал', line.unit, line.qty, line.price, line.qty * line.price
  ])));
  estimateRows.push([], ['ИТОГО МАТЕРИАЛЫ', calculation.totals.materials], ['ИТОГО РАБОТЫ', calculation.totals.labor], ['ИТОГО ПО СМЕТЕ', calculation.totals.total]);
  const catalogRows = (items) => [['Код', 'Категория', 'Наименование', 'Ед.', 'Цена, ₽'], ...items.map((item) => [item.id, item.cat, item.name, item.unit, item.price])];
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Смета" sheetId="1" r:id="rId1"/><sheet name="Материалы" sheetId="2" r:id="rId2"/><sheet name="Работы" sheetId="3" r:id="rId3"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(worksheet(estimateRows, [24, 20, 46, 14, 12, 14, 16, 18])),
    'xl/worksheets/sheet2.xml': strToU8(worksheet(catalogRows(project.priceMat), [14, 30, 62, 14, 16])),
    'xl/worksheets/sheet3.xml': strToU8(worksheet(catalogRows(project.priceLab), [14, 30, 62, 14, 16]))
  };
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadEstimateWorkbook(project, calculation) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(createEstimateWorkbook(project, calculation));
  link.download = `Смета_ЭФТ_${project.meta.projectNum || 'без_номера'}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
