import type { RecordDetails } from '../types';
import { utils } from '../lib/utils';
export function RecordProvenance({record}:{record:RecordDetails & {date:string}}) {
  if(!record.importSource&&!record.location&&!record.notes&&!record.tags?.length&&record.date<=utils.todayStr())return null;
  return <div className="record-provenance">{record.date>utils.todayStr()&&<p>預排記錄 · {record.date}</p>}{record.importSource&&<p>從 {record.importSource.system} 匯入 · 原分類：{record.importSource.category}</p>}{record.location&&<p>地點：{record.location}</p>}{record.notes&&<p>{record.notes}</p>}{record.tags?.length&&<div className="record-tags">{record.tags.map(tag=><span key={tag}>{tag}</span>)}</div>}</div>;
}
