import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ExpenseCategory, Group } from '../types';
import { Drafts, DraftWriter, type RecordDraft, type ExpenseForm, type TransferForm } from '../lib/drafts';
import { categories, defaultExpenseCategory } from '../lib/categories';
import { utils } from '../lib/utils';
import { Modal } from './Modal';
import type { KeyboardField } from './KeyboardInputBar';
import { expenseFormForLedger, isPersonalLedger } from '../lib/ledgers';

// Typing stays in this component instead of rerendering balances, filters and the group page.
export function RecordEditor({ group, myName, initial, isSaving, error, clearError, onClose, onExpense, onTransfer, bankReview = false, sharedReview = false, draftOwner = myName, notice, entryDate = utils.todayStr(), reviewProgress }: {
  group: Group; myName: string; initial: RecordDraft; isSaving: boolean; error: string; clearError: () => void;
  onClose: () => void; onExpense: (form: ExpenseForm, keepOpen: boolean) => Promise<boolean>;
  onTransfer: (form: TransferForm) => Promise<boolean>;
  bankReview?: boolean; draftOwner?: string;
  sharedReview?: boolean;
  notice?: ReactNode;
  entryDate?: string;
  reviewProgress?: {current:number;total:number;hasNext:boolean};
}) {
  const personal = isPersonalLedger(group);
  const [expForm, setExpForm] = useState<ExpenseForm>(expenseFormForLedger(group, { ...initial.expense, category: bankReview ? initial.expense.category : initial.expense.category || (initial.expenseId ? 'other' : defaultExpenseCategory) }));
  const [tfForm, setTfForm] = useState(initial.transfer);
  const [recordType, setRecordType] = useState(personal ? 'expense' : initial.recordType);
  const [localError, setLocalError] = useState('');
  const isEditingExpense = !!initial.expenseId;
  const isEditingTransfer = !!initial.transferId;
  const formError = localError || error;
  const setFormError = (value: string) => { setLocalError(value); if (!value) clearError(); };
  const finished = useRef(false);
  const latest = useRef<RecordDraft>(initial);
  latest.current = { recordType, expense: expForm, transfer: tfForm, expenseId: initial.expenseId, transferId: initial.transferId };
  const writer = useRef<DraftWriter | null>(null);
  if (!writer.current) writer.current = new DraftWriter(() => setLocalError('草稿無法保存，請確認裝置儲存空間並保留此畫面'));
  const defaults = (): ExpenseForm => ({
    desc: '', amount: '', date: entryDate, category: defaultExpenseCategory,
    payer: group.members.includes(myName) ? myName : group.members[0] || '',
    participants: [...group.members], splitMode: 'equal', customShares: {},
  });
  const writeDraft = () => {
    if (finished.current) return;
    const draft = latest.current;
    const standard = defaults();
    const changed = draft.expense.payer !== standard.payer || draft.expense.splitMode !== 'equal'
      || draft.expense.category && draft.expense.category !== defaultExpenseCategory || draft.expense.date !== entryDate
      || draft.transfer.date !== entryDate || draft.transfer.from !== standard.payer
      || draft.transfer.to !== (group.members.find(name => name !== standard.payer) || '')
      || draft.expense.participants.join('|') !== group.members.join('|');
    new Drafts(localStorage).save(group.code, draftOwner, draft, !!changed);
  };
  useEffect(() => {
    if (!finished.current) writer.current!.schedule(writeDraft);
  }, [expForm, tfForm, recordType]);
  useEffect(() => {
    const flush = (event?: Event) => {
      if (!writer.current!.flush() && event instanceof CustomEvent) event.detail.failed = true;
    };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('warikan:flush-draft', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('warikan:flush-draft', flush);
      document.removeEventListener('visibilitychange', hidden);
      writer.current!.flush();
    };
  }, []);
  const close = () => { if (!isSaving && writer.current!.flush()) onClose(); };
  const submit = async (keepOpen: boolean) => {
    if (isSaving) return;
    setFormError('');
    finished.current = true;
    writer.current!.cancel();
    const saved = recordType === 'expense' ? await onExpense(expForm, keepOpen) : await onTransfer(tfForm);
    if (!saved) {
      finished.current = false;
      writer.current!.schedule(writeDraft);
    } else if (keepOpen && !bankReview && !sharedReview) {
      finished.current = false;
      setExpForm({ ...defaults(), date: expForm.date });
      const from = defaults().payer;
      setTfForm({ from, to: group.members.find(name => name !== from) || '', amount: '', note: '', date: expForm.date });
    }
  };
  const keyboardFields = useMemo<KeyboardField[]>(() => {
    if (sharedReview) return [{ id: 'expense-description', label: '說明' }];
    if (recordType === 'transfer') return [
      { id: 'transfer-amount', label: '轉帳金額 (NT$)' },
      { id: 'transfer-note', label: '轉帳備註' },
    ];
    return [
      { id: 'expense-amount', label: '金額 (NT$)' },
      { id: 'expense-description', label: '說明' },
      ...(expForm.splitMode === 'equal' ? [] : expForm.participants.map(name => ({
        id: `expense-share-${encodeURIComponent(name)}`,
        label: `${name} ${expForm.splitMode === 'custom' ? '分攤金額 (NT$)' : '分攤比例 (%)'}`,
      }))),
    ];
  }, [recordType, expForm.splitMode, expForm.participants, sharedReview]);
  return (
          <Modal layout="editor" title={sharedReview ? '確認分攤記帳' : bankReview ? '確認手機記帳' : isEditingExpense || isEditingTransfer ? (recordType === 'expense' ? "編輯費用" : "編輯轉帳") : "新增紀錄"} keyboardFields={keyboardFields} keyboardError={formError} onClose={() => close()} footer={
            <div className="record-editor-actions" data-continuing={!!reviewProgress?.hasNext}>
              <button className="btn btn-ghost btn-sm" onClick={() => close()} disabled={isSaving}>{reviewProgress?'返回清單':'取消'}</button>
              {reviewProgress?.hasNext && <button type="button" className="btn btn-ghost btn-sm" onClick={()=>submit(false)} disabled={isSaving}>確認後返回</button>}
              {recordType === 'expense' && !isEditingExpense && !bankReview && !sharedReview && (
                <button className="btn btn-ghost btn-sm" onClick={() => submit(true)} disabled={isSaving}>{isSaving ? '儲存中…' : '儲存並繼續'}</button>
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => submit(!!reviewProgress?.hasNext)}
                disabled={isSaving}
              >
                {isSaving ? '儲存中…' : reviewProgress ? reviewProgress.hasNext ? '確認並下一筆' : '確認並完成' : bankReview || sharedReview ? '確認加入帳本' : '儲存'}
              </button>
            </div>
          }>
            {reviewProgress&&<p className="pending-review-progress" role="status">{bankReview?'銀行通知':'共用分攤'} · 第 {reviewProgress.current}／{reviewProgress.total} 筆</p>}
            {notice}
            {(!personal && !isEditingExpense && !isEditingTransfer) && (
              <div className="flex bg-paper border border-line p-1 rounded-full mb-5 gap-1 shadow-sm">
                <button 
                  className={`flex-1 py-1.5 text-[13px] tracking-wider rounded-full transition-all ${recordType === 'expense' ? 'bg-ink text-paper shadow-sm font-medium' : 'text-ink-3 hover:bg-paper-2'}`}
                  onClick={() => setRecordType('expense')}
                >
                  費用
                </button>
                <button 
                  className={`flex-1 py-1.5 text-[13px] tracking-wider rounded-full transition-all ${recordType === 'transfer' ? 'bg-ink text-paper shadow-sm font-medium' : 'text-ink-3 hover:bg-paper-2'}`}
                  onClick={() => setRecordType('transfer')}
                >
                  轉帳
                </button>
              </div>
            )}

            {recordType === 'expense' ? (
              <>
                <div className="field">
                  <label className="field-label" htmlFor="expense-amount">金額 (NT$)</label>
                  <input
                    id="expense-amount"
                    data-autofocus={bankReview || sharedReview ? undefined : true}
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    value={expForm.amount}
                    onChange={e => { setExpForm({ ...expForm, amount: e.target.value }); setFormError(''); }}
                    placeholder="0"
                    step="0.01"
                    min="0"
                    readOnly={sharedReview}
                    className="expense-amount-input"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="expense-category">分類</label>
                  <select id="expense-category" value={expForm.category || (bankReview ? '' : defaultExpenseCategory)} onChange={event => setExpForm({ ...expForm, category: event.target.value as ExpenseCategory })}>
                    {bankReview && <option value="" disabled>請選擇分類</option>}
                    {categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="expense-description">說明</label>
                  <input id="expense-description" data-autofocus={bankReview || sharedReview ? true : undefined} type="text" value={expForm.desc} onChange={e => { setExpForm({ ...expForm, desc: e.target.value }); setFormError(''); }} placeholder="例：晚餐、計程車" maxLength={bankReview?30:200} enterKeyHint={expForm.splitMode === 'equal' ? 'done' : 'next'} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="expense-date">日期</label>
                  <input id="expense-date" type="date" value={expForm.date} onChange={e => setExpForm({ ...expForm, date: e.target.value })} />
                </div>
                {!personal && <><div className="field">
                  <label className="field-label" htmlFor="expense-payer">誰先付款</label>
                  <select id="expense-payer" value={expForm.payer} onChange={e => setExpForm({ ...expForm, payer: e.target.value })}>
                    {group.members.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="field">
                  <div className="flex items-center justify-between gap-3">
                    <span className="field-label mb-0">誰要分攤</span>
                    <span className="text-xs text-ink-3">已選 {expForm.participants.length}／{group.members.length || 0} 人</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 mt-2" aria-label="快速選擇分攤對象">
                    <button type="button" className="quick-select-button" onClick={() => setExpForm({ ...expForm, participants: [...(group.members || [])] })}>全員</button>
                    <button type="button" className="quick-select-button" onClick={() => setExpForm({ ...expForm, participants: (group.members || []).filter(member => member !== expForm.payer) })}>除付款人</button>
                    <button type="button" className="quick-select-button" onClick={() => setExpForm({ ...expForm, participants: group.members.includes(myName) ? [myName] : [] })}>只有我</button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {group.members.map(m => (
                      <button
                        type="button"
                        key={m}
                        onClick={() => {
                          const updated = expForm.participants.includes(m)
                            ? expForm.participants.filter(p => p !== m)
                            : [...expForm.participants, m];
                          setExpForm({ ...expForm, participants: updated });
                        }}
                        aria-pressed={expForm.participants.includes(m)}
                        className={`member-toggle ${expForm.participants.includes(m) ? 'border-ink bg-ink text-paper' : 'border-line text-ink-2 bg-paper'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">分攤方式</label>
                  <div className="flex border border-line rounded-full overflow-hidden mb-3">
                    {(['equal', 'custom', 'percent'] as const).map(mode => (
                      <button
                        type="button"
                        key={mode}
                        onClick={() => setExpForm({
                          ...expForm,
                          splitMode: mode,
                          customShares: mode === expForm.splitMode ? expForm.customShares : {},
                        })}
                        className={`flex-1 min-h-11 px-1 py-2 text-xs transition-all ${expForm.splitMode === mode ? 'bg-ink text-paper' : 'bg-transparent text-ink-2'}`}
                      >
                        {mode === 'equal' ? '平均分攤' : mode === 'custom' ? '自訂金額' : '自訂比例%'}
                      </button>
                    ))}
                  </div>
                  {expForm.splitMode === 'equal' ? (
                    expForm.participants.length > 0 && expForm.amount && (
                      <div className="text-xs text-ink-3 mt-1">每人約 NT$ {utils.fmt(utils.round2(parseFloat(expForm.amount) / expForm.participants.length))}</div>
                    )
                  ) : (() => {
                    const total = expForm.splitMode === 'custom'
                      ? parseFloat(expForm.amount) || 0
                      : 100;
                    const filledTotal = expForm.participants.reduce(
                      (sum, x) => sum + (parseFloat(expForm.customShares[x]) || 0), 0
                    );
                    const remaining = utils.round2(total - filledTotal);
                    const emptyParticipants = expForm.participants.filter(
                      x => !expForm.customShares[x] || expForm.customShares[x] === ''
                    );
                    const canAutoFill = emptyParticipants.length > 0 && remaining > 0;
                    const unit = expForm.splitMode === 'custom' ? 'NT$' : '%';
                    return (
                      <div className="flex flex-col gap-2.5 mt-2.5">
                        {expForm.participants.map(p => (
                          <div key={p} className="flex items-center gap-2.5">
                            <label htmlFor={`expense-share-${encodeURIComponent(p)}`} className="w-20 text-sm shrink-0">{p}</label>
                            <div className="flex-1">
                              <input
                                id={`expense-share-${encodeURIComponent(p)}`}
                                type="number"
                                inputMode="decimal"
                                value={expForm.customShares[p] || ''}
                                onChange={e => {
                                  setExpForm(f => ({ ...f, customShares: { ...f.customShares, [p]: e.target.value } }));
                                  setFormError('');
                                }}
                                placeholder={expForm.splitMode === 'custom' ? '0.00' : '0'}
                                step="0.01"
                                min="0"
                              />
                            </div>
                            <div className="text-xs text-ink-3 shrink-0 w-8 text-right">{unit}</div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between mt-1 pt-2 border-t border-line">
                          <span className={`text-xs tracking-wider ${Math.abs(remaining) < 0.01 ? 'text-green-600' : remaining < 0 ? 'text-red-500' : 'text-ink-3'}`}>
                            剩餘：{remaining < 0 ? '-' : ''}{unit}{utils.fmt(Math.abs(remaining))}
                          </span>
                          {canAutoFill && (
                            <button
                              type="button"
                              className="min-h-10 text-xs text-ink border border-line px-3 py-1.5 rounded-full hover:bg-paper-2 transition-all"
                              onClick={() => {
                                const newShares = { ...expForm.customShares };
                                if (expForm.splitMode === 'custom') {
                                  utils.equalShares(remaining, emptyParticipants).forEach(share => {
                                    newShares[share.name] = share.amount.toFixed(2);
                                  });
                                } else {
                                  const remainingBasisPoints = Math.round(remaining * 100);
                                  const base = Math.floor(remainingBasisPoints / emptyParticipants.length);
                                  let remainder = remainingBasisPoints - base * emptyParticipants.length;
                                  emptyParticipants.forEach(name => {
                                    const basisPoints = base + (remainder-- > 0 ? 1 : 0);
                                    newShares[name] = (basisPoints / 100).toFixed(2);
                                  });
                                }
                                setExpForm(f => ({ ...f, customShares: newShares }));
                              }}
                            >
                              平均分配剩餘
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                </>}
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="field">
                    <label className="field-label">付款人</label>
                    <select value={tfForm.from} onChange={e => setTfForm({ ...tfForm, from: e.target.value })}>
                      {group.members.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">收款人</label>
                    <select value={tfForm.to} onChange={e => setTfForm({ ...tfForm, to: e.target.value })}>
                      {group.members.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="transfer-amount">金額 (NT$)</label>
                  <input id="transfer-amount" type="number" inputMode="decimal" enterKeyHint="next" value={tfForm.amount} onChange={e => { setTfForm({ ...tfForm, amount: e.target.value }); setFormError(''); }} placeholder="0.00" step="0.01" min="0" />
                </div>
                <div className="field">
                  <label className="field-label">日期</label>
                  <input type="date" value={tfForm.date} onChange={e => setTfForm({ ...tfForm, date: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="transfer-note">備註（選填）</label>
                  <input id="transfer-note" type="text" enterKeyHint="done" value={tfForm.note} onChange={e => { setTfForm({ ...tfForm, note: e.target.value }); setFormError(''); }} placeholder="例：已轉帳至銀行帳戶" maxLength={30} />
                </div>
              </>
            )}

            {formError && <div className="form-error" role="alert">{formError}</div>}
          </Modal>
  );
}

