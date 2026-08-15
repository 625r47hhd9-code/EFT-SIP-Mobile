export const formatNumber = (value, digits = 1) => Number(value || 0).toLocaleString('ru-RU', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits
});

export const formatMoney = (value) => `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ₽`;

export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
