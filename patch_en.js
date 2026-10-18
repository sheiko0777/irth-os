const fs = require('fs');
const en = JSON.parse(fs.readFileSync('apps/admin/src/messages/en.json', 'utf8'));

if (!en.orders.detail.createReturn) {
    en.orders.detail.createReturn = {
        "title": "Create return",
        "action": "Create Return",
        "reason": "Reason",
        "reason_damaged": "Damaged",
        "reason_wrong_item": "Wrong item",
        "reason_not_as_described": "Not as described",
        "reason_changed_mind": "Changed mind",
        "reason_other": "Other",
        "resolution": "Resolution",
        "resolution_refund": "Refund",
        "resolution_exchange": "Exchange",
        "resolution_store_credit": "Store credit",
        "resolution_none": "None",
        "condition": "Condition",
        "condition_new": "New",
        "condition_good": "Good",
        "condition_damaged": "Damaged",
        "condition_unknown": "Unknown",
        "notes": "Notes",
        "notesPlaceholder": "Optional notes...",
        "submit": "Submit return",
        "submitting": "Submitting...",
        "success": "Return created successfully",
        "errorEmpty": "Please select at least one item to return."
    };
}

if (!en.returns) {
    en.returns = {
        "restock": "Restock",
        "restocking": "Restocking...",
        "restocked": "Restocked",
        "restockSuccess": "Item restocked successfully",
        "restockError": "Error restocking item",
        "conditionHint": "Held out of sellable stock"
    };
}

fs.writeFileSync('apps/admin/src/messages/en.json', JSON.stringify(en, null, 2));
