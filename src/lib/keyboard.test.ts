import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyboardInputBar } from '../components/KeyboardInputBar';
import { modalViewport } from './keyboard';

test('鍵盤開啟時輸入面板留在可見區域，遮罩仍可覆蓋原頁面', () => {
  assert.deepEqual(modalViewport(844, { height: 450, offsetTop: 0, scale: 1 }), { height: 450, top: 0, keyboardOpen: true });
  assert.deepEqual(modalViewport(844, { height: 430, offsetTop: 54, scale: 1 }), { height: 430, top: 54, keyboardOpen: true });
  assert.deepEqual(modalViewport(844, { height: 844, offsetTop: 54, scale: 1 }), { height: 790, top: 54, keyboardOpen: false });
});
test('網址列變動與縮放不誤判為鍵盤，沒有 VisualViewport 仍可開啟', () => {
  assert.equal(modalViewport(844, { height: 764, offsetTop: 0, scale: 1 }).keyboardOpen, false);
  assert.equal(modalViewport(844, { height: 422, offsetTop: 40, scale: 2 }).keyboardOpen, false);
  assert.deepEqual(modalViewport(430), { height: 430, top: 0, keyboardOpen: false });
});
test('精簡輸入保留金額、中文說明與欄位切換，頁面上只有一個輸入框', () => {
  const render = (index: number, type: 'text' | 'number') => renderToStaticMarkup(createElement(KeyboardInputBar, {
    field: { id: type, label: type === 'number' ? '金額 (NT$)' : '說明', type, inputMode: type === 'number' ? 'decimal' : 'text', value: type === 'number' ? '137.25' : '午餐', onChange() {} },
    index, total: 2, onMove() {}, onDone() {},
  }));
  const amount = render(0, 'number');
  assert.equal((amount.match(/<input/g) || []).length, 1);
  assert.ok(amount.includes('inputMode="decimal"')); assert.ok(amount.includes('value="137.25"'));
  assert.ok(amount.includes('aria-label="上一欄" disabled=""')); assert.ok(amount.includes('完成'));
  const description = render(1, 'text');
  assert.ok(description.includes('value="午餐"')); assert.ok(description.includes('enterKeyHint="done"'));
  assert.ok(description.includes('aria-label="下一欄" disabled=""'));
});
test('精簡輸入不隱藏草稿保存失敗等重要錯誤', () => {
  const markup = renderToStaticMarkup(createElement(KeyboardInputBar, {
    field: { id: 'amount', label: '金額 (NT$)', value: '137.25', type: 'number', onChange() {} },
    index: 0, total: 2, error: '草稿無法保存，請保留此畫面', onMove() {}, onDone() {},
  }));
  assert.ok(markup.includes('role="alert"')); assert.ok(markup.includes('草稿無法保存'));
  assert.ok(markup.includes('aria-describedby="keyboard-field-step keyboard-input-error"'));
});
