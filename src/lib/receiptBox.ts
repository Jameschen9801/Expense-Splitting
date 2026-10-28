import type { Expense, ExpenseCategory, Income, Saving } from '../types';
import { categoryLabel } from './categories';

const mapping: Record<string, ExpenseCategory> = {
  食物:'food', 飲料:'food', 酒水:'food', 汽油:'transport', 巴士:'transport', 計程車:'transport', 機車保養:'transport', 停車費:'transport', 交通:'transport',
  房租:'stay', 家具:'stay', 服飾:'shopping', 日用品:'shopping', 家電:'shopping', 辦公用品:'shopping',
  電話費:'bills', 電費:'bills', 娛樂:'entertainment', 禮物:'social', 禮品:'social', 保險費:'insurance', 醫療:'health', 健身:'health',
  旅行:'travel', 教育:'education', 理髮:'haircut', 交通罰單:'other',
};
export function receiptBoxCategory(original: string, note: string): ExpenseCategory {
  if (['食物','飲料','娛樂','日用品','服飾','家電'].includes(original)
    && /^(加油|汽油|停車費|停車|車票|高鐵|台鐵|捷運|Uber|uber|計程車|洗車)$/.test(note.trim())) return 'transport';
  if (original === '酒水') {
    if (/送禮|禮物|紅包|生日|母親節|父親節/.test(note)) return 'social';
    if (/WSET|課程|學費|上課|證照/i.test(note)) return 'education';
    if (/品酒會|場地費|門票|酒展|音樂|展覽/.test(note)) return 'entertainment';
  }
  if (original === '娛樂' && /鏡頭|相機|記憶卡|手機|MacBook|Apple Watch|電腦|螢幕|耳機|防潮箱/i.test(note)) return 'shopping';
  if (['交通','汽油'].includes(original) && /^(早餐|午餐|晚餐|宵夜|飲料|咖啡)$/.test(note.trim())) return 'food';
  if (original === '醫療' && /眼霜|面膜|保養品|洗面乳/.test(note)) return 'shopping';
  return mapping[original] || 'other';
}

// RFC 4180, including quoted commas, line breaks, escaped quotes and old rows
// that omit a final empty label. Never evaluate source cell contents.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const source = text.replace(/^\uFEFF/, '');
  const endCell = () => { row.push(cell); cell = ''; closed = false; };
  const endRow = () => { endCell(); if (row.some(value => value.length)) rows.push(row); row = []; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
      continue;
    }
    if (char === '"') { if (cell || closed) throw new Error('CSV 引號格式不正確'); quoted = true; }
    else if (char === ',') endCell();
    else if (char === '\n' || char === '\r') { endRow(); if (char === '\r' && source[index + 1] === '\n') index++; }
    else { if (closed) throw new Error('CSV 引號後有多餘文字'); cell += char; }
  }
  if (quoted) throw new Error('CSV 有未結束的引號');
  if (cell || row.length || closed) endRow();
  return rows;
}

function money(value: string, line: number) {
  const raw = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) throw new Error(`第 ${line} 列金額格式不正確`);
  const [whole, fraction = ''] = raw.replaceAll(',', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 1e11) throw new Error(`第 ${line} 列金額超出範圍`);
  return cents;
}
const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');

export async function prepareReceiptBox(text: string, ownerName: string, importedAt = Date.now()) {
  const [header, ...rows] = parseCsv(text);
  if (!header || !['日期','分類','支出','收入','定位','註記'].every(name => header.includes(name)) || new Set(header).size !== header.length) throw new Error('不是支援的 ReceiptBox CSV 格式');
  if (rows.length > 50000) throw new Error('單次最多匯入 50,000 筆');
  const expenses: Expense[] = [], incomes: Income[] = [], savings: Saving[] = [];
  const seen = new Map<string, number>(), unknown = new Map<string, number>(), counts = new Map<string, number>();
  let inputExpenseCents = 0, incomeCents = 0, expenseCents = 0, savingCents = 0, duplicates = 0;
  const prepared = rows.map((values, index) => {
    const line = index + 2;
    if (values.length > header.length) throw new Error(`第 ${line} 列欄位數過多`);
    const cell = (name: string) => (values[header.indexOf(name)] || '').trim();
    const date = cell('日期'), original = cell('分類'), desc = cell('註記'), location = cell('定位');
    const parsed = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new Error(`第 ${line} 列日期不正確`);
    const expense = money(cell('支出'),line), income = money(cell('收入'),line);
    if ((expense > 0) === (income > 0)) throw new Error(`第 ${line} 列必須只有支出或收入其中一個金額`);
    const tags = [...new Set(header.flatMap((name, at) => /^標籤\d+$/.test(name) && values[at]?.trim() ? [values[at].trim()] : []))];
    if (desc.length > 200 || location.length > 300 || original.length > 60 || tags.length > 100 || tags.some(tag=>tag.length>60)) throw new Error(`第 ${line} 列文字超過支援長度`);
    const canonical = JSON.stringify([date,original,expense,income,location,desc,tags]);
    const occurrence = (seen.get(canonical) || 0) + 1; seen.set(canonical,occurrence);
    if (occurrence > 1) duplicates++;
    const kind = income > 0 ? 'income' : original === '儲蓄' ? 'saving' : 'expense';
    const category = receiptBoxCategory(original,desc);
    if (kind === 'expense' && !(original in mapping)) unknown.set(original,(unknown.get(original)||0)+1);
    inputExpenseCents += expense; incomeCents += income;
    if (kind === 'saving') savingCents += expense; else expenseCents += expense;
    const label = kind === 'expense' ? categoryLabel(category) : kind === 'saving' ? '儲蓄' : '收入'; counts.set(label,(counts.get(label)||0)+1);
    return { canonical, occurrence, kind, category, value: {
      desc: desc || (kind === 'income' ? '收入' : kind === 'saving' ? '儲蓄' : `${original || categoryLabel(category)}支出`),
      date, amount: (income || expense) / 100, createdAt: importedAt + index, revision: 1, createdBy: 'ReceiptBox',
      importSource: { system: 'ReceiptBox' as const, category: original }, ...(location ? { location } : {}), ...(tags.length ? { tags } : {}),
    } };
  });
  // Retain legitimate identical rows using an occurrence number, while assigning
  // the same IDs when a file is reordered or imported again.
  const ids = await Promise.all(prepared.map(row=>hash(row.canonical+'\n'+row.occurrence)));
  prepared.forEach((row,index)=>{
    const id = `${row.kind[0]}rcpt_${ids[index].slice(0,40)}`;
    if (row.kind === 'income') incomes.push({id,...row.value});
    else if (row.kind === 'saving') savings.push({id,...row.value,direction:'out'});
    else expenses.push({id,...row.value,payer:ownerName,participants:[ownerName],splitMode:'equal',category:row.category});
  });
  const dates = prepared.map(row=>row.value.date).sort();
  return { expenses, incomes, savings, report: { rows: rows.length, expenses: expenses.length, incomes: incomes.length, savings: savings.length,
    expenseCents, incomeCents, savingCents, inputExpenseCents, dates: [dates[0],dates.at(-1)], identicalRowsRetained: duplicates,
    categories: Object.fromEntries(counts), unknownCategories: Object.fromEntries(unknown), sourceHash: await hash(text) } };
}
