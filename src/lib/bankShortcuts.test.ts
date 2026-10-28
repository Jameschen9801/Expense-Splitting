import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { bankBridgeKey, bankExpense, bankExpenseId, bankExpenseIdentity, hasBankReceipt, bankRulesKey, bankShortcutName, bankNotificationShortcutName, bankNotificationShortcutInstallUrl, bankShortcutPrefix, bankShortcutSetupUrl, bankSetupMarker, newBankRule, parseBankRequest, parseBankText, readBankRules, rememberBankReceipt, resolveBankRule, saveBankRules, takeBankRequest } from './bankShortcuts';
import { categories, categoryOf, defaultExpenseCategory } from './categories';
import { createBackup } from './backup';
import type { Expense, Group } from '../types';

const input = { bank: '測試銀行', last4: '1234', groupCode: '123456', payer: 'A', participants: ['A'], category: 'food' as const, mode: 'review' as const, limit: 10000 };
const sample = '測試銀行 信用卡末四碼1234 於2026/10/26在「早餐店」消費 NT$1,234.50，餘額NT$9,876。';
const today = '2026-10-26';
const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key,value); }, removeItem: (key: string) => { values.delete(key); }, key: (index: number) => [...values.keys()][index] || null, get length() { return values.size; } };
};

test('分類包含核准的教育學習與理髮，新帳餐飲預設與舊帳未分類相容', () => {
  assert.deepEqual(categories.map(item => item.label), ['餐飲','購物','交通','居住','生活帳單','醫療健康','休閒娛樂','人情社交','保險稅費','旅遊','教育學習','理髮','其他']);
  assert.equal(defaultExpenseCategory, 'food');
  const legacy: Expense = { id:'e1',desc:'住宿',amount:100,payer:'A',participants:['A'],date:today,createdAt:1,splitMode:'equal' };
  assert.equal(categoryOf(legacy), 'other');
  assert.equal(categoryOf({ ...legacy, category: 'stay' }), 'stay');
  assert.equal(categoryOf({ ...legacy, category: 'entertainment' }), 'entertainment');
});

test('辨識明確消費金額，不把餘額、日期和卡號當消費', () => {
  assert.deepEqual(parseBankText(sample, input, today), { amount: 1234.5, desc: '早餐店', date: today, dateInMessage: true });
  assert.equal(parseBankText('測試銀行 卡號****1234 於10/26 交易新臺幣88元', input,today).amount, 88);
  assert.equal(parseBankText('測試銀行 信用卡末四碼１２３４ 於2026年10月26日 消費ＮＴ＄１５０',input,today).amount,150);
  assert.equal(parseBankText('測試銀行 信用卡1234 在咖啡店消費 160 元',input,today).desc,'咖啡店');
  const undated = parseBankText('測試銀行 信用卡1234 消費NT$160',input,today);
  assert.equal(undated.date,today); assert.equal(undated.dateInMessage,false);
});

test('Richart 成功通知的帳單附註不誤擋，仍拒絕真實帳單扣款與失敗通知', () => {
  const notice = '【信用卡消費通知】您的Richart卡(末四碼0123)於10/26-19:04刷卡消費約新臺幣58元，實際消費資訊以帳單為準，如有疑問請洽客服';
  for (const bank of ['Richart', 'richart', '台新', '台新銀行', '臺新銀行']) {
    assert.deepEqual(parseBankText(notice, { bank, last4: '0123' }, '2026-10-27'), { amount: 58, date: '2026-10-26', dateInMessage: true, desc: '銀行刷卡消費' });
  }
  for (const marker of ['帳單扣款', '退款', '交易失敗', 'OTP', '預授權']) {
    assert.throws(() => parseBankText(notice + marker, { bank: '台新', last4: '0123' }, '2026-10-27'));
  }
  assert.throws(() => parseBankText(notice, { bank: '另一銀行', last4: '0123' }, '2026-10-27'));
  assert.throws(() => parseBankText(notice, { bank: '台新', last4: '9999' }, '2026-10-27'));
  assert.throws(() => parseBankText('Richart 信用卡優惠 消費新臺幣359元', { bank: 'Richart', last4: '0123' }, '2026-10-27'));
  assert.throws(() => parseBankText('LINE錢包 付款完成 NT$85 商店名稱：早餐店', { bank: 'Richart', last4: '0123' }, '2026-10-27'));
});

test('跨年收到十二月消費仍記為上一年，通知不同分鐘保留不同防重複識別碼', async () => {
  const rule = newBankRule({ ...input, bank: 'Richart' });
  const text = '您的Richart卡末四碼1234於12/31-23:59刷卡消費約新臺幣58元，實際消費資訊以帳單為準';
  assert.equal(parseBankText(text, rule, '2027-01-01').date, '2026-12-31');
  const first = await bankExpenseId(rule, { channel: rule.channel, text });
  assert.equal(await bankExpenseId(rule, { channel: rule.channel, text }), first);
  assert.notEqual(await bankExpenseId(rule, { channel: rule.channel, text: text.replace('23:59', '23:58') }), first);
});

test('晚間 Richart / Richart Life 通知含換行與帳單附註仍可辨識，規則錯誤顯示原因', () => {
  const text = '【信用卡消費通知】您的Richart卡 (末四碼\n0123)於10/27-23:07刷卡消費約新臺幣74\n元，實際消費資訊以帳單為準，如有疑問\n請洽客服';
  for (const bank of ['台新', 'Richart', 'Richart Life']) {
    assert.deepEqual(parseBankText(text, { bank, last4: '0123' }, '2026-10-28'), { amount: 74, date: '2026-10-27', dateInMessage: true, desc: '銀行刷卡消費' });
  }
  const store = memory(), rule = newBankRule({ ...input, bank: 'Richart Life', last4: '0123' });
  saveBankRules(store, [rule]); bankShortcutSetupUrl(store, 'https://example.com/');
  const request = { channel: store.getItem(bankBridgeKey)!, text, scope: 'browser' as const };
  assert.equal(resolveBankRule(store, request).entry.amount, 74);
  assert.throws(() => resolveBankRule(store, { ...request, text: text.replace('0123', '9999') }), /卡號末碼不符合/);
  assert.throws(() => resolveBankRule(store, { ...request, text: text + '退款' }), /成功消費通知/);
});

test('銀行和卡號都必須符合，其他數字不能代替卡號', () => {
  for (const text of [sample.replace('測試銀行','另一銀行'),sample.replace('1234','4321'), '測試銀行 卡號4321 消費NT$1234', '測試銀行 信用卡12345 消費NT$100', '測試銀行 消費NT$100 電話1234', '測試銀行 信用卡消費授權碼1234 消費NT$100', '測試銀行 卡號不明 消費金額1234元']) {
    assert.throws(() => parseBankText(text,input,today));
  }
});

test('僅接受末四碼並保留開頭的零，舊五碼規則保留供修正但停用',()=>{
  const five={...input,last4:'01234'};
  const notice='測試銀行 信用卡末五碼01234 於2026/10/27 消費 NT$125';
  assert.throws(()=>parseBankText(notice,five));
  assert.throws(()=>newBankRule(five));
  assert.throws(()=>parseBankText(notice,input));
  assert.throws(()=>parseBankText(sample,five));
  assert.throws(()=>newBankRule({...input,last4:'001234'}));
  const four={...input,last4:'0123'};
  assert.equal(newBankRule(four).last4,'0123');
  assert.equal(parseBankText('測試銀行 信用卡末四碼0123 消費 NT$125',four).amount,125);
  assert.throws(()=>parseBankText('測試銀行 信用卡末四碼01234 消費 NT$125',four));
  const store=memory(),rule={...newBankRule(input),last4:'01234'};
  store.setItem(bankRulesKey,JSON.stringify([rule]));
  assert.deepEqual(readBankRules(store),[{...rule,enabled:false}]);
  assert.throws(()=>saveBankRules(store,[rule]));
  saveBankRules(store,[{...rule,enabled:false}]);
});

test('驗證碼、退款、失敗、外幣、預授權和非消費通知全部拒絕', () => {
  for (const marker of ['驗證碼','OTP','一次性密碼','取消','退款','退貨','失敗','未成功','尚未完成','不成功','婉拒','預授權','帳單扣款','轉帳','累計','分期','pending','昨日','USD','US$','JPY','SGD','AUD','日圓','港幣']) {
    assert.throws(() => parseBankText(sample + marker,input,today), marker);
  }
  assert.throws(() => parseBankText('測試銀行 信用卡1234 可用額度NT$100',input,today));
});

test('不接受不完整、負數、科學記號、格式錯誤或多筆金額', () => {
  for (const amount of ['0','-100','−100','1e3','1E3','1,23','1.234','1 234','1_000',"1'000",'1000000001']) {
    assert.throws(() => parseBankText('測試銀行 卡號1234 消費NT$' + amount,input,today),amount);
  }
  for (const text of ['消費2026/10/26', '消費100', '消費NT$100及交易NT$100', '消費通知 NT$100 與 NT$200', '消費通知 於2026/10/26 可用額度NT$5000']) {
    assert.throws(() => parseBankText('測試銀行 卡號1234 ' + text,input,today),text);
  }
});

test('通知日期必須存在於曆法；不把年月誤當商家名稱', () => {
  assert.throws(() => parseBankText(sample.replace('10/26','02/30'),input,today));
  assert.throws(() => parseBankText(sample.replace('10/26','13/01'),input,today));
  const dateOnly = parseBankText('測試銀行 信用卡1234 於2026/10/25 消費NT$200',input,today);
  assert.equal(dateOnly.date,'2026-10-25'); assert.equal(dateOnly.desc,'銀行刷卡消費');
});

test('捷徑文字只放網址片段，先清除再處理；格式錯誤也會清除', () => {
  const rule = newBankRule(input);
  const prefix = bankShortcutPrefix(rule,'https://example.com/Expense-Splitting/?private=query#old');
  const url = new URL(prefix + encodeURIComponent(sample + '&?+#'));
  assert.equal(url.search,'');
  assert.deepEqual(parseBankRequest(url.hash), { channel: rule.channel, text: sample + '&?+#' });
  let replaced = '';
  const result = takeBankRequest(url,{ state: null, replaceState: (_state,_unused,path) => { replaced = String(path); } });
  assert.equal(replaced,'/Expense-Splitting/'); assert.equal(result.request?.text,sample + '&?+#');
  assert.ok(takeBankRequest({ ...url, hash: '#bank-entry?channel=bad&text=x', pathname: '/', search: '' },{ state:null, replaceState: () => {} }).error);
  assert.ok(takeBankRequest(url,{ state:null, replaceState: () => { throw new Error(); } }).error);
  assert.equal(parseBankRequest('#group=123456'),null);
  assert.throws(() => parseBankRequest('#bank-entry?channel=' + rule.channel + '&text=' + 'x'.repeat(6001)));
});

test('未綁定捷徑開啟 App 銀行設定，不把通知當成支出', () => {
  let cleared = '';
  const url = new URL('https://example.com/Expense-Splitting/#bank-entry?channel=NOT_CONFIGURED&text=' + encodeURIComponent(sample));
  const input = takeBankRequest(url, { state:null, replaceState: (_state,_unused,path) => { cleared = String(path); } });
  assert.deepEqual(input, { setup: { needsLink:true } });
  assert.equal(cleared, '/Expense-Splitting/');
  assert.equal(JSON.stringify(input).includes('1,234.50'), false);
});

test('已綁定捷徑手動執行只開設定，通知輸入才進入記帳', () => {
  const rule = newBankRule(input);
  const prefix = bankShortcutPrefix(rule, 'https://example.com/');
  const history = { state:null,replaceState: () => {} };
  assert.deepEqual(takeBankRequest(new URL(prefix), history), { setup: { needsLink:false } });
  const recorded = takeBankRequest(new URL(prefix + encodeURIComponent(sample)), history);
  assert.deepEqual(recorded.request, { channel:rule.channel,text:sample });
  assert.equal(recorded.setup, undefined);
  assert.equal(takeBankRequest(new URL(prefix.replace(rule.channel,'bad')), history).setup, undefined);
  assert.throws(()=>parseBankRequest(new URL(prefix + encodeURIComponent(sample) + '&scope=unknown').hash));
});

test('銀行通知可記入個人帳本，全額屬於自己並拒絕他人分攤', () => {
  const rule = newBankRule({...input,payer:'我',participants:['我']}), entry = parseBankText(sample,input,today);
  const group: Group = {kind:'personal',code:rule.groupCode,name:'日常記帳',createdAt:1,members:['我'],expenses:[],transfers:[]};
  const expense = bankExpense(rule,entry,'e1',group);
  assert.equal(expense.amount,1234.5);
  assert.equal(expense.payer,'我'); assert.deepEqual(expense.participants,['我']);
  assert.throws(() => bankExpense({...rule,participants:['朋友']},entry,'e2',group));
});

test('App 綁定網址只傳入此瀏覽器的連結，不重填或輸出銀行、卡號與帳目', () => {
  const store = memory();
  const setup = new URL(bankShortcutSetupUrl(store,'https://example.com/Expense-Splitting/?private=x#old'));
  assert.equal(setup.protocol,'shortcuts:'); assert.equal(setup.hostname,'run-shortcut');
  assert.equal(setup.searchParams.get('name'),'銀行通知記帳');
  assert.equal(setup.searchParams.get('input'),'text');
  const config = setup.searchParams.get('text')!;
  assert.ok(config.startsWith(bankSetupMarker));
  const prefix = new URL(config.slice(bankSetupMarker.length));
  assert.equal(prefix.search,'');
  assert.equal(prefix.hash, '#bank-entry?channel=' + store.getItem(bankBridgeKey) + '&scope=browser&text=');
  assert.equal(bankShortcutSetupUrl(store,'https://example.com/Expense-Splitting/'),setup.href);
  assert.equal(createBackup(store).entries[bankBridgeKey],undefined);
  assert.throws(() => bankShortcutSetupUrl({...store,getItem:()=>null,setItem:()=>{throw new Error('quota');}},'https://example.com/'));
});

test('同一綁定捷徑由 App 銀行規則選定帳本，修改分類與停用立即生效', () => {
  const store=memory(), first=newBankRule(input), second=newBankRule({...input,bank:'第二銀行',last4:'5678',groupCode:'654321'});
  saveBankRules(store,[first,second]); bankShortcutSetupUrl(store,'https://example.com/');
  const request={channel:store.getItem(bankBridgeKey)!,text:sample,scope:'browser' as const};
  assert.equal(resolveBankRule(store,request).rule.groupCode,'123456');
  assert.equal(resolveBankRule(store,{...request,text:sample.replaceAll('測試銀行','第二銀行').replace('末四碼1234','末四碼5678')}).rule.groupCode,'654321');
  saveBankRules(store,[{...first,category:'travel'},second]);
  assert.equal(resolveBankRule(store,request).rule.category,'travel');
  assert.throws(()=>resolveBankRule(store,{...request,channel:'0'.repeat(64)}),/帳本同步/);
  assert.throws(()=>resolveBankRule(store,{...request,text:sample+'退款'}),/尚未記帳/);
  saveBankRules(store,[{...first,enabled:false},second]);
  assert.throws(()=>resolveBankRule(store,request),/尚未記帳/);
});

test('銀行規則重疊時停止自動入帳，不任意選一本帳本', () => {
  const store=memory(), first=newBankRule(input), overlapping=newBankRule({...input,bank:'銀行',groupCode:'654321'});
  saveBankRules(store,[first,overlapping]);bankShortcutSetupUrl(store,'https://example.com/');
  assert.throws(()=>resolveBankRule(store,{channel:store.getItem(bankBridgeKey)!,text:sample,scope:'browser'}),/多個銀行規則/);
});

test('原生捷徑不要求重填資料，並只儲存及開啟本網站的合法綁定連結', () => {
  const workflow=JSON.parse(readFileSync(new URL('../../scripts/ios-bank-shortcut.json',import.meta.url),'utf8'));
  assert.deepEqual(workflow.WFWorkflowImportQuestions,[]);
  const patterns=workflow.WFWorkflowActions.filter((action:any)=>action.WFWorkflowActionIdentifier==='is.workflow.actions.text.match').map((action:any)=>new RegExp(action.WFWorkflowActionParameters.WFMatchTextPattern));
  assert.equal(patterns.length,2);
  const prefix='https://jameschen9801.github.io/Expense-Splitting/#bank-entry?channel='+'a'.repeat(64)+'&scope=browser&text=';
  assert.equal((bankSetupMarker+prefix).match(patterns[0])?.[0],prefix);
  assert.equal(prefix.match(patterns[1])?.[0],prefix);
  for(const bad of [prefix.replace('jameschen9801.github.io','example.com'),prefix+'&extra=1',prefix.replace('scope=browser','scope=unknown'),prefix.replace('https:','http:'),prefix.replace('a'.repeat(64),'bad')]) {
    assert.equal((bankSetupMarker+bad).match(patterns[0]),null);
    assert.equal(bad.match(patterns[1]),null);
  }
});

test('通知來源範本已帶入 Richart 觸發條件，僅傳內文給既有記帳捷徑', () => {
  const workflow = JSON.parse(readFileSync(new URL('../../scripts/ios-richart-trigger.json', import.meta.url), 'utf8'));
  assert.equal(workflow.WFWorkflowName, bankNotificationShortcutName);
  assert.match(bankNotificationShortcutInstallUrl, /^https:\/\/www\.icloud\.com\/shortcuts\/[a-f0-9]{32}$/);
  assert.deepEqual(workflow.WFWorkflowImportQuestions, []);
  assert.equal(workflow.WFWorkflowTriggers.length, 1);
  const trigger = workflow.WFWorkflowTriggers[0];
  assert.equal(trigger.WFTriggerIdentifier, 'WFNotificationTrigger');
  assert.deepEqual(trigger.WFTriggerSerializedParameters.SelectedApps, [{ BundleIdentifier: 'tw.com.taishinbank.richart', Name: 'Richart', TeamIdentifier: 'GWE2S42W9T' }]);
  assert.deepEqual(workflow.WFWorkflowActions.map((action: any) => action.WFWorkflowActionIdentifier), ['is.workflow.actions.gettext', 'is.workflow.actions.runworkflow']);
  const [text, run] = workflow.WFWorkflowActions.map((action: any) => action.WFWorkflowActionParameters);
  const value = text.WFTextActionText.Value;
  assert.equal(value.string, '\ufffc');
  assert.deepEqual(value.attachmentsByRange['{0, 1}'], { TriggerIdentifier: 'WFNotificationTrigger', Type: 'TriggerOutput', Aggrandizements: [{ Type: 'WFPropertyVariableAggrandizement', PropertyName: 'Body' }] });
  assert.equal(run.WFWorkflowName, bankShortcutName);
  assert.equal(run.WFWorkflow.workflowName, bankShortcutName);
  assert.equal(run.WFInput.Value.OutputUUID, text.UUID);
  assert.doesNotMatch(JSON.stringify(workflow), /https?:|duopurse|supabase|secret|bank-entry|cardaily/i);
});

test('規則只保存在本機，不進入一般帳目備份；儲存失敗不偽裝成功', () => {
  const store = memory(), rule = newBankRule(input);
  saveBankRules(store,[rule]); assert.deepEqual(readBankRules(store),[rule]);
  assert.equal(createBackup(store).entries[bankRulesKey],undefined);
  assert.throws(() => newBankRule({ ...input, last4:'123', participants:[] }));
  assert.throws(() => saveBankRules(store,[rule,rule]));
  assert.throws(() => saveBankRules({ ...store, setItem: () => { throw new Error('quota'); } },[rule]),/quota/);
  store.setItem(bankRulesKey,'bad'); assert.throws(() => readBankRules(store));
});

test('相同通知使用私密 HMAC 去重，換卡規則不碰撞，也不暴露通知內容', async () => {
  const rule = newBankRule(input), request = { channel: rule.channel, text:sample };
  const id = await bankExpenseId(rule,request);
  assert.match(id,/^ebank_[a-f0-9]{64}$/);
  assert.equal(await bankExpenseId(rule,{ ...request, text: sample.replaceAll(' ','  ') }),id);
  assert.notEqual(await bankExpenseId(newBankRule(input),request),id);
  assert.notEqual(await bankExpenseId(rule,{ ...request, text:sample.replace('1,234.50','1,235.50') }),id);
  const store = memory(); saveBankRules(store,[rule]); rememberBankReceipt(store,rule.id,id); rememberBankReceipt(store,rule.id,id);
  assert.deepEqual(readBankRules(store)[0].seen,[id]);
});

test('Richart 與 Richart Life 標題及通知換行共用一筆收據，不混入不同消費', async () => {
  const rule = newBankRule({ ...input, bank: 'Richart', last4: '0123' });
  const notice = '【信用卡消費通知】您的Richart卡(末四碼0123)於10/27-23:07刷卡消費約新臺幣74元，實際消費資訊以帳單為準，如有疑問請洽客服';
  const request = { channel: rule.channel, text: notice };
  const id = await bankExpenseId(rule, request);
  for (const text of ['Richart\n' + notice, 'Richart Life\n' + notice, notice.replace('0123)', '\n0123)\n').replace('74元', '74\n元'), notice.replace('【信用卡消費通知】', '')]) {
    assert.equal(await bankExpenseId(rule, { ...request, text }), id);
  }
  for (const text of [notice.replace('23:07', '23:08'), notice.replace('74元', '75元'), notice.replace('10/27', '10/28')]) {
    assert.notEqual(await bankExpenseId(rule, { ...request, text }), id);
  }
  // Unknown extra content is kept in the fingerprint rather than discarded.
  assert.notEqual(await bankExpenseId(rule, { ...request, text: '其他通知\n' + notice }), id);
  const nonRichart = newBankRule(input);
  assert.equal(await bankExpenseId(nonRichart, { channel: nonRichart.channel, text: sample }), 'ebank_' + createHmac('sha256', Buffer.from(nonRichart.secret, 'hex')).update(sample.normalize('NFKC').replace(/\s+/g, ' ')).digest('hex'));
});

test('新版 Richart 防重複仍辨識舊正式帳目、待確認和忽略紀錄，不更動原資料', async () => {
  const rule = newBankRule({ ...input, bank: '台新', last4: '0123' });
  const notice = '【信用卡消費通知】您的Richart卡(末四碼0123)於10/27-23:07刷卡消費約新臺幣74元，實際消費資訊以帳單為準，如有疑問請洽客服';
  const oldHash = (text: string) => 'ebank_' + createHmac('sha256', Buffer.from(rule.secret, 'hex')).update(text.normalize('NFKC').trim().replace(/\s+/g, ' ')).digest('hex');
  const receipt = await bankExpenseIdentity(rule, { channel: rule.channel, text: 'Richart\n' + notice });
  const empty: Group = { code: input.groupCode, name: '測試帳本', createdAt: 1, members: ['A'], expenses: [], transfers: [] };
  for (const source of ['', 'Richart\n', 'Richart Life\n']) {
    const oldId = oldHash(source + notice);
    assert.notEqual(oldId, receipt.id);
    const expense = { ...bankExpense(rule, parseBankText(notice, rule, today), oldId, empty), desc: '原本已填好的說明' };
    const group = { ...empty, expenses: [expense] };
    const before = JSON.stringify(group);
    assert.equal(hasBankReceipt(group, rule, receipt.equivalentIds), true);
    assert.equal(JSON.stringify(group), before);
    assert.equal(hasBankReceipt({ ...empty, bankReceiptIds: [oldId] }, rule, receipt.equivalentIds), true);
    assert.equal(hasBankReceipt({ ...empty, bankInbox: [{ ...expense, bank: rule.bank, last4: rule.last4 }] }, rule, receipt.equivalentIds), true);
    assert.equal(hasBankReceipt(empty, { ...rule, seen: [oldId] }, receipt.equivalentIds), true);
  }
  assert.equal(hasBankReceipt(empty, rule, receipt.equivalentIds), false);
});

test('銀行支出保留選定的分類、付款與分攤，不保存推播原文', () => {
  const rule = newBankRule({ ...input, category:'health' }), entry = parseBankText(sample,input,today);
  const group: Group = { code:'123456',name:'測試',createdAt:1,members:['A','B'],expenses:[],transfers:[] };
  const expense = bankExpense(rule,entry,'e1',group);
  assert.equal(expense.category,'health'); assert.deepEqual(expense.participants,['A']);
  assert.ok(!JSON.stringify(expense).includes('測試銀行'));
  assert.throws(() => bankExpense({ ...rule, participants:['離開成員'] },entry,'e1',group));
});
