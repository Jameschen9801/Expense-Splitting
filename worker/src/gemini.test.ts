import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSuggestion } from './gemini';
import { merchantHabits, readMerchantHabits, suggestionMerchant } from '../../src/lib/merchantSuggestions';
import type { Expense, ExpenseCategory } from '../../src/types';

const expense = (category: ExpenseCategory, desc: string, merchant?: string): Expense => ({
  id: 'local-only', category, desc, merchant, date: '2026-11-01', createdAt: 1, amount: 141,
  payer: '測試使用者', participants: ['測試使用者'], splitMode: 'equal',
});

test('分類摘要從同店家已確認的備註或店名產生，只保留分類次數', () => {
  const history = [
    expense('household', '全聯 日用品'),
    expense('household', '測試商品甲', 'ＰＸ Mart 分店'),
    expense('shopping', '海鮮', '全聯分店'),
    expense('food', '測試商品乙', '其他商家'),
    expense('electronics', '測試商品丙', '全聯'),
  ];
  history[4].sharedSource = { groupCode: '123456', groupName: '共用', expenseId: 'pending', memberName: '測試使用者', totalAmount: 141, payer: '測試使用者' };
  assert.deepEqual(merchantHabits('全聯福利中心', history), [{ category: 'household', count: 2 }, { category: 'shopping', count: 1 }]);
  assert.deepEqual(merchantHabits('沒去過的店', history), []);
  assert.equal(readMerchantHabits([{ category: 'food', count: 13 }]), null);
  assert.equal(readMerchantHabits([{ category: 'food', count: 1, desc: '私人說明' }]), null);
  assert.equal(suggestionMerchant('交易卡號 1111-2222-3333-4444'), '');
});

const response = (text: string, finishReason = 'STOP') => Response.json({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
test('只將店名和分類次數送至 Gemini，清楚的個人分類偏好可優先套用', async () => {
  const habits = merchantHabits('全聯', [expense('household', '私人說明 A', '全聯'), expense('household', '私人說明 B', '全聯')]);
  const suggestion = await generateSuggestion('fixture-key', '全聯', habits, async (url, request) => {
    assert.equal(new URL(String(url)).hostname, 'generativelanguage.googleapis.com');
    assert.ok(!String(url).includes('fixture-key'));
    assert.equal(request?.redirect, 'manual');
    const body = JSON.parse(String(request?.body));
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).habits, [{ category: 'household', count: 2 }]);
    assert.doesNotMatch(String(request?.body), /私人說明|測試使用者|2026-11-01|local-only/u);
    return response('{"category":"shopping","desc":"全聯"}');
  });
  assert.deepEqual(suggestion, { category: 'household', desc: '全聯' });
});

test('模型分類、內容與失敗均以可人工接手的方式處理', async () => {
  assert.deepEqual(await generateSuggestion('fixture-key', '陌生店家', [], async () => response('{"category":null,"desc":""}')),
    { category: null, desc: '' });
  const suggested = () => response('{"category":"travel","desc":"測試店家"}', 'MAX_TOKENS');
  for (const mock of [
    suggested,
    () => response('{"category":"income","desc":"測試"}'),
    () => new Response(null, { status: 429 }),
    () => Response.redirect('https://example.test/', 307),
  ]) {
    await assert.rejects(generateSuggestion('fixture-key', '陌生店家', [], async () => mock()), /可繼續手動確認/u);
  }
});
