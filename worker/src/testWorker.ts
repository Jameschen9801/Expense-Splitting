import worker from './index';

// Intercept only the model call in the local integration test Worker.
const network = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith('https://generativelanguage.googleapis.com/')) return network(input, init);
  if (new Headers(init?.headers).get('x-goog-api-key') !== 'test-double') return new Response(null, { status: 403 });
  const payload = JSON.parse(JSON.parse(String(init?.body)).contents[0].parts[0].text);
  if (payload.merchant === '暫無回覆商店') return new Response(null, { status: 503 });
  const desc = payload.merchant + (payload.habits.length ? '（有歷史分類）' : '消費');
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ category: 'shopping', desc }) }] } }] });
};

export default worker;
