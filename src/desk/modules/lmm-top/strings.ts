export const T = {
  title: "Lipa Mdogo Mdogo: top desk",
  subtitle: "Every change needs a written reason and a recent sign-in. Everything you do is written to the audit log.",
  tabs: { review: "Review", tenants: "Tenants", audit: "Audit log", leads: "Leads", stats: "Stats" },
  denied: { title: "Not available", body: "This area is only for the company's top desk." },
  reason: { label: "Why are you doing this? (at least 10 characters)", hint: "This is saved in the audit log.", confirm: "Confirm", working: "Working…", cancel: "Cancel", tooShort: "Write a reason of at least 10 characters.", tooLong: "Keep the reason under 500 characters." },
  reauth: { title: "Sign in again", demo: "Demo mode: tap to pretend you signed in again.", demoBtn: "Confirm it is me (demo)", cancel: "Cancel", cancelled: "You did not sign in again, so nothing was changed." },
  review: {
    title: "Landlord payment details to check", empty: "Nothing waiting for review.", account: "Account", reason: { name_mismatch: "Name does not match", shared_recipient: "Shared by many tenants", other: "Other" },
    tenants: "Tenants", desks: "Desks", approve: "Approve", reject: "Reject", freeze: "Freeze this recipient", approveTitle: "Approve these payment details", rejectTitle: "Reject these payment details", freezeTitle: "Freeze this recipient", done: "Done.",
  },
  tenants: {
    actions: "Top desk actions", freeze: "Put on hold", unfreeze: "Take off hold", reassign: "Move to another desk", reveal: "Show full details", update: "Change now",
    freezeTitle: "Put this tenant on hold", unfreezeTitle: "Take this tenant off hold", reassignTitle: "Move tenant to another desk", revealTitle: "Show full details", updateTitle: "Change this tenant now",
    toDesk: "New desk code (for example COG-0007)", badDesk: "Type a desk code like COG-0007.", revealPick: "What do you need to see?",
    fields: { phone: "Tenant phone", id: "Tenant ID number", landlordContact: "Landlord contact phone", landlordName: "Landlord name" },
    revealPickOne: "Pick at least one thing to show.", revealed: "Full details (they disappear soon)", hideNow: "Hide now",
    updateNote: "This applies at once. The tenant and both landlord contacts are told by SMS. No tenant code is needed.",
    newRent: "New rent (KES), leave empty to keep", newDue: "New due day, leave empty to keep", changeAccount: "Also change the landlord payment account", nothing: "Change at least one thing.",
    deskFreeze: "Freeze or unfreeze a whole desk", deskCode: "Desk code", freezeDesk: "Freeze desk", unfreezeDesk: "Unfreeze desk", ok: "Done.",
  },
  audit: {
    title: "Audit log", tenant: "Tenant id", action: "Action", anyAction: "Any action", desk: "Desk code", from: "From", to: "To", apply: "Search", verify: "Verify chain", verifying: "Checking…",
    ok: (n: number) => `OK. ${n} entries checked. The log has not been changed.`, broken: (seq: number) => `NOT OK. The chain breaks at entry number ${seq}. Tell the technical team now.`,
    when: "When", what: "What", who: "Who", summary: "Details", seq: "No.", empty: "No entries match.", badRange: "Pick a start date before the end date.", hash: "Hash",
  },
  leads: {
    title: "Leads", search: "Search landlords", all: "All", empty: "No leads here.", landlord: "Landlord", tenants: "Tenants", rent: "Rent per month", desks: "Desks", stage: "Stage", followUp: "Follow up", pms: "On Plot Yangu",
    open: "Open", contact: "Contact", name: "Name", phone: "Phone", notes: "Notes", noNotes: "No notes yet.", addNote: "Add a note", followUpDate: "Follow-up date", clearDate: "Clear date", save: "Save changes", saving: "Saving…", saved: "Saved.", nothing: "Change something first.",
  },
  stats: {
    title: "Stats", paused: "Payouts to landlords are PAUSED. No landlord is being paid until this is cleared.", disabled: "Lipa Mdogo Mdogo is switched OFF. Desks cannot add tenants and tenants cannot pay.",
    credited: "Credited this month", settled: "Paid to landlords this month", alerts: "Open alerts", queue: "Waiting for review", tenantsBy: "Tenants by status",
  },
} as const;
