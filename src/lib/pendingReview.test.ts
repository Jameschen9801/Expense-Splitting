import assert from 'node:assert/strict';
import test from 'node:test';
import { completeReview, nextReviewId, reviewProgress, startReviewSession } from './pendingReview';

test('待確認從指定項目開始，每筆只出現一次，確認後才前進', () => {
  const start=startReviewSession(['a','b','c','b'],'b');
  assert.deepEqual(start.ids,['b','a','c']);
  assert.deepEqual(reviewProgress(start,['a','b','c']),{current:1,total:3,hasNext:true});
  assert.equal(nextReviewId(start,['a','b','c']),'b');
  const next=completeReview(start,'b');
  assert.equal(nextReviewId(next,['a','b','c']),'a');
  assert.deepEqual(reviewProgress(next,['a','c']),{current:2,total:3,hasNext:true});
  assert.deepEqual(start.completed,[]);
  assert.deepEqual(completeReview(next,'b').completed,['b']);
});
test('連續處理跳過其他裝置已處理的項目，不把新到通知混入本次順序', () => {
  const next=completeReview(startReviewSession(['a','b','c'],'a'),'a');
  assert.equal(nextReviewId(next,['c','new']),'c');
  assert.deepEqual(reviewProgress(next,['c','new']),{current:2,total:2,hasNext:false});
  const done=completeReview(next,'c');
  assert.equal(nextReviewId(done,['new']),undefined);
  assert.deepEqual(reviewProgress(done,['new']),{current:2,total:2,hasNext:false});
});
