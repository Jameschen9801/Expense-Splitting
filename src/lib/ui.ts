export function recordDateLabel(date: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '未設定日期';
  const [year, month, day] = date.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
  const label = `${month} 月 ${day} 日`;
  if (date === today) return '今天 · ' + label;
  if (date === yesterday) return '昨天 · ' + label;
  return year === ty ? label : `${year} 年 ${label}`;
}
