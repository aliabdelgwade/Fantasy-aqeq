# Aqeq League — فانتازي مدارس العقيق

موقع يعمل على **GitHub Pages** أو أي استضافة مواقع عادية، بدون خادم وبدون Render.
- **أي زائر:** يشاهد اللاعبين والترتيب بدون دخول.
- **لحفظ فريق:** يدخل الزائر بحساب **Google**، فيبقى فريقه محفوظًا ويعدّله من أي جهاز.
- **المشرفة:** تدخل بحسابها في Google، فيظهر لها زر "+ إضافة لاعب" وأزرار التعديل والحذف.

البيانات تُحفظ في **Firebase**، وهي خدمة مجانية من Google. ملف `firestore.rules` يحمي البيانات: لا يستطيع أحد غير المشرفة تعديل اللاعبين، حتى لو عدّل كود الصفحة.

---

## الخطوة 1: إنشاء مشروع Firebase (مرة واحدة، مجاني)

1. ادخلي على console.firebase.google.com ← **Add project** ← اكتبي `aqeq-league` ← Create.
2. **ربط الموقع:** من الصفحة الرئيسية للمشروع اضغطي أيقونة الويب `</>` ← سمّيه `aqeq` ← Register.
   ستظهر لك بيانات `firebaseConfig`، انسخيها والصقيها في ملف **`firebase-config.js`**.
3. **قاعدة البيانات:** من القائمة **Build → Firestore Database** ← Create database ← اختاري موقعًا قريبًا ← **Production mode**.
4. **الدخول بـ Google:** من **Build → Authentication** ← Get started ← تبويب **Sign-in method** ← **Google** ← Enable ← اختاري بريد الدعم ← Save.
5. أكملي الخطوة 7 الآن (لصق القواعد)، ثم انشري الموقع (الخطوة 2)، وارجعي هنا بعد ذلك.
6. **حساب المشرفة:** افتحي موقعك واضغطي **"الدخول بـ Google"** بحسابك أنتِ.
   ثم في Firebase ← **Authentication → Users** ستجدين بريدك، فانسخي **User UID** (الرمز الطويل بجانبه).
   **ضعي الـ UID في مكانين:**
   - في `firebase-config.js` داخل `ADMIN_UID = "..."`.
   - في `firestore.rules` مكان `PUT_ADMIN_UID_HERE`، ثم انشري القواعد مرة أخرى.

   بعدها ارفعي `firebase-config.js` المعدّل على GitHub وحدّثي الصفحة، وسيظهر لك 👑 المشرف.
7. **قواعد الحماية:** في **Firestore Database → Rules** احذفي الموجود، والصقي محتوى `firestore.rules` كاملًا، ثم **Publish**.

## الخطوة 2: نشر الموقع على GitHub Pages

1. أنشئي مستودعًا جديدًا على GitHub باسم `aqeq-league` وليكن **Public**.
2. ارفعي كل الملفات (`index.html` و`app.js` و`styles.css` و`firebase-config.js` و`logo.webp` و`favicon.png`) في الصفحة الرئيسية للمستودع، أي ليست داخل مجلد.
3. **Settings → Pages** ← Source: **Deploy from a branch** ← Branch: `main` / `(root)` ← Save.
4. بعد دقيقة يظهر الرابط: `https://اسمك.github.io/aqeq-league/`
5. **مهم:** ارجعي إلى Firebase ← **Authentication → Settings → Authorized domains** ← Add domain ← اكتبي `اسمك.github.io`.

> **على استضافة عادية:** ارفعي نفس الملفات إلى مجلد الموقع (مثل `public_html`)، وأضيفي نطاق موقعك في Authorized domains.

## دخول المشرفة
اضغطي **"الدخول بـ Google"** في أعلى الصفحة بحسابك. أي حساب Google آخر يدخل كزائر عادي فقط.

## أسئلة شائعة
- **هل وجود بيانات Firebase في الملف خطر؟** لا. هذه البيانات ليست سرية، ووجودها في صفحات الويب طبيعي. الحماية الحقيقية في قواعد `firestore.rules`.
- **هل يرى الناس بريد الزائر؟** لا. لا يُحفظ في الترتيب إلا اسم الفريق.
- **تغيير القواعد (الميزانية أو الخطط):** غيّريها في `firebase-config.js` **وفي** `firestore.rules`، ثم انشري القواعد من جديد.
- **الحد المجاني:** 50 ألف قراءة يوميًا، وهذا يكفي لمدرسة بسهولة.
