// ============================================================
//  إعدادات Firebase — الصقي هنا بيانات مشروعك (راجعي README)
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyB8TtzTlGqCZnZ7V2VzIEs069J_xWNeSrg",
  authDomain: "fantasy-aqeq.firebaseapp.com",
  projectId: "fantasy-aqeq",
  storageBucket: "fantasy-aqeq.firebasestorage.app",
  messagingSenderId: "989847611026",
  appId: "1:989847611026:web:42f648801b55690aede84b",
};

// معرّف حساب المشرفة (User UID) من Firebase → Authentication → Users
// ضعيه هنا وفي ملف firestore.rules أيضًا (القواعد هي الحماية الحقيقية)
export const ADMIN_UID = "X7hlzU47gHcft6fDn6QjemcwOlt1,fCDuAii4kcXt2V8gGGVpcox2rw42";

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
