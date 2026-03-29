export interface Group {
  code: string;
  name: string;
  members: string[];
  expenses: Expense[];
  transfers: Transfer[];
  createdAt: number;
}

export interface Expense {
  id: string;
  desc: string;
  amount: number;
  payer: string;
  participants: string[];
  splitMode: 'equal' | 'custom' | 'percent';
  shares?: Share[];
  date: string;
  createdAt: number;
}

export interface Share {
  name: string;
  amount: number;
}

export interface Transfer {
  id: string;
  from: string;
  to: string;
  amount: number;
  note?: string;
  date: string;
  createdAt: number;
}

export interface MyGroup {
  code: string;
  name: string;
  myName: string;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}
