export type ReviewSession = { ids: string[]; completed: string[] };

export function startReviewSession(ids: string[], first: string): ReviewSession {
  return { ids: [first, ...new Set(ids.filter(id => id !== first))], completed: [] };
}
export function completeReview(session: ReviewSession, id: string): ReviewSession {
  return { ...session, completed: [...new Set([...session.completed, id])] };
}
export function nextReviewId(session: ReviewSession, available: string[]): string | undefined {
  const live = new Set(available), completed = new Set(session.completed);
  return session.ids.find(id => live.has(id) && !completed.has(id));
}
export function reviewProgress(session: ReviewSession | null, available: string[]) {
  if (!session) return undefined;
  const live = new Set(available), completed = new Set(session.completed);
  const remaining = session.ids.filter(id => live.has(id) && !completed.has(id)).length;
  return { current: completed.size + (remaining ? 1 : 0), total: completed.size + remaining, hasNext: remaining > 1 };
}
