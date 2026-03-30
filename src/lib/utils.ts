import { Group, MyGroup, Settlement, Expense } from '../types';

const MY_GROUPS_KEY = 'warikan_my_groups';
const GROUP_PREFIX = 'warikan_group_';

export const storage = {
  getMyGroups: (): MyGroup[] => {
    try {
      return JSON.parse(localStorage.getItem(MY_GROUPS_KEY) || '[]');
    } catch {
      return [];
    }
  },
  saveMyGroups: (groups: MyGroup[]) => {
    localStorage.setItem(MY_GROUPS_KEY, JSON.stringify(groups));
  },
  getGroup: (code: string): Group | null => {
    try {
      return JSON.parse(localStorage.getItem(GROUP_PREFIX + code) || 'null');
    } catch {
      return null;
    }
  },
  saveGroup: (code: string, group: Group) => {
    localStorage.setItem(GROUP_PREFIX + code, JSON.stringify(group));
  }
};

export const utils = {
  round2: (n: number) => Math.round(n * 100) / 100,
  fmt: (n: number) => Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fmtDate: (dateStr: string) => {
    if (!dateStr) return '未設定日期';
    const [y, m, d] = dateStr.split('-');
    return `${y} 年 ${parseInt(m)} 月 ${parseInt(d)} 日`;
  },
  todayStr: () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  calcBalances: (group: Group) => {
    const bal: Record<string, number> = {};
    group.members.forEach(m => bal[m] = 0);

    group.expenses.forEach(e => {
      bal[e.payer] = (bal[e.payer] || 0) + e.amount;
      if (e.splitMode === 'equal') {
        const share = utils.round2(e.amount / e.participants.length);
        e.participants.forEach(p => {
          bal[p] = (bal[p] || 0) - share;
        });
      } else if (e.shares) {
        e.shares.forEach(s => {
          bal[s.name] = (bal[s.name] || 0) - utils.round2(s.amount);
        });
      }
    });

    group.transfers.forEach(t => {
      bal[t.from] = (bal[t.from] || 0) + t.amount;
      bal[t.to] = (bal[t.to] || 0) - t.amount;
    });

    return bal;
  },
  calcSettlements: (balances: Record<string, number>): Settlement[] => {
    const debtors = Object.entries(balances)
      .filter(([, v]) => v < -0.005)
      .map(([k, v]) => ({ name: k, amt: -v }))
      .sort((a, b) => b.amt - a.amt);
    
    const creditors = Object.entries(balances)
      .filter(([, v]) => v > 0.005)
      .map(([k, v]) => ({ name: k, amt: v }))
      .sort((a, b) => b.amt - a.amt);

    const result: Settlement[] = [];
    let i = 0, j = 0;
    
    const dCopy = debtors.map(d => ({ ...d }));
    const cCopy = creditors.map(c => ({ ...c }));

    while (i < dCopy.length && j < cCopy.length) {
      const d = dCopy[i];
      const c = cCopy[j];
      const a = Math.min(d.amt, c.amt);
      result.push({ from: d.name, to: c.name, amount: utils.round2(a) });
      d.amt -= a;
      c.amt -= a;
      if (d.amt < 0.005) i++;
      if (c.amt < 0.005) j++;
    }
    return result;
  },
  buildSplitDesc: (e: Expense) => {
    if (e.splitMode === 'equal') return '平均分攤';
    if (e.splitMode === 'custom') return '自訂金額';
    if (e.splitMode === 'percent') return '自訂比例';
    return '';
  }
};
