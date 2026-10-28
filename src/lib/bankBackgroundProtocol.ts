export const bankBackgroundName = '銀行背景記帳';
export const richartBackgroundName = 'Richart 背景記帳';
export const bankBackgroundEndpoint = 'https://expense-bank-background.poetes-wine-catalog.workers.dev';
export const bankBackgroundSetupMarker = 'expense-bank-background:';
export const bankBackgroundInstallUrl = 'https://www.icloud.com/shortcuts/8648f008f0e94bcdaf81d487cbc16ae8';
export const richartBackgroundInstallUrl = 'https://www.icloud.com/shortcuts/43a2030779cc4fb188f72c1132773e80';

export function backgroundSetupUrl(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('背景綁定資料不完整，請重新綁定');
  const url = new URL('shortcuts://run-shortcut');
  url.searchParams.set('name', bankBackgroundName);
  url.searchParams.set('input', 'text');
  // A local handoff to Apple Shortcuts; no credential in a web URL.
  url.searchParams.set('text', bankBackgroundSetupMarker + JSON.stringify({ version: 1, endpoint: bankBackgroundEndpoint + '/capture', token }));
  return url.href;
}
