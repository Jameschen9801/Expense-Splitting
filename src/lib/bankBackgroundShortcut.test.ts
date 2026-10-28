import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bankBackgroundName, richartBackgroundName, bankBackgroundEndpoint, backgroundSetupUrl, bankBackgroundSetupMarker, bankBackgroundInstallUrl, richartBackgroundInstallUrl } from './bankBackgroundProtocol';
const main = JSON.parse(readFileSync(new URL('../../scripts/ios-bank-background.json', import.meta.url), 'utf8'));
const trigger = JSON.parse(readFileSync(new URL('../../scripts/ios-richart-background.json', import.meta.url), 'utf8'));
test('背景捷徑只向自己的固定服務 POST，不含開網頁動作或公開憑證', () => {
  assert.equal(main.WFWorkflowName, bankBackgroundName);
  assert.deepEqual(main.WFWorkflowImportQuestions, []);
  const actions = main.WFWorkflowActions;
  assert.ok(!actions.some((action: any) => /openurl|openin|runworkflow|runjavascript/.test(action.WFWorkflowActionIdentifier)));
  const requests = actions.filter((action: any) => action.WFWorkflowActionIdentifier.endsWith('.downloadurl'));
  assert.equal(requests.length, 2);
  for (const { WFWorkflowActionParameters: params } of requests) {
    assert.equal(params.WFURL, bankBackgroundEndpoint + '/capture');
    assert.equal(params.WFHTTPMethod, 'POST');
    const headers = params.WFHTTPHeaders.Value.WFDictionaryFieldValueItems;
    const credential = headers.find((item: any) => item.WFKey.Value.string === 'X-Expense-Key').WFValue;
    assert.ok(credential.Value.attachmentsByRange['{0, 1}'].OutputUUID);
  }
  assert.doesNotMatch(JSON.stringify(main), /[a-f0-9]{64}|Bearer |supabase|duopurse|bank-entry/);
  for (const link of [bankBackgroundInstallUrl, richartBackgroundInstallUrl]) assert.match(link, /^https:\/\/www\.icloud\.com\/shortcuts\/[a-f0-9]{32}$/);
});
test('App 綁定內容符合原生驗證格式，其他網址或不完整憑證無法套用', () => {
  const setup = new URL(backgroundSetupUrl('a'.repeat(64)));
  assert.equal(setup.protocol, 'shortcuts:'); assert.equal(setup.searchParams.get('name'), bankBackgroundName);
  const config = setup.searchParams.get('text')!.slice(bankBackgroundSetupMarker.length);
  const patterns = main.WFWorkflowActions.filter((action: any) => action.WFWorkflowActionIdentifier.endsWith('.text.match')).map((action: any) => action.WFWorkflowActionParameters.WFMatchTextPattern);
  const guard = new RegExp(patterns.find((pattern: string) => pattern.startsWith('^\\{')));
  assert.ok(guard.test(config));
  assert.ok(!guard.test(config.replace('expense-splitting-a9b78', 'other-project')));
  assert.ok(!guard.test(config.replace('https:', 'http:')));
  assert.throws(() => backgroundSetupUrl('bad'));
  assert.ok(!guard.test(config + '\nextra'));
});
test('所有文字辨識有實際輸入，設定檔存取一致並使用 Apple 會保留的文字副檔名', () => {
  for (const { WFWorkflowActionIdentifier: action, WFWorkflowActionParameters: params } of main.WFWorkflowActions) {
    if (action.endsWith('.text.match')) {
      assert.ok(params.text.Value.attachmentsByRange['{0, 1}'].OutputUUID);
      assert.equal(params.WFInput, undefined);
    }
  }
  const save = main.WFWorkflowActions.find((action: any) => action.WFWorkflowActionIdentifier.endsWith('.documentpicker.save')).WFWorkflowActionParameters;
  const load = main.WFWorkflowActions.find((action: any) => action.WFWorkflowActionIdentifier.endsWith('.documentpicker.open')).WFWorkflowActionParameters;
  assert.equal(save.WFFileDestinationPath, load.WFGetFilePath);
  assert.equal(save.WFFileDestinationPath, 'ExpenseSplitting-bank-background.txt');
  assert.equal(load.WFShowFilePicker, false); assert.equal(save.WFAskWhereToSave, false);
});
test('新版通知來源只選 Richart 並呼叫背景主捷徑，舊範本仍獨立保留', () => {
  assert.equal(trigger.WFWorkflowName, richartBackgroundName);
  assert.deepEqual(trigger.WFWorkflowTriggers[0].WFTriggerSerializedParameters.SelectedApps, [{ BundleIdentifier: 'tw.com.taishinbank.richart', Name: 'Richart', TeamIdentifier: 'GWE2S42W9T' }]);
  const [text, run] = trigger.WFWorkflowActions.map((action: any) => action.WFWorkflowActionParameters);
  assert.equal(text.WFTextActionText.Value.attachmentsByRange['{0, 1}'].Aggrandizements[0].PropertyName, 'Body');
  assert.equal(run.WFWorkflowName, bankBackgroundName); assert.equal(run.WFInput.Value.OutputUUID, text.UUID);
  assert.doesNotMatch(JSON.stringify(trigger), /https?:|"(?:secret|token)"\s*:|cardaily|duopurse/i);
});
