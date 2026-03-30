import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# 1. State changes
code = code.replace(
    "const [activeTab, setActiveTab] = useState<'expenses' | 'transfers' | 'balance' | 'members'>('expenses');",
    "const [activeTab, setActiveTab] = useState<'records' | 'balance' | 'members'>('records');\n  const [recordType, setRecordType] = useState<'expense' | 'transfer'>('expense');"
)

code = code.replace(
"""  const [modals, setModals] = useState({
    createGroup: false,
    joinGroup: false,
    addExpense: false,
    addTransfer: false,""",
"""  const [modals, setModals] = useState({
    createGroup: false,
    joinGroup: false,
    addRecord: false,"""
)


# 2. toggleModal changes
toggle_modal_old = """    if (key === 'addExpense' && open && currentGroup) {
      if (!isEditingExpense) {
        setExpForm({
          desc: '',
          amount: '',
          date: utils.todayStr(),
          payer: currentGroup.members.includes(myName) ? myName : (currentGroup.members[0] || ''),
          participants: [...currentGroup.members],
          splitMode: 'equal',
          customShares: {}
        });
      }
    }
    if (!open && key === 'addExpense') {
      setIsEditingExpense(false);
    }
    if (key === 'addTransfer' && open && currentGroup) {
      if (!isEditingTransfer) {
        const defaultFrom = currentGroup.members.includes(myName) ? myName : (currentGroup.members[0] || '');
        const defaultTo = currentGroup.members.find(m => m !== defaultFrom) || '';
        
        setTfForm({
          from: defaultFrom,
          to: defaultTo,
          amount: '',
          date: utils.todayStr(),
          note: ''
        });
      }
    }
    if (!open && key === 'addTransfer') {
      setIsEditingTransfer(false);
    }"""
toggle_modal_new = """    if (key === 'addRecord' && open && currentGroup) {
      if (!isEditingExpense) {
        setExpForm({
          desc: '', amount: '', date: utils.todayStr(),
          payer: currentGroup.members.includes(myName) ? myName : (currentGroup.members[0] || ''),
          participants: [...currentGroup.members], splitMode: 'equal', customShares: {}
        });
      }
      if (!isEditingTransfer) {
        const defaultFrom = currentGroup.members.includes(myName) ? myName : (currentGroup.members[0] || '');
        const defaultTo = currentGroup.members.find(m => m !== defaultFrom) || '';
        setTfForm({ from: defaultFrom, to: defaultTo, amount: '', date: utils.todayStr(), note: '' });
      }
      if (!isEditingExpense && !isEditingTransfer) {
        setRecordType('expense');
      }
    }
    if (!open && key === 'addRecord') {
      setIsEditingExpense(false);
      setIsEditingTransfer(false);
    }"""
code = code.replace(toggle_modal_old, toggle_modal_new)

# 3. Open Edit methods
code = code.replace(
    "setModals(prev => ({ ...prev, expenseDetail: false, addExpense: true }));",
    "setModals(prev => ({ ...prev, expenseDetail: false, addRecord: true }));\n    setRecordType('expense');"
)
code = code.replace(
    "setModals(prev => ({ ...prev, transferDetail: false, addTransfer: true }));",
    "setModals(prev => ({ ...prev, transferDetail: false, addRecord: true }));\n    setRecordType('transfer');"
)
code = re.sub(r"setCurrentPage\('group'\);\s*setActiveTab\('expenses'\);", "setCurrentPage('group');\n    setActiveTab('records');", code)
code = code.replace(
    "toggleModal('addExpense', false);",
    "toggleModal('addRecord', false);"
)
code = code.replace(
    "toggleModal('addTransfer', false);",
    "toggleModal('addRecord', false);"
)


# 4. Grouped Records
grouped_expenses_old = """  const groupedExpenses = useMemo<Record<string, Expense[]>>(() => {
    if (!currentGroup) return {};
    const sorted = [...currentGroup.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const groups: Record<string, Expense[]> = {};
    sorted.forEach(e => {
      const key = e.date || '未設定日期';
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return groups;
  }, [currentGroup, myName]);"""
grouped_records_new = """  type RecordItem = (Expense & { type: 'expense' }) | (Transfer & { type: 'transfer' });

  const groupedRecords = useMemo<Record<string, RecordItem[]>>(() => {
    if (!currentGroup) return {};
    const expenses: RecordItem[] = currentGroup.expenses.map(e => ({ ...e, type: 'expense' }));
    const transfers: RecordItem[] = currentGroup.transfers.map(t => ({ ...t, type: 'transfer' }));
    const combined = [...expenses, ...transfers].sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return b.createdAt - a.createdAt;
    });
    const groups: Record<string, RecordItem[]> = {};
    combined.forEach(item => {
      const key = item.date || '未設定日期';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [currentGroup, myName]);"""
code = code.replace(grouped_expenses_old, grouped_records_new)


# 5. UI Tabs changes
code = code.replace(
"""{(['expenses', 'transfers', 'balance', 'members'] as const).map(tab => (""",
"""{(['records', 'balance', 'members'] as const).map(tab => ("""
)
code = code.replace(
"""{tab === 'expenses' ? '支出' : tab === 'transfers' ? '轉帳' : tab === 'balance' ? '結算' : '成員'}""",
"""{tab === 'records' ? '明細' : tab === 'balance' ? '結算' : '成員'}"""
)

# 6. Tab content replace
# Extract from " {activeTab === 'expenses' " up to activeTab === 'balance'
start_idx = code.find("{activeTab === 'expenses' && (")
end_idx = code.find("{activeTab === 'balance' && (")
if start_idx != -1 and end_idx != -1:
    unified_tab_ui = """              {activeTab === 'records' && (
                <div className="panel">
                  <div className="panel-header p-4 border-b border-line flex items-center justify-between">
                    <span className="section-label">明細記錄</span>
                    <button className="btn btn-sm btn-primary" onClick={() => toggleModal('addRecord', true)}>＋ 新增</button>
                  </div>
                  <div className="px-4.5">
                    {Object.keys(groupedRecords).length === 0 ? (
                      <div className="text-center py-10 text-ink-3 text-xs tracking-wider">尚無任何記錄</div>
                    ) : (
                      Object.entries(groupedRecords).map(([date, items]) => (
                        <div key={date}>
                          <div className="flex justify-between items-center py-2.5 border-b border-line mt-1.5 uppercase text-[11px] tracking-[2px] text-ink-3">
                            <span>{date === '未設定日期' ? date : utils.fmtDate(date)}</span>
                          </div>
                          {items.map(item => {
                            if (item.type === 'expense') {
                              const e = item as Expense;
                              let myCost = 0;
                              if (e.participants.includes(myName)) {
                                if (e.splitMode === 'equal') {
                                  myCost = e.amount / e.participants.length;
                                } else if (e.shares) {
                                  myCost = e.shares.find(s => s.name === myName)?.amount || 0;
                                }
                              }
                              return (
                                <div
                                  key={e.id}
                                  onClick={() => { setSelectedExpense(e); toggleModal('expenseDetail', true); }}
                                  className="py-3 border-b border-line last:border-b-0 flex items-center justify-between gap-3 cursor-pointer hover:bg-paper-2 -mx-4.5 px-4.5"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[16px] tracking-wide font-medium text-ink truncate">{e.desc}</div>
                                    <div className="text-[12px] text-ink-3 tracking-tight mt-0.5 truncate">{e.payer} 先付 NT${utils.fmt(e.amount)}</div>
                                  </div>
                                  {myCost > 0 && (
                                    <div className="text-right shrink-0">
                                      <div className="text-[20px] font-medium tracking-[0.5px] text-[#f87171]">NT${utils.fmt(myCost)}</div>
                                    </div>
                                  )}
                                </div>
                              );
                            } else {
                              const t = item as Transfer;
                              return (
                                <div key={t.id} onClick={() => { setSelectedTransfer(t); toggleModal('transferDetail', true); }} className="py-3 border-b border-line last:border-b-0 flex items-center gap-2.5 cursor-pointer hover:bg-paper-2 -mx-4.5 px-4.5">
                                  <ArrowRight size={14} className="text-ink-4 shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[14px] font-medium text-ink truncate">{t.from} <span className="text-ink-3 font-normal text-[12px] mx-1">轉給</span> {t.to}</div>
                                    {t.note && <div className="text-[11px] text-ink-3 mt-0.5 truncate">{t.note}</div>}
                                  </div>
                                  <div className="ml-auto text-right">
                                    <div className="text-[17px] font-medium tracking-[0.5px]">NT${utils.fmt(t.amount)}</div>
                                  </div>
                                </div>
                              );
                            }
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              """
    code = code[:start_idx] + unified_tab_ui + code[end_idx:]


# 7. Modal Unified replace
start_idx_modal = code.find("{modals.addExpense && (")
end_idx_modal = code.find("{modals.groupSettings && (")
if start_idx_modal != -1 and end_idx_modal != -1:
    unified_modal_ui = """{modals.addRecord && (
          <Modal title={isEditingExpense || isEditingTransfer ? (recordType === 'expense' ? "編輯費用" : "編輯轉帳") : "新增紀錄"} onClose={() => toggleModal('addRecord', false)}>
            {(!isEditingExpense && !isEditingTransfer) && (
              <div className="flex bg-paper border border-line p-1 rounded-sm mb-5 gap-1 shadow-sm">
                <button 
                  className={`flex-1 py-1.5 text-[13px] tracking-wider rounded-sm transition-all ${recordType === 'expense' ? 'bg-ink text-paper shadow-sm font-medium' : 'text-ink-3 hover:bg-paper-2'}`}
                  onClick={() => setRecordType('expense')}
                >
                  費用
                </button>
                <button 
                  className={`flex-1 py-1.5 text-[13px] tracking-wider rounded-sm transition-all ${recordType === 'transfer' ? 'bg-ink text-paper shadow-sm font-medium' : 'text-ink-3 hover:bg-paper-2'}`}
                  onClick={() => setRecordType('transfer')}
                >
                  轉帳
                </button>
              </div>
            )}

            {recordType === 'expense' ? (
              <>
                <div className="field">
                  <label className="field-label">說明</label>
                  <input type="text" value={expForm.desc} onChange={e => setExpForm({ ...expForm, desc: e.target.value })} placeholder="例：晚餐" maxLength={30} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="field">
                    <label className="field-label">金額 (NT$)</label>
                    <input type="number" value={expForm.amount} onChange={e => setExpForm({ ...expForm, amount: e.target.value })} placeholder="0.00" step="0.01" min="0" />
                  </div>
                  <div className="field">
                    <label className="field-label">日期</label>
                    <input type="date" value={expForm.date} onChange={e => setExpForm({ ...expForm, date: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">付款人</label>
                  <select value={expForm.payer} onChange={e => setExpForm({ ...expForm, payer: e.target.value })}>
                    {currentGroup?.members.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">分攤對象</label>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {currentGroup?.members.map(m => (
                      <button
                        key={m}
                        onClick={() => {
                          const updated = expForm.participants.includes(m)
                            ? expForm.participants.filter(p => p !== m)
                            : [...expForm.participants, m];
                          setExpForm({ ...expForm, participants: updated });
                        }}
                        className={`px-3 py-1.25 border rounded-full text-xs transition-all ${expForm.participants.includes(m) ? 'border-ink bg-paper-2 text-ink' : 'border-line text-ink-3'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">分攤方式</label>
                  <div className="flex border border-line rounded-sm overflow-hidden mb-3">
                    {(['equal', 'custom', 'percent'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setExpForm({ ...expForm, splitMode: mode })}
                        className={`flex-1 py-1.75 text-[11px] tracking-wider transition-all ${expForm.splitMode === mode ? 'bg-ink text-paper' : 'bg-transparent text-ink-3'}`}
                      >
                        {mode === 'equal' ? '平均分攤' : mode === 'custom' ? '自訂金額' : '自訂比例%'}
                      </button>
                    ))}
                  </div>
                  {expForm.splitMode === 'equal' ? (
                    expForm.participants.length > 0 && expForm.amount && (
                      <div className="text-[11px] text-ink-3 tracking-wider mt-1">每人 NT$ {utils.fmt(utils.round2(parseFloat(expForm.amount) / expForm.participants.length))}</div>
                    )
                  ) : (
                    <div className="flex flex-col gap-2.5 mt-2.5">
                      {expForm.participants.map(p => (
                        <div key={p} className="flex items-center gap-2.5">
                          <div className="w-20 text-sm shrink-0">{p}</div>
                          <div className="flex-1">
                            <input
                              type="number"
                              value={expForm.customShares[p] || ''}
                              onChange={e => setExpForm({ ...expForm, customShares: { ...expForm.customShares, [p]: e.target.value } })}
                              placeholder={expForm.splitMode === 'custom' ? '0.00' : '0'}
                              step="0.01"
                            />
                          </div>
                          <div className="text-xs text-ink-3 shrink-0">{expForm.splitMode === 'custom' ? 'NT$' : '%'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="field">
                    <label className="field-label">付款人</label>
                    <select value={tfForm.from} onChange={e => setTfForm({ ...tfForm, from: e.target.value })}>
                      {currentGroup?.members.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">收款人</label>
                    <select value={tfForm.to} onChange={e => setTfForm({ ...tfForm, to: e.target.value })}>
                      {currentGroup?.members.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">金額 (NT$)</label>
                  <input type="number" value={tfForm.amount} onChange={e => setTfForm({ ...tfForm, amount: e.target.value })} placeholder="0.00" step="0.01" min="0" />
                </div>
                <div className="field">
                  <label className="field-label">日期</label>
                  <input type="date" value={tfForm.date} onChange={e => setTfForm({ ...tfForm, date: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">備註（選填）</label>
                  <input type="text" value={tfForm.note} onChange={e => setTfForm({ ...tfForm, note: e.target.value })} placeholder="例：已轉帳至銀行帳戶" maxLength={30} />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('addRecord', false)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={recordType === 'expense' ? addExpense : addTransfer}>儲存</button>
            </div>
          </Modal>
        )}

        """
    code = code[:start_idx_modal] + unified_modal_ui + code[end_idx_modal:]

with open('src/App.tsx', 'w') as f:
    f.write(code)

