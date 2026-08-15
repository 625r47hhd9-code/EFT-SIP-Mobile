export const PROJECT_FORMAT = 'eft-project';
export const PRICE_FORMAT = 'eft-price-catalog';
export const PROJECT_SCHEMA_VERSION = 2;
export const PRICE_SCHEMA_VERSION = 1;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateProject(data) {
  if (!isObject(data)) throw new Error('Файл проекта повреждён или пуст');
  if (data.format && data.format !== PROJECT_FORMAT) {
    throw new Error('Выбран файл другого типа');
  }
  if (!data.plan && !Array.isArray(data.estimate) && !Array.isArray(data.params)) {
    throw new Error('В файле нет данных проекта ЭФТ');
  }
  if (data.plan && (!isObject(data.plan.house) || !Array.isArray(data.plan.rooms))) {
    throw new Error('План дома имеет неверную структуру');
  }
  if (data.priceMat && !Array.isArray(data.priceMat)) throw new Error('Список материалов повреждён');
  if (data.priceLab && !Array.isArray(data.priceLab)) throw new Error('Список работ повреждён');
  return data;
}

export function createProjectPayload(snapshot, extras = {}) {
  const payload = {
    ...snapshot,
    ...extras,
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: 45,
    savedAt: new Date().toISOString()
  };
  return validateProject(payload);
}

export function validatePriceCatalog(data) {
  if (!isObject(data)) throw new Error('Файл прайс-листа повреждён или пуст');
  if (data.format && data.format !== PRICE_FORMAT) throw new Error('Это не прайс-лист ЭФТ');
  if (!Array.isArray(data.priceMat) || !Array.isArray(data.priceLab)) {
    throw new Error('В файле должны быть материалы и работы');
  }
  return data;
}

export function createPriceCatalogPayload({ priceMat, priceLab, priceMode = 'custom' }) {
  return validatePriceCatalog({
    format: PRICE_FORMAT,
    schemaVersion: PRICE_SCHEMA_VERSION,
    appVersion: 45,
    savedAt: new Date().toISOString(),
    priceMode,
    priceMat,
    priceLab
  });
}

export function safeFilePart(value, fallback = 'без_имени') {
  const result = String(value || '').trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_').replace(/\s+/g, '_');
  return result || fallback;
}
