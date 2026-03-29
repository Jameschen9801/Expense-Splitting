export const GOOGLE_SHEET_API_URL = "https://script.google.com/macros/s/AKfycbwzr8dVSp_aSMPwQPDKNWQz_djy4ledAY325_5rD7-Hp1kndNjed_ejGn63SWTX_nnX/exec";

// 讀取試算表資料 
export async function fetchSheetData(): Promise<any[]> {
  try {
    const res = await fetch(GOOGLE_SHEET_API_URL);
    if (!res.ok) throw new Error("取得資料失敗");
    return await res.json();
  } catch (error) {
    console.error(error);
    return [];
  }
}

// 寫入一筆新資料到試算表
export async function appendRowToSheet(data: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(GOOGLE_SHEET_API_URL, {
      method: "POST",
      // 將請求模式切為 no-cors，否則從本機發 POST 會被跨域安全機制擋下（Google Apps Script 特性）
      // 注意：使用 no-cors 時無法讀取回推結果 (res.json() 會無效)，只能硬吃 200 HTTP Header
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      // GAS 的 POST 必須搭配字串化的 JSON 傳送，GAS 才能用 e.postData.contents 解開
      body: JSON.stringify(data),
    });
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}
