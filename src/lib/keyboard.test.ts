import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { KeyboardInputBar } from '../components/KeyboardInputBar';
import { inputScrollTop, isInputEnter, modalViewport } from './keyboard';

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
test('鍵盤工具列不建立第二個輸入框，不再取代原表單', () => {
  const markup = renderToStaticMarkup(createElement(KeyboardInputBar, { nextLabel: '說明', onNext() {}, onDone() {} }));
  assert.equal(markup.includes('<input'), false);
  assert.ok(markup.includes('aria-label="下一欄：說明"')); assert.ok(markup.includes('完成輸入'));
  const last = renderToStaticMarkup(createElement(KeyboardInputBar, { onNext() {}, onDone() {} }));
  assert.equal(last.includes('下一欄'), false);
});
test('精簡輸入不隱藏草稿保存失敗等重要錯誤', () => {
  const markup = renderToStaticMarkup(createElement(KeyboardInputBar, { error: '草稿無法保存，請保留此畫面', onNext() {}, onDone() {} }));
  assert.ok(markup.includes('role="alert"')); assert.ok(markup.includes('草稿無法保存'));
});
test('只捲動表單讓真正的欄位與標籤可見，不移動背景頁面', () => {
  assert.equal(inputScrollTop(100, 370, 430, 100, 350), 192);
  assert.equal(inputScrollTop(100, 110, 170, 100, 350), 78);
  assert.equal(inputScrollTop(100, 150, 210, 100, 350), 100);
  assert.equal(inputScrollTop(0, 0, 60, 100, 350), 0);
});
test('中文選字的 Enter 不會跳到另一欄', () => {
  assert.equal(isInputEnter({ key: 'Enter', isComposing: true, keyCode: 13 }), false);
  assert.equal(isInputEnter({ key: 'Enter', isComposing: false, keyCode: 229 }), false);
  assert.equal(isInputEnter({ key: 'Enter', isComposing: false, keyCode: 13 }), true);
  assert.equal(isInputEnter({ key: 'Tab', isComposing: false, keyCode: 9 }), false);
});
test('手機記帳底頁保持實色，不在系統鍵盤工具列的空隙露出明細', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  assert.ok(css.includes('body.warikan-record-editor { background: var(--ui-surface); }'));
  assert.ok(css.includes('body.warikan-record-editor .page-enter { visibility: hidden; }'));
  assert.ok(css.includes('.modal-panel[data-layout="editor"] { height: 100%; max-height: 100%;'));
});
