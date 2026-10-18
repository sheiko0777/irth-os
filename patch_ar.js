const fs = require('fs');
const ar = JSON.parse(fs.readFileSync('apps/admin/src/messages/ar.json', 'utf8'));

if (!ar.orders.detail.createReturn) {
    ar.orders.detail.createReturn = {
        "title": "إنشاء مرتجع",
        "action": "إنشاء مرتجع",
        "reason": "السبب",
        "reason_damaged": "تالف",
        "reason_wrong_item": "منتج خاطئ",
        "reason_not_as_described": "غير مطابق للوصف",
        "reason_changed_mind": "تغيير رأي",
        "reason_other": "أخرى",
        "resolution": "الحل",
        "resolution_refund": "استرداد",
        "resolution_exchange": "استبدال",
        "resolution_store_credit": "رصيد في المتجر",
        "resolution_none": "لا شيء",
        "condition": "الحالة",
        "condition_new": "جديد",
        "condition_good": "جيد",
        "condition_damaged": "تالف",
        "condition_unknown": "غير معروف",
        "notes": "ملاحظات",
        "notesPlaceholder": "ملاحظات اختيارية...",
        "submit": "تقديم المرتجع",
        "submitting": "جاري التقديم...",
        "success": "تم إنشاء المرتجع بنجاح",
        "errorEmpty": "يرجى اختيار عنصر واحد على الأقل للارجاع."
    };
}

if (!ar.returns) {
    ar.returns = {
        "restock": "إضافة للمخزون",
        "restocking": "جاري الإضافة...",
        "restocked": "تمت الإضافة",
        "restockSuccess": "تمت إضافة المنتج للمخزون بنجاح",
        "restockError": "حدث خطأ أثناء الإضافة للمخزون",
        "conditionHint": "مستبعد من المخزون القابل للبيع"
    };
}

fs.writeFileSync('apps/admin/src/messages/ar.json', JSON.stringify(ar, null, 2));
