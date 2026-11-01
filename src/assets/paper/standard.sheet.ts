import { defineSheet } from '@/core/asset/sheetTypes';

export default defineSheet({
  id: 'sheet.standard',
  name: 'Standard Sheet',
  description: 'The 10 m sheet a crew starts with. Red face, washi reverse.',
  size: 10,
  cells: 20,
  top: 'vermilion',
  bottom: 'washi',
  edge: 'washi',
  thickness: 0.03,
  density: 0.4,
  floppiness: 1,
});
