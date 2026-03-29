/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Plus,
  MoreHorizontal,
  X,
  Copy,
  Check,
  ArrowRight,
  Trash2,
  Info
} from 'lucide-react';
import { Group, MyGroup, Expense, Transfer, Share, Settlement } from './types';
import { storage, utils } from './lib/utils';
import { subscribeToGroup, fetchGroupOnce, syncGroupToCloud } from './lib/firebase';

export default function App() {
  const [currentPage, setCurrentPage] = useState<'home' | 'group'>('home');
  const [myGroups, setMyGroups] = useState<MyGroup[]>([]);
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);
  const [myName, setMyName] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'expenses' | 'transfers' | 'balance' | 'members'>('expenses');

  // Modals state
  const [modals, setModals] = useState({
    createGroup: false,
    joinGroup: false,
    addExpense: false,
    addTransfer: false,
    groupSettings: false,
    expenseDetail: false
  });

  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [isEditingExpense, setIsEditingExpense] = useState(false);
  const [syncState, setSyncState] = useState<'syncing' | 'synced' | ''>('');

  // Form states
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMyName, setNewGroupMyName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinMyName, setJoinMyName] = useState('');

  const [expForm, setExpForm] = useState({
    desc: '',
    amount: '',
    date: utils.todayStr(),
    payer: '',
    participants: [] as string[],
    splitMode: 'equal' as 'equal' | 'custom' | 'percent',
    customShares: {} as Record<string, string>
  });

  const [tfForm, setTfForm] = useState({
    from: '',
    to: '',
    amount: '',
    date: utils.todayStr(),
    note: ''
  });

  const [settingsGroupName, setSettingsGroupName] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setMyGroups(storage.getMyGroups());
  }, []);

  // 當使用者停留在群組頁面時，自動開啟 Firebase 監聽雙向綁定
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (currentPage === 'group' && currentGroup?.code) {
      setSyncState('syncing');
      unsubscribe = subscribeToGroup(currentGroup.code, (cloudData) => {
        if (cloudData) {
          // 當雲端有任何風吹草動變更，立刻覆寫到畫面與本地！
          setCurrentGroup(cloudData);
          storage.saveGroup(currentGroup.code, cloudData);
        }
        setSyncState('synced'); // 綠燈
        setTimeout(() => setSyncState(''), 2000); // 熄滅
      });
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentPage, currentGroup?.code]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const toggleModal = (key: keyof typeof modals, open: boolean) => {
    setModals(prev => ({ ...prev, [key]: open }));
    if (key === 'addExpense' && open && currentGroup) {
      if (!isEditingExpense) {
        setExpForm({
          desc: '',
          amount: '',
          date: utils.todayStr(),
          payer: currentGroup.members[0] || '',
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
      setTfForm({
        from: currentGroup.members[0] || '',
        to: currentGroup.members[1] || '',
        amount: '',
        date: utils.todayStr(),
        note: ''
      });
    }
  };

  const openGroup = (code: string) => {
    const mg = myGroups.find(g => g.code === code);
    if (!mg) return;
    const data = storage.getGroup(code);
    if (!data) return;

    setCurrentGroup(data);
    setMyName(mg.myName);
    setSettingsGroupName(data.name);
    setCurrentPage('group');
    setActiveTab('expenses');
    // Firebase useEffect 會自動幫我們連線並更新
  };

  const goHome = () => {
    setCurrentPage('home');
    setMyGroups(storage.getMyGroups());
  };

  const createGroup = () => {
    if (!newGroupName.trim() || !newGroupMyName.trim()) {
      showToast('請填寫群組名稱與你的名字');
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const data: Group = {
      name: newGroupName,
      code,
      members: [newGroupMyName],
      expenses: [],
      transfers: [],
      createdAt: Date.now()
    };
    storage.saveGroup(code, data);
    
    // 初始化一份空的 Firebase 資料
    syncGroupToCloud(code, data);

    const updated = [...myGroups, { code, name: newGroupName, myName: newGroupMyName }];
    storage.saveMyGroups(updated);
    setMyGroups(updated);

    toggleModal('createGroup', false);
    setNewGroupName('');
    setNewGroupMyName('');
    openGroup(code);
  };

  const joinGroup = async () => {
    if (!joinCode.trim() || !joinMyName.trim()) {
      showToast('請填寫邀請碼與你的名字');
      return;
    }
    
    setSyncState('syncing');
    let data = storage.getGroup(joinCode);
    
    if (!data) {
      showToast('本地無資料，正從 Firebase 同步中...');
      try {
        const cloudData = await fetchGroupOnce(joinCode);
        if (!cloudData) {
          showToast('雲端找不到此邀請碼！');
          setSyncState('');
          return;
        }
        data = cloudData;
        showToast('🎉 雲端群組同步成功！');
      } catch (err) {
        showToast('雲端同步失敗，請檢查網路。');
        setSyncState('');
        return;
      }
    }

    if (!data.members.includes(joinMyName)) {
      data.members.push(joinMyName);
    }
    storage.saveGroup(joinCode, data);
    
    // 將自己加入並直接暴力覆寫回 Firebase 即可！
    syncGroupToCloud(joinCode, data);

    const updated = [...myGroups];
    if (!updated.find(g => g.code === joinCode)) {
      updated.push({ code: joinCode, name: data.name, myName: joinMyName });
      storage.saveMyGroups(updated);
      setMyGroups(updated);
    }
    
    toggleModal('joinGroup', false);
    setJoinCode('');
    setJoinMyName('');
    openGroup(joinCode);
    setSyncState('');
  };

  const openEditExpense = (e: Expense) => {
    setIsEditingExpense(true);
    const customShares: Record<string, string> = {};
    if (e.splitMode !== 'equal' && e.shares) {
      e.shares.forEach(s => {
        customShares[s.name] = s.amount.toString();
      });
    }

    setExpForm({
      desc: e.desc,
      amount: e.amount.toString(),
      date: e.date,
      payer: e.payer,
      participants: [...e.participants],
      splitMode: e.splitMode,
      customShares
    });

    setModals(prev => ({ ...prev, expenseDetail: false, addExpense: true }));
  };

  const addExpense = () => {
    if (!currentGroup) return;
    const { desc, amount, payer, participants, splitMode, date, customShares } = expForm;
    const amt = parseFloat(amount);
    if (!desc.trim()) { showToast('請填寫說明'); return; }
    if (isNaN(amt) || amt <= 0) { showToast('請填寫有效金額'); return; }
    if (!payer) { showToast('請選擇付款人'); return; }
    if (participants.length === 0) { showToast('請選擇至少一位分攤對象'); return; }

    let shares: Share[] = [];
    if (splitMode !== 'equal') {
      let total = 0;
      participants.forEach(p => {
        const val = parseFloat(customShares[p] || '0');
        total += val;
        shares.push({ name: p, amount: val });
      });

      if (splitMode === 'percent') {
        if (Math.abs(total - 100) > 0.01) { showToast('比例總和須為 100%'); return; }
        shares = shares.map(s => ({ name: s.name, amount: utils.round2(amt * s.amount / 100) }));
      } else {
        if (Math.abs(amt - total) > 0.05) { showToast(`金額加總與費用不符`); return; }
      }
    }

    const expense: Expense = {
      id: isEditingExpense && selectedExpense ? selectedExpense.id : 'e' + Date.now(),
      desc, amount: utils.round2(amt), payer, participants, splitMode, shares,
      date, createdAt: isEditingExpense && selectedExpense ? selectedExpense.createdAt : Date.now()
    };

    let updatedExpenses;
    if (isEditingExpense && selectedExpense) {
      updatedExpenses = currentGroup.expenses.map(e => e.id === selectedExpense.id ? expense : e);
    } else {
      updatedExpenses = [...currentGroup.expenses, expense];
    }

    const updated = { ...currentGroup, expenses: updatedExpenses };
    setCurrentGroup(updated);
    storage.saveGroup(updated.code, updated);
    syncGroupToCloud(updated.code, updated); // Firebase 覆寫

    toggleModal('addExpense', false);
    setIsEditingExpense(false);
    showToast(isEditingExpense ? '費用已更新' : '費用已新增');
  };

  const addTransfer = () => {
    if (!currentGroup) return;
    const { from, to, amount, date, note } = tfForm;
    const amt = parseFloat(amount);
    if (!from || !to) { showToast('請選擇付款人與收款人'); return; }
    if (from === to) { showToast('付款人與收款人不能相同'); return; }
    if (isNaN(amt) || amt <= 0) { showToast('請填寫有效金額'); return; }

    const tf: Transfer = {
      id: 't' + Date.now(), from, to, amount: utils.round2(amt), note,
      date, createdAt: Date.now()
    };
    const updated = { ...currentGroup, transfers: [...currentGroup.transfers, tf] };
    setCurrentGroup(updated);
    storage.saveGroup(updated.code, updated);
    syncGroupToCloud(updated.code, updated); // Firebase 覆寫

    toggleModal('addTransfer', false);
    showToast('轉帳已記錄');
  };

  const removeExpense = (id: string) => {
    if (!currentGroup) return;
    const target = currentGroup.expenses.find(e => e.id === id);
    const updated = { ...currentGroup, expenses: currentGroup.expenses.filter(e => e.id !== id) };
    setCurrentGroup(updated);
    storage.saveGroup(updated.code, updated);
    syncGroupToCloud(updated.code, updated); // Firebase 覆寫

    showToast('已刪除');
    toggleModal('expenseDetail', false);
  };

  const removeTransfer = (id: string) => {
    if (!currentGroup) return;
    const target = currentGroup.transfers.find(t => t.id === id);
    const updated = { ...currentGroup, transfers: currentGroup.transfers.filter(t => t.id !== id) };
    setCurrentGroup(updated);
    storage.saveGroup(updated.code, updated);
    syncGroupToCloud(updated.code, updated); // Firebase 覆寫

    showToast('已刪除');
  };

  const addMember = (name: string) => {
    if (!currentGroup || !name.trim()) return;
    if (currentGroup.members.includes(name)) { showToast('此成員已存在'); return; }
    const updated = { ...currentGroup, members: [...currentGroup.members, name] };
    setCurrentGroup(updated);
    storage.saveGroup(updated.code, updated);
    showToast(`已新增 ${name}`);
  };

  const removeMember = (name: string) => {
    if (!currentGroup) return;
    if (name === myName) { showToast('無法移除自己'); return; }
    
    // 檢查是否為群主（群主永遠是 members 的第 0 個索引）
    const creator = currentGroup.members[0];
    if (myName !== creator) { 
       showToast('⚠️ 權限不足：只有群主可以刪除成員'); 
       return; 
    }
    if (name === creator) { 
       showToast('不能刪除群主'); 
       return; 
    }

    const inUse = [...currentGroup.expenses, ...currentGroup.transfers]
      .some(e => e.payer === name || (e as any).participants?.includes(name) || (e as any).from === name || (e as any).to === name);
    if (inUse) { showToast('此成員有費用記錄，無法移除'); return; }
    const updated = { ...currentGroup, members: currentGroup.members.filter(m => m !== name) };
    setCurrentGroup(updated);
    storage.saveGroup(updated.code, updated);
    syncGroupToCloud(updated.code, updated); // Firebase 覆寫
  };

  const saveGroupSettings = () => {
    if (!currentGroup || !settingsGroupName.trim()) return;
    const updated = { ...currentGroup, name: settingsGroupName };
    setCurrentGroup(updated);
    storage.saveGroup(updated.code, updated);
    const updatedMyGroups = myGroups.map(g => g.code === updated.code ? { ...g, name: settingsGroupName } : g);
    setMyGroups(updatedMyGroups);
    storage.saveMyGroups(updatedMyGroups);
    toggleModal('groupSettings', false);
    showToast('已儲存');
  };

  const leaveGroup = () => {
    if (!currentGroup) return;
    const updated = myGroups.filter(g => g.code !== currentGroup.code);
    setMyGroups(updated);
    storage.saveMyGroups(updated);
    toggleModal('groupSettings', false);
    goHome();
    showToast('已離開群組');
  };

  const balances = useMemo(() => currentGroup ? utils.calcBalances(currentGroup) : {}, [currentGroup]);
  const settlements = useMemo(() => utils.calcSettlements(balances), [balances]);

  const groupedExpenses = useMemo<Record<string, Expense[]>>(() => {
    if (!currentGroup) return {};
    const sorted = [...currentGroup.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const groups: Record<string, Expense[]> = {};
    sorted.forEach(e => {
      const key = e.date || '未設定日期';
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return groups;
  }, [currentGroup]);

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <AnimatePresence mode="wait">
        {currentPage === 'home' ? (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col min-h-screen"
          >
            <nav className="topbar h-13 bg-paper border-b border-line px-5 flex items-center justify-between sticky top-0 z-50">
              <div>
                <div className="font-serif text-[17px] font-semibold tracking-[3px]">分帳小工具</div>
                <div className="text-[10px] tracking-[4px] text-ink-3 uppercase">分帳應用</div>
              </div>
            </nav>

            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-12">
              <div className="text-center">
                <div className="w-10 h-px bg-line mx-auto my-5"></div>
                <p className="text-xs tracking-[2px] text-ink-3">與朋友一起記錄每一筆花費</p>
              </div>

              <div className="w-full max-w-[480px]">
                <div className="text-[10px] tracking-[3px] uppercase text-ink-3 mb-3 pb-2 border-b border-line">我的群組</div>
                <div className="flex flex-col gap-2">
                  {myGroups.length === 0 ? (
                    <div className="text-center py-10 text-ink-3 text-xs tracking-wider leading-relaxed">
                      尚無群組<br /><span className="text-[10px]">建立或加入一個群組以開始</span>
                    </div>
                  ) : (
                    myGroups.map(g => (
                      <button
                        key={g.code}
                        onClick={() => openGroup(g.code)}
                        className="bg-paper border border-line p-4 text-left flex items-center justify-between transition-all hover:border-ink hover:shadow-sm rounded-sm"
                      >
                        <div>
                          <div className="text-sm font-medium tracking-wide">{g.name}</div>
                          <div className="text-[11px] text-ink-3 mt-0.5">
                            {storage.getGroup(g.code)?.members.length || 0} 位成員 · {storage.getGroup(g.code)?.expenses.length || 0} 筆費用
                          </div>
                        </div>
                        <div className="text-[11px] tracking-[2px] text-ink-3 font-mono">{g.code}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex gap-3 flex-wrap justify-center w-full max-w-[480px]">
                <button className="btn btn-primary w-full md:w-auto" onClick={() => toggleModal('createGroup', true)}>＋ 建立群組</button>
                <button className="btn w-full md:w-auto" onClick={() => toggleModal('joinGroup', true)}>加入群組</button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="group"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col min-h-screen"
          >
            <nav className="topbar h-13 bg-paper border-b border-line px-5 flex items-center justify-between sticky top-0 z-50">
              <button className="icon-btn text-xl" onClick={goHome}><ArrowLeft size={20} /></button>
              <div className="text-center">
                <div className="font-serif text-sm tracking-[2px]">{currentGroup?.name}</div>
                <div className="text-[10px] tracking-[2px] text-ink-3">{currentGroup?.code}</div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  className="icon-btn text-[11px] font-medium px-2 py-1 flex items-center gap-1 transition-all text-green-600 bg-green-50/50" 
                  title="Firebase 即時連線狀態"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${syncState === 'syncing' ? 'bg-amber-500 animate-pulse' : syncState === 'synced' ? 'bg-green-600' : 'bg-green-600'}`}></span>
                  即時連線中
                </button>
                <button className="icon-btn" onClick={() => toggleModal('groupSettings', true)}>
                  <MoreHorizontal size={18} />
                </button>
              </div>
            </nav>

            <div className="flex border-b border-line bg-paper sticky top-13 z-40 px-5">
              {(['expenses', 'transfers', 'balance', 'members'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-3 text-[11px] tracking-[2px] uppercase transition-all border-b-2 -mb-px ${activeTab === tab ? 'text-ink border-ink' : 'text-ink-3 border-transparent'}`}
                >
                  {tab === 'expenses' ? '支出' : tab === 'transfers' ? '轉帳' : tab === 'balance' ? '結算' : '成員'}
                </button>
              ))}
            </div>

            <div className="flex-1 p-5 max-w-[680px] mx-auto w-full flex flex-col gap-4">
              {activeTab === 'expenses' && (
                <div className="panel">
                  <div className="panel-header p-4 border-b border-line flex items-center justify-between">
                    <span className="section-label">費用記錄</span>
                    <button className="btn btn-sm btn-primary" onClick={() => toggleModal('addExpense', true)}>＋ 新增</button>
                  </div>
                  <div className="px-4.5">
                    {Object.keys(groupedExpenses).length === 0 ? (
                      <div className="text-center py-10 text-ink-3 text-xs tracking-wider">尚無費用記錄</div>
                    ) : (
                      Object.entries(groupedExpenses).map(([date, items]) => (
                        <div key={date}>
                          <div className="flex justify-between items-center py-2.5 border-b border-line mt-1.5 uppercase text-[11px] tracking-[2px] text-ink-3">
                            <span>{date === '未設定日期' ? date : utils.fmtDate(date)}</span>
                            <span className="text-ink-3">NT$ {utils.fmt((items as Expense[]).reduce((s, e) => s + e.amount, 0))}</span>
                          </div>
                          {(items as Expense[]).map(e => (
                            <div
                              key={e.id}
                              onClick={() => { setSelectedExpense(e); toggleModal('expenseDetail', true); }}
                              className="py-3 border-b border-line last:border-b-0 grid grid-cols-[1fr_auto] gap-3 items-start cursor-pointer hover:bg-paper-2 -mx-4.5 px-4.5"
                            >
                              <div>
                                <div className="text-sm font-medium">{e.desc}</div>
                                <div className="text-[11px] text-ink-3 tracking-tight">{e.payer} 付款 · {e.participants.join('、')} 分攤</div>
                              </div>
                              <div className="text-right">
                                <div className="text-[15px] font-medium tracking-tight">NT$ {utils.fmt(e.amount)}</div>
                                <div className="text-[10px] tracking-wider text-ink-3">{utils.buildSplitDesc(e)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'transfers' && (
                <div className="panel">
                  <div className="panel-header p-4 border-b border-line flex items-center justify-between">
                    <span className="section-label">轉帳記錄</span>
                    <button className="btn btn-sm btn-primary" onClick={() => toggleModal('addTransfer', true)}>＋ 新增</button>
                  </div>
                  <div className="px-4.5">
                    {currentGroup?.transfers.length === 0 ? (
                      <div className="text-center py-10 text-ink-3 text-xs tracking-wider">尚無轉帳記錄</div>
                    ) : (
                      currentGroup?.transfers.slice().reverse().map(t => (
                        <div key={t.id} className="py-3 border-b border-line last:border-b-0 flex items-center gap-2.5">
                          <span className="text-sm font-medium">{t.from}</span>
                          <ArrowRight size={12} className="text-ink-3" />
                          <span className="text-sm font-medium">{t.to}</span>
                          <div className="ml-auto text-right">
                            <div className="text-sm font-medium tracking-tight">NT$ {utils.fmt(t.amount)}</div>
                            {t.date && <div className="text-[11px] text-ink-3">{t.date}</div>}
                            {t.note && <div className="text-[11px] text-ink-3">{t.note}</div>}
                          </div>
                          <button className="icon-btn ml-2" onClick={() => removeTransfer(t.id)}><X size={14} /></button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'balance' && (
                <>
                  <div className="panel">
                    <div className="panel-header p-4 border-b border-line"><span className="section-label">個人餘額</span></div>
                    <div className="px-4.5">
                      {currentGroup?.members.map(m => {
                        const b = balances[m] || 0;
                        const isPos = b > 0.005;
                        const isNeg = b < -0.005;
                        return (
                          <div key={m} className="flex items-center py-3 border-b border-line last:border-b-0 gap-3">
                            <div className="w-7 h-7 border border-line rounded-full flex items-center justify-center text-[11px] font-medium text-ink-2 shrink-0">{m.charAt(0)}</div>
                            <div className="flex-1 text-sm">
                              {m}
                              <div className="text-[10px] text-ink-3 tracking-wider">{isPos ? '待收回' : isNeg ? '待付款' : '已結清'}</div>
                            </div>
                            <div className={`text-sm font-medium tracking-tight ${isPos ? 'text-green-700' : isNeg ? 'text-red-700' : 'text-ink-3'}`}>
                              {isPos ? '+' : ''}NT$ {utils.fmt(Math.abs(b))}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-between items-center py-3 border-t border-line mt-1">
                        <span className="text-[10px] tracking-[2px] uppercase text-ink-3">總花費</span>
                        <span className="text-base font-medium">NT$ {utils.fmt(currentGroup?.expenses.reduce((s, e) => s + e.amount, 0) || 0)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="panel mt-4">
                    <div className="panel-header p-4 border-b border-line"><span className="section-label">建議轉帳</span></div>
                    <div className="px-4.5">
                      {settlements.length === 0 ? (
                        <div className="text-center py-10 text-ink-3 text-xs tracking-wider leading-loose">
                          <span className="stamp">已結清</span><br /><br />目前無需轉帳
                        </div>
                      ) : (
                        settlements.map((s, idx) => (
                          <div key={idx} className="flex flex-col py-3 border-b border-line last:border-b-0 gap-2">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium">{s.from}</span>
                              <span className="text-ink-3 text-[11px]">應付給</span>
                              <span className="font-medium">{s.to}</span>
                              <span className="ml-auto font-medium">NT$ {utils.fmt(s.amount)}</span>
                            </div>
                            <button
                              className="btn btn-sm btn-ghost w-full text-[11px] tracking-wider"
                              onClick={() => {
                                const tf: Transfer = {
                                  id: 't' + Date.now(), from: s.from, to: s.to, amount: s.amount,
                                  note: '結算轉帳', date: utils.todayStr(), createdAt: Date.now()
                                };
                                const updated = { ...currentGroup!, transfers: [...currentGroup!.transfers, tf] };
                                setCurrentGroup(updated);
                                storage.saveGroup(updated.code, updated);
                                showToast(`已記錄：${s.from} → ${s.to} NT$ ${utils.fmt(s.amount)}`);
                              }}
                            >
                              ✓ &nbsp;完成轉帳，記錄此筆
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'members' && (
                <div className="panel">
                  <div className="panel-header p-4 border-b border-line"><span className="section-label">群組成員</span></div>
                  <div className="p-4.5">
                    <div className="bg-paper-2 border border-line p-3 flex items-center justify-between mb-3 rounded-sm">
                      <div>
                        <div className="text-[10px] tracking-[2px] text-ink-3 mb-1">邀請碼</div>
                        <div className="font-mono text-xl tracking-[6px] text-ink">{currentGroup?.code}</div>
                      </div>
                      <button className="btn btn-sm" onClick={() => {
                        navigator.clipboard.writeText(currentGroup?.code || '');
                        showToast('邀請碼已複製');
                      }}><Copy size={14} className="mr-1" /> 複製</button>
                    </div>
                    <div className="text-[11px] text-ink-3 mb-4 tracking-wider">將邀請碼分享給朋友，他們即可加入此群組</div>

                    <div className="flex flex-col">
                      {currentGroup?.members.map(m => (
                        <div key={m} className="flex items-center py-3 border-b border-line last:border-b-0 gap-3">
                          <div className="w-7 h-7 border border-line rounded-full flex items-center justify-center text-[11px] font-medium text-ink-2 shrink-0">{m.charAt(0)}</div>
                          <div className="flex-1 text-sm">{m} {m === myName && <span className="text-[10px] text-ink-3 tracking-wider">（我）</span>}</div>
                          {currentGroup.members.length > 1 && m !== myName && (
                            <button className="icon-btn" onClick={() => removeMember(m)}><X size={14} /></button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-4">
                      <div className="field-label">新增成員姓名</div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          id="newMemberInput"
                          placeholder="姓名"
                          className="flex-1"
                          maxLength={12}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              addMember((e.target as HTMLInputElement).value);
                              (e.target as HTMLInputElement).value = '';
                            }
                          }}
                        />
                        <button className="btn btn-sm btn-primary" onClick={() => {
                          const input = document.getElementById('newMemberInput') as HTMLInputElement;
                          addMember(input.value);
                          input.value = '';
                        }}>新增</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {modals.createGroup && (
          <Modal title="建立群組" onClose={() => toggleModal('createGroup', false)}>
            <div className="field">
              <label className="field-label">群組名稱</label>
              <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="例：京都旅行" maxLength={20} />
            </div>
            <div className="field">
              <label className="field-label">你的名字</label>
              <input type="text" value={newGroupMyName} onChange={e => setNewGroupMyName(e.target.value)} placeholder="你在群組中的顯示名稱" maxLength={12} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('createGroup', false)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={createGroup}>建立</button>
            </div>
          </Modal>
        )}

        {modals.joinGroup && (
          <Modal title="加入群組" onClose={() => toggleModal('joinGroup', false)}>
            <div className="field">
              <label className="field-label">邀請碼（6位數字）</label>
              <input type="text" value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="123456" maxLength={6} className="text-xl tracking-[6px] font-mono" />
            </div>
            <div className="field">
              <label className="field-label">你的名字</label>
              <input type="text" value={joinMyName} onChange={e => setJoinMyName(e.target.value)} placeholder="你在群組中的顯示名稱" maxLength={12} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('joinGroup', false)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={joinGroup}>加入</button>
            </div>
          </Modal>
        )}

        {modals.addExpense && (
          <Modal title={isEditingExpense ? "編輯費用" : "新增費用"} onClose={() => toggleModal('addExpense', false)}>
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
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('addExpense', false)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={addExpense}>儲存</button>
            </div>
          </Modal>
        )}

        {modals.addTransfer && (
          <Modal title="記錄轉帳" onClose={() => toggleModal('addTransfer', false)}>
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
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('addTransfer', false)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={addTransfer}>儲存</button>
            </div>
          </Modal>
        )}

        {modals.groupSettings && (
          <Modal title="群組設定" onClose={() => toggleModal('groupSettings', false)}>
            <div className="field">
              <label className="field-label">群組名稱</label>
              <input type="text" value={settingsGroupName} onChange={e => setSettingsGroupName(e.target.value)} maxLength={20} />
            </div>
            <div className="mt-2">
              <button className="btn btn-danger btn-sm w-full" onClick={leaveGroup}>離開群組</button>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleModal('groupSettings', false)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={saveGroupSettings}>儲存</button>
            </div>
          </Modal>
        )}

        {modals.expenseDetail && selectedExpense && (
          <Modal title="費用詳情" onClose={() => toggleModal('expenseDetail', false)}>
            <div className="mb-4.5">
              <div className="text-xl font-medium mb-1">{selectedExpense.desc}</div>
              <div className="text-2xl font-medium tracking-tight mb-3">NT$ {utils.fmt(selectedExpense.amount)}</div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="field-label">日期</div>
                  <div className="text-sm">{selectedExpense.date ? utils.fmtDate(selectedExpense.date) : '未設定'}</div>
                </div>
                <div>
                  <div className="field-label">付款人</div>
                  <div className="text-sm">{selectedExpense.payer}</div>
                </div>
                <div>
                  <div className="field-label">分攤方式</div>
                  <div className="text-sm">{utils.buildSplitDesc(selectedExpense)}</div>
                </div>
                <div>
                  <div className="field-label">建立時間</div>
                  <div className="text-xs text-ink-3">{new Date(selectedExpense.createdAt).toLocaleString('zh-TW')}</div>
                </div>
              </div>
              <div className="field-label mb-2">各人分攤金額</div>
              <div className="flex flex-col">
                {selectedExpense.splitMode === 'equal' ? (
                  selectedExpense.participants.map(p => (
                    <div key={p} className="flex justify-between py-1.5 border-b border-line text-sm">
                      <span>{p}</span><span>NT$ {utils.fmt(utils.round2(selectedExpense.amount / selectedExpense.participants.length))}</span>
                    </div>
                  ))
                ) : (
                  selectedExpense.shares?.map(s => (
                    <div key={s.name} className="flex justify-between py-1.5 border-b border-line text-sm">
                      <span>{s.name}</span><span>NT$ {utils.fmt(s.amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-2">
              <button className="btn btn-primary w-full" onClick={() => openEditExpense(selectedExpense)}>
                編輯此筆費用
              </button>
              <button className="btn btn-danger w-full" onClick={() => removeExpense(selectedExpense.id)}>
                <Trash2 size={14} className="mr-1.5" /> 刪除此筆費用
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Toast */}
      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink text-paper px-5 py-2.5 rounded-sm text-xs tracking-wider z-[999] transition-opacity duration-200 pointer-events-none ${toast ? 'opacity-100' : 'opacity-0'}`}>
        {toast}
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-ink/40 z-[200] flex items-center justify-center p-5"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        className="bg-paper border border-line rounded-sm w-full max-w-[440px] max-h-[90vh] overflow-y-auto shadow-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4.5 border-b border-line flex items-center justify-between">
          <span className="font-serif text-[15px] tracking-[2px]">{title}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}
