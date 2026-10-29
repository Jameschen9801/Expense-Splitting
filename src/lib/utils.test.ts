import assert from 'node:assert/strict';
import test from 'node:test';
import { Group } from '../types';
import { utils } from './utils';
import { withoutUndefined } from './firebaseData';

test('金額顯示省略整數的 .00，保留實際小數與原本的四捨五入', () => {
  assert.equal(utils.fmt(58638), '58,638');
  assert.equal(utils.fmt(0), '0');
  assert.equal(utils.fmt(-24345), '-24,345');
  assert.equal(utils.fmt(82983.97), '82,983.97');
  assert.equal(utils.fmt(1234.5), '1,234.50');
  assert.equal(utils.fmt(0.01), '0.01');
  assert.equal(utils.fmt(-24345.97), '-24,345.97');
  assert.equal(utils.fmt(99.999), '100');
  assert.equal(utils.fmt(1.005), '1.01');
});

test('平均分攤會保留每一分錢', () => {
  const shares = utils.equalShares(100, ['A', 'B', 'C']);
  assert.deepEqual(shares, [
    { name: 'A', amount: 33.34 },
    { name: 'B', amount: 33.33 },
    { name: 'C', amount: 33.33 },
  ]);
  assert.equal(utils.toCents(shares.reduce((sum, share) => sum + share.amount, 0)), 10000);
});

test('百分比分攤會把四捨五入尾差放進最後一筆', () => {
  const shares = utils.percentShares(123.45, [
    { name: 'A', amount: 33.33 },
    { name: 'B', amount: 33.33 },
    { name: 'C', amount: 33.34 },
  ]);
  assert.equal(utils.toCents(shares.reduce((sum, share) => sum + share.amount, 0)), 12345);
});

test('餘額總和為零且能產生完整結算', () => {
  const group: Group = {
    code: '123456',
    name: '測試群組',
    members: ['A', 'B', 'C'],
    expenses: [{
      id: 'expense-1',
      desc: '晚餐',
      amount: 100,
      payer: 'A',
      participants: ['A', 'B', 'C'],
      splitMode: 'equal',
      date: '2026-09-22',
      createdAt: 1,
    }],
    transfers: [],
    createdAt: 1,
  };

  const balances = utils.calcBalances(group);
  assert.equal(utils.toCents(Object.values(balances).reduce((sum, value) => sum + value, 0)), 0);
  assert.deepEqual(utils.calcSettlements(balances), [
    { from: 'B', to: 'A', amount: 33.33 },
    { from: 'C', to: 'A', amount: 33.33 },
  ]);
});

test('Firebase 資料不包含 undefined 欄位', () => {
  const value = withoutUndefined({
    splitMode: 'equal',
    percentages: undefined,
    nested: { note: undefined, amount: 100 },
  });

  assert.deepEqual(value, {
    splitMode: 'equal',
    nested: { amount: 100 },
  });
});
