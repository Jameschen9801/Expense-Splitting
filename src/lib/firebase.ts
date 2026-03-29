import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, get, child } from "firebase/database";
import { Group } from '../types';

const firebaseConfig = {
  apiKey: "AIzaSyBTPJD4CLjBsU5yQqjuiwXi1rwAZNF_bo0",
  authDomain: "expense-splitting-a9b78.firebaseapp.com",
  databaseURL: "https://expense-splitting-a9b78-default-rtdb.firebaseio.com",
  projectId: "expense-splitting-a9b78",
  storageBucket: "expense-splitting-a9b78.firebasestorage.app",
  messagingSenderId: "259563826188",
  appId: "1:259563826188:web:aeab760813e231e2d85229",
  measurementId: "G-0P2867E9JD"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// 即時監聽群組雲端資料
export const subscribeToGroup = (groupCode: string, onUpdate: (data: Group | null) => void) => {
  const groupRef = ref(database, 'groups/' + groupCode);
  const unsubscribe = onValue(groupRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        // Firebase realtime db 如果裡面的 array (expenses/transfers) 為空會抓不回來，所以預設為空陣列
        if (!data.expenses) data.expenses = [];
        if (!data.transfers) data.transfers = [];
        if (!data.members) data.members = [];
    }
    onUpdate(data);
  });
  return unsubscribe;
};

// 一次性讀取群組資料（遠端加入用）
export const fetchGroupOnce = async (groupCode: string): Promise<Group | null> => {
  const dbRef = ref(database);
  const snapshot = await get(child(dbRef, `groups/${groupCode}`));
  if (snapshot.exists()) {
    const data = snapshot.val() as Group;
    if (!data.expenses) data.expenses = [];
    if (!data.transfers) data.transfers = [];
    if (!data.members) data.members = [];
    return data;
  }
  return null;
}

// 將資料覆寫到雲端
export const syncGroupToCloud = async (groupCode: string, groupData: Group) => {
  const groupRef = ref(database, 'groups/' + groupCode);
  await set(groupRef, groupData);
};
