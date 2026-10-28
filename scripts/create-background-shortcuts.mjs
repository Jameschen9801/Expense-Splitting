// Builds generic Apple workflows only. Never put an account key in this script.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const protocol = readFileSync(new URL('../src/lib/bankBackgroundProtocol.ts', import.meta.url), 'utf8');
const endpoint = protocol.match(/export const bankBackgroundEndpoint = '([^']+)'/)?.[1] + '/capture';
if (endpoint !== 'https://expense-bank-background.poetes-wine-catalog.workers.dev/capture') throw new Error('Unexpected background service');
// Shortcuts saves a Text item with .txt even when a .json path is supplied.
// Use the same text filename for Save File and Get File on every device.
const file = 'ExpenseSplitting-bank-background.txt';
const marker = 'expense-bank-background:';
const id = name => { const h = createHash('sha256').update('expense-background-v1:' + name).digest('hex').toUpperCase(); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-A${h.slice(17,20)}-${h.slice(20,32)}`; };
const out = (name, label = '文字') => ({ Value: { OutputUUID: id(name), Type: 'ActionOutput', OutputName: label }, WFSerializationType: 'WFTextTokenAttachment' });
const token = (value, label) => typeof value === 'string' ? { Value: { string: value }, WFSerializationType: 'WFTextTokenString' } : { Value: { string: '\ufffc', attachmentsByRange: { '{0, 1}': value.Value } }, WFSerializationType: 'WFTextTokenString' };
const dictionary = values => ({ Value: { WFDictionaryFieldValueItems: Object.entries(values).map(([key, value]) => ({ WFItemType: 0, WFKey: token(key), WFValue: token(value) })) }, WFSerializationType: 'WFDictionaryFieldValue' });
const actions = [];
const add = (name, action, params = {}) => { actions.push({ WFWorkflowActionIdentifier: 'is.workflow.actions.' + action, WFWorkflowActionParameters: { ...(name ? { UUID: id(name) } : {}), ...params } }); return out(name); };
const text = (name, value) => add(name, 'gettext', { WFTextActionText: typeof value === 'string' ? token(value) : value });
const match = (name, input, pattern) => add(name, 'text.match', { text: token(input), WFMatchTextPattern: pattern, WFMatchTextCaseSensitive: true });
const first = (name, input) => add(name, 'getitemfromlist', { WFInput: input, WFItemSpecifier: 'First Item' });
const start = (name, input) => add('', 'conditional', { GroupingIdentifier: id(name), WFControlFlowMode: 0, WFCondition: 100, WFInput: { Type: 'Variable', Variable: input } });
const otherwise = name => add('', 'conditional', { GroupingIdentifier: id(name), WFControlFlowMode: 1 });
const end = name => add(name + '-end', 'conditional', { GroupingIdentifier: id(name), WFControlFlowMode: 2 });
const notice = message => add('', 'notification', { WFNotificationActionTitle: '背景記帳未完成', WFNotificationActionBody: typeof message === 'string' ? token(message) : token(message), WFNotificationActionSound: true });
const alert = (title, message) => add('', 'alert', { WFAlertActionTitle: title, WFAlertActionMessage: message, WFAlertActionCancelButtonShown: false });
const value = (name, input, key) => add(name, 'getvalueforkey', { WFInput: input, WFDictionaryKey: key, WFGetDictionaryValueType: 'Value' });
const request = (name, key, mode, input) => add(name, 'downloadurl', { WFURL: endpoint, WFHTTPMethod: 'POST', ShowHeaders: true, WFHTTPHeaders: dictionary({ 'X-Expense-Key': key, 'Content-Type': 'application/json' }), WFHTTPBodyType: 'JSON', WFJSONValues: dictionary({ mode, ...(input ? { text: input } : {}) }) });
const strictConfig = '^\\{"version":1,"endpoint":"' + endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '","token":"[a-f0-9]{64}"\\}$';
const keyFrom = (name, input) => first(name + '-first', match(name, input, '(?<="token":")[a-f0-9]{64}(?=")'));

add('', 'comment', { WFCommentActionText: `銀行背景記帳・個人帳本待確認版\n先在 App 設定銀行與卡號末 4 碼，加入本捷徑後按「綁定並測試連線」。設定僅存於 Shortcuts/${file}，請勿分享該檔案。公開範本不含任何銀行、卡號或帳目。\n只將通知以 HTTPS POST 傳到自己的 Cloudflare 免費接收服務，再存回原本 Firebase 帳本，不經瀏覽器，不使用 AI，不付款、不轉帳。成功、重複或不符合規則時安靜結束。接收服務只保存辨識後的待確認資料，不保存原始通知。\n本捷徑不會自行監聽通知。另加入「Richart 背景記帳」並在 iPhone 啟用自動化；同時停用舊版「Richart 通知自動化」，避免舊版仍開 Safari。鎖定時執行仍受 iOS 權限、網路與檔案存取限制，請先在解鎖時完成連線授權。網路中斷不會自動補送，請確認 App 接收結果。` });
const input = text('input', { Value: { string: '\ufffc', attachmentsByRange: { '{0, 1}': { Type: 'ExtensionInput' } } }, WFSerializationType: 'WFTextTokenString' });
const setup = match('setup-json', input, '(?<=^' + marker + ')\\{[\\s\\S]*\\}$');
start('setup', setup);
  const json = first('setup-first', setup);
  const validSetup = match('setup-valid', json, strictConfig);
  start('setup-accepted', validSetup);
    const settings = first('setup-valid-first', validSetup);
    add('save-config', 'documentpicker.save', { WFInput: settings, WFAskWhereToSave: false, WFSaveFileOverwrite: true, WFFileDestinationPath: file });
    const tested = request('test-response', keyFrom('setup-key', settings), 'test');
    const ready = match('test-ready', value('test-status', tested, 'status'), '^ready$');
    start('test-ok', ready);
      alert('背景記帳已綁定', '連線成功，測試未新增帳目。回 App 加入「Richart 背景記帳」並啟用自動化；停用舊版「Richart 通知自動化」。之後有效消費先進待確認，成功不開 Safari。');
    otherwise('test-ok');
      alert('連線測試未完成', '請回 App 查看「最近一次背景接收」與銀行規則，確認後重新綁定。測試不會新增帳目。');
    end('test-ok');
  otherwise('setup-accepted');
    alert('綁定資料不正確', '本捷徑只接受自己的記帳服務。請回 App 按「綁定並測試連線」，不要手動修改檔案或網址。');
  end('setup-accepted');
otherwise('setup');
  const nonEmpty = match('input-nonempty', input, '\\S');
  start('input-present', nonEmpty);
    const loaded = add('load-config', 'documentpicker.open', { WFGetFilePath: file, WFFileErrorIfNotFound: false, WFShowFilePicker: false, WFGetFileService: 'iCloud Drive', WFGetFolderContents: true });
    const loadedText = text('config-text', token(loaded));
    const validConfig = match('config-valid', loadedText, strictConfig);
    start('config-accepted', validConfig);
      const captureSettings = first('config-first', validConfig);
      const response = request('capture-response', keyFrom('capture-key', captureSettings), 'capture', input);
      const status = value('capture-status', response, 'status');
      const success = match('capture-success', status, '^(pending|duplicate|ignored)$');
      start('capture-ok', success);
        add('', 'nothing');
      otherwise('capture-ok');
        const message = value('capture-message', response, 'message');
        notice(message);
      end('capture-ok');
    otherwise('config-accepted');
      notice('尚未綁定背景記帳。請回 App 加入主捷徑，再按「綁定並測試連線」。');
    end('config-accepted');
  otherwise('input-present');
    alert('沒有收到通知文字', '手動執行不會新增帳目。請使用已啟用的「Richart 背景記帳」，並以下次實際通知驗證 App 的接收時間。');
  end('input-present');
end('setup');
const workflow = { WFWorkflowName: '銀行背景記帳', WFWorkflowClientVersion: '5037.111', WFWorkflowMinimumClientVersion: 900, WFWorkflowMinimumClientVersionString: '900', WFWorkflowIcon: { WFWorkflowIconStartColor: 1239869439, WFWorkflowIconGlyphNumber: 61440 }, WFWorkflowTypes: ['WFWorkflowTypeShowInSearch'], WFWorkflowInputContentItemClasses: ['WFStringContentItem'], WFWorkflowOutputContentItemClasses: [], WFWorkflowHasOutputFallback: false, WFWorkflowImportQuestions: [], WFQuickActionSurfaces: [], WFWorkflowActions: actions };
writeFileSync(new URL('ios-bank-background.json', import.meta.url), JSON.stringify(workflow, null, 2) + '\n');
const trigger = JSON.parse(readFileSync(new URL('ios-richart-trigger.json', import.meta.url), 'utf8'));
trigger.WFWorkflowName = 'Richart 背景記帳';
trigger.WFWorkflowTriggers[0].WFTriggerUUID = id('richart-trigger');
for (const action of trigger.WFWorkflowActions) {
  if (action.WFWorkflowActionIdentifier.endsWith('.runworkflow')) {
    action.WFWorkflowActionParameters.WFWorkflow.workflowName = workflow.WFWorkflowName;
    action.WFWorkflowActionParameters.WFWorkflowName = workflow.WFWorkflowName;
  }
}
writeFileSync(new URL('ios-richart-background.json', import.meta.url), JSON.stringify(trigger, null, 2) + '\n');
