// ============================================================
//  إعدادات Firebase — الصقي هنا بيانات مشروعك (راجعي README)
// ============================================================
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// معرّف حساب المشرفة (User UID) من Firebase → Authentication → Users
// ضعيه هنا وفي ملف firestore.rules أيضًا (القواعد هي الحماية الحقيقية)
export const ADMIN_UID = "";

// قواعد اللعبة — إذا غيّرتِها غيّري نفس القيم في firestore.rules
export const RULES = {
  budget: 40,
  starters: 5,
  bench: 1,
  maxPerClub: 3,
  formations: {
    '2-1-1': { gk: 1, def: 2, mid: 1, fwd: 1 },
    '1-2-1': { gk: 1, def: 1, mid: 2, fwd: 1 },
    '1-1-2': { gk: 1, def: 1, mid: 1, fwd: 2 },
  },
};
