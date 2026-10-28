import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecordsList, type RecordItem } from '../components/RecordsList';
import { recordDateLabel } from './ui';
import { parseAppearance, resolveAppearance } from './appearance';

test('外觀預設跟隨系統，使用者可固定淺色或深色，錯誤偏好不破壞畫面', () => {
  assert.equal(parseAppearance(null), 'system'); assert.equal(parseAppearance('invalid'), 'system');
  assert.equal(resolveAppearance(parseAppearance(null), true), 'dark');
  assert.equal(resolveAppearance('light', true), 'light'); assert.equal(resolveAppearance('dark', false), 'dark');
});
test('日期標籤保留跨年度資訊，今天與昨天正確處理跨月與閏年', () => {
  assert.equal(recordDateLabel('2026-10-12', '2026-10-12'), '今天 · 10 月 12 日');
  assert.equal(recordDateLabel('2026-09-30', '2026-10-01'), '昨天 · 9 月 30 日');
  assert.equal(recordDateLabel('2024-02-29', '2024-03-01'), '昨天 · 2 月 29 日');
  assert.equal(recordDateLabel('2025-12-30', '2026-01-01'), '2025 年 12 月 30 日');
  assert.equal(recordDateLabel('', '2026-10-12'), '未設定日期');
});

const expense: RecordItem = { id: 'e1', type: 'expense', desc: '午餐', amount: 100.01, category: 'food', payer: '沛庭', participants: ['沛庭','子晴'], splitMode: 'equal', date: '2026-10-12', createdAt: 1 };
function render(records: RecordItem[], myName = '沛庭', filtered = false) {
  return renderToStaticMarkup(createElement(RecordsList, { groups: records.length ? { '2026-10-12': records } : {}, myName, filtered, resetKey: 'test', onClear() {}, onExpense() {}, onTransfer() {} }));
}
test('共用明細右側只顯示自己的正數分攤，未分攤及零元均留空', () => {
  const included = render([expense]); assert.ok(included.includes('先付 NT$100.01')); assert.ok(included.includes('你的分攤')); assert.ok(included.includes('50.01'));
  assert.ok(included.includes('record-own-expense'));
  const other = render([expense], '昕宇'); assert.equal(other.includes('record-amount'), false); assert.ok(other.includes('你不需負擔'));
  const zero = render([{ ...expense, splitMode: 'custom', shares: [{ name: '沛庭', amount: 0 }, { name: '子晴', amount: 100.01 }] }]);
  assert.equal(zero.includes('record-amount'), false); assert.ok(zero.includes('先付 NT$100.01'));
});
test('空白與搜尋無結果有明確提示，長清單分批呈現', () => {
  assert.ok(render([]).includes('尚無任何記錄'));
  assert.ok(render([], '沛庭', true).includes('清除搜尋與篩選'));
  const long = render(Array.from({ length: 60 }, (_, index) => ({ ...expense, id: 'e' + index })));
  assert.equal((long.match(/class="record-row"/g) || []).length, 50); assert.ok(long.includes('還有 10 筆'));
});

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const palette = (dark: boolean) => Object.fromEntries([...css.match(dark ? /:root\[data-theme="dark"\]\s*\{([^}]+)\}/ : /:root\s*\{([^}]+)\}/)![1].matchAll(/(--ui-[\w-]+):\s*(#[\da-f]{6});/g)].map(match => [match[1], match[2]]));
const luminance = (color: string) => {
  const rgb = [1,3,5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
for (const dark of [false, true]) test(`${dark ? '深' : '淺'}色外觀的文字、按鈕與表單邊界符合對比檢查`, () => {
  const colors = palette(dark);
  for (const text of ['text','secondary','subtle']) for (const surface of ['canvas','surface','muted','inset','accent-soft']) {
    assert.ok(contrast(colors['--ui-' + text], colors['--ui-' + surface]) >= 4.5, `${text}/${surface} contrast is too low`);
  }
  assert.ok(contrast(colors['--ui-accent'], colors['--ui-on-accent']) >= 4.5);
  assert.ok(contrast(colors['--ui-control'], colors['--ui-surface']) >= 3);
  for (const state of ['danger','positive','warning']) assert.ok(contrast(colors['--ui-' + state], colors['--ui-' + state + '-soft']) >= 4.5);
});
