import { Group, MyGroup, Settlement, Expense, Share } from '../types';

const MY_GROUPS_KEY = 'warikan_my_groups';
const GROUP_PREFIX = 'warikan_group_';
const LAST_GROUP_KEY = 'warikan_last_group';

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
  },
  getLastGroup: (): string | null => localStorage.getItem(LAST_GROUP_KEY),
  setLastGroup: (code: string) => localStorage.setItem(LAST_GROUP_KEY, code),
  clearLastGroup: () => localStorage.removeItem(LAST_GROUP_KEY),
};

export const utils = {
  round2: (n: number) => Math.round(n * 100) / 100,
  toCents: (n: number) => Math.round(n * 100),
  fromCents: (n: number) => n / 100,
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
  equalShares: (amount: number, participants: string[]): Share[] => {
    if (participants.length === 0) return [];
    const totalCents = utils.toCents(amount);
    const baseCents = Math.floor(totalCents / participants.length);
    let remainder = totalCents - baseCents * participants.length;
    return participants.map(name => {
      const cents = baseCents + (remainder-- > 0 ? 1 : 0);
      return { name, amount: utils.fromCents(cents) };
    });
  },
  percentShares: (amount: number, percentages: Share[]): Share[] => {
    const totalCents = utils.toCents(amount);
    let allocated = 0;
    return percentages.map((share, index) => {
      const cents = index === percentages.length - 1
        ? totalCents - allocated
        : Math.round(totalCents * share.amount / 100);
      allocated += cents;
      return { name: share.name, amount: utils.fromCents(cents) };
    });
  },
  calcBalances: (group: Group) => {
    const bal: Record<string, number> = {};
    group.members.forEach(m => bal[m] = 0);

    group.expenses.forEach(e => {
      bal[e.payer] = (bal[e.payer] || 0) + utils.toCents(e.amount);
      if (e.splitMode === 'equal') {
        utils.equalShares(e.amount, e.participants).forEach(share => {
          bal[share.name] = (bal[share.name] || 0) - utils.toCents(share.amount);
        });
      } else if (e.shares) {
        e.shares.forEach(s => {
          bal[s.name] = (bal[s.name] || 0) - utils.toCents(s.amount);
        });
      }
    });

    group.transfers.forEach(t => {
      bal[t.from] = (bal[t.from] || 0) + utils.toCents(t.amount);
      bal[t.to] = (bal[t.to] || 0) - utils.toCents(t.amount);
    });

    return Object.fromEntries(Object.entries(bal).map(([name, cents]) => [name, utils.fromCents(cents)]));
  },
  calcSettlements: (balances: Record<string, number>): Settlement[] => {
    const debtors = Object.entries(balances)
      .map(([name, amount]) => ({ name, cents: utils.toCents(amount) }))
      .filter(item => item.cents < 0)
      .map(item => ({ name: item.name, amt: -item.cents }))
      .sort((a, b) => b.amt - a.amt);
    
    const creditors = Object.entries(balances)
      .map(([name, amount]) => ({ name, cents: utils.toCents(amount) }))
      .filter(item => item.cents > 0)
      .map(item => ({ name: item.name, amt: item.cents }))
      .sort((a, b) => b.amt - a.amt);

    const result: Settlement[] = [];
    let i = 0, j = 0;
    
    const dCopy = debtors.map(d => ({ ...d }));
    const cCopy = creditors.map(c => ({ ...c }));

    while (i < dCopy.length && j < cCopy.length) {
      const d = dCopy[i];
      const c = cCopy[j];
      const a = Math.min(d.amt, c.amt);
      result.push({ from: d.name, to: c.name, amount: utils.fromCents(a) });
      d.amt -= a;
      c.amt -= a;
      if (d.amt === 0) i++;
      if (c.amt === 0) j++;
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
