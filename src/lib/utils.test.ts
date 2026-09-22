import assert from 'node:assert/strict';
import test from 'node:test';
import { Group } from '../types';
import { utils } from './utils';

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
