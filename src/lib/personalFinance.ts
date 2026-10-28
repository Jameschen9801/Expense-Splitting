import type { Group, Income, Saving } from '../types';
import { categories } from './categories';
import { utils } from './utils';

export type CashflowKind = 'income' | 'saving';
export type CashflowForm = { amount: string; desc: string; date: string; direction: 'out' | 'in'; id?: string; kind: CashflowKind };
export const cashflowDraftKey = (code: string, name: string, kind: CashflowKind) => `warikan_cashflow_draft_v1_${code}_${encodeURIComponent(name)}_${kind}`;
export function cashflowValue(form: CashflowForm): Pick<Income,'amount'|'desc'|'date'> & Pick<Saving,'direction'> {
  if (!form.desc.trim() || form.desc.trim().length > 200) throw new Error('請填寫 1 至 200 字的說明');
  const amount = Number(form.amount);
  if (!/^\d+(?:\.\d{1,2})?$/.test(form.amount.trim()) || !Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new Error('請填寫有效金額，最多兩位小數');
  const date = new Date(form.date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== form.date) throw new Error('請填寫有效日期');
  if (!['out','in'].includes(form.direction)) throw new Error('請選擇儲蓄方向');
  return { desc: form.desc.trim(), amount: utils.fromCents(utils.toCents(amount)), date: form.date,
    ...(form.kind === 'saving' ? { direction: form.direction } : {}) };
}

export function summarizePersonal(group: Group, period: string, today = utils.todayStr()) {
  const year = Number(period.slice(0,4)), month = period.length === 7 ? Number(period.slice(5)) : null;
  const length = month ? new Date(Date.UTC(year,month,0)).getUTCDate() : 12;
  const points = Array.from({length},(_,index)=>({ key:month ? `${period}-${String(index+1).padStart(2,'0')}` : `${period}-${String(index+1).padStart(2,'0')}`, label:String(index+1), expenseCents:0, incomeCents:0 }));
  const buckets = new Map(categories.map(category=>[category.id,{...category,cents:0,count:0}]));
  const tags = new Map<string,{label:string;expenseCents:number;incomeCents:number;count:number}>();
  let expenseCents=0,incomeCents=0,savingOutCents=0,savingInCents=0,expenseCount=0,incomeCount=0,savingCount=0,futureCount=0,futureExpenseCents=0;
  const matches = (date:string)=>date?.startsWith(period+'-');
  const addTags = (record: Income, kind:'expense'|'income') => { for (const label of new Set(record.tags || [])) {
    const value=tags.get(label)||{label,expenseCents:0,incomeCents:0,count:0};value[kind+'Cents']+=utils.toCents(record.amount);value.count++;tags.set(label,value);
  } };
  for(const record of group.expenses) {
    if(!matches(record.date))continue;
    const cents=utils.toCents(record.amount), bucket=buckets.get(record.category||'other')||buckets.get('other')!;
    bucket.cents+=cents;bucket.count++;expenseCents+=cents;expenseCount++;addTags(record,'expense');
    const index=Number(record.date.slice(month?8:5,month?10:7))-1;if(points[index])points[index].expenseCents+=cents;
    if(record.date>today){futureCount++;futureExpenseCents+=cents;}
  }
  for(const record of group.incomes || []) {
    if(!matches(record.date))continue;
    const cents=utils.toCents(record.amount);incomeCents+=cents;incomeCount++;addTags(record,'income');
    const index=Number(record.date.slice(month?8:5,month?10:7))-1;if(points[index])points[index].incomeCents+=cents;
    if(record.date>today)futureCount++;
  }
  for(const record of group.savings || []) {
    if(!matches(record.date))continue;
    if(record.direction==='in')savingInCents+=utils.toCents(record.amount);else savingOutCents+=utils.toCents(record.amount);savingCount++;
    if(record.date>today)futureCount++;
  }
  return {expenseCents,incomeCents,balanceCents:incomeCents-expenseCents,savingOutCents,savingInCents,expenseCount,incomeCount,savingCount,
    futureCount,futureExpenseCents,points,categories:[...buckets.values()].filter(bucket=>bucket.count).sort((a,b)=>b.cents-a.cents),
    tags:[...tags.values()].sort((a,b)=>b.expenseCents-a.expenseCents), divisor:length};
}

export function personalPeriodLabel(period:string) {return period.length===4?`${period} 年`:period.replace('-',' 年 ')+' 月';}
