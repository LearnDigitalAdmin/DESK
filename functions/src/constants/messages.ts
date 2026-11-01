/**
 * Message Templates
 * Common messages, prompts, and confirmations in both languages.
 * Navigation is carried by buttons (see utils/ui.ts), so no message here tells the user to "reply 0".
 */

export const MESSAGES = {
  // Confirmations

  // Prompts
  ENTER_NATIONAL_ID: {
    en: 'Please enter your National ID (7-10 digits):',
    sw: 'Tafadhali ingiza Namba ya Kitambulisho cha Taifa (7-10 tarakamu):',
  },

  ENTER_TENANT_ID: {
    en: 'Enter the tenant ID to pay rent:',
    sw: 'Ingiza namba ya kitambulisho cha mpangaji ili kulipa kodi:',
  },

  SEARCHING_TENANT: {
    en: 'Searching for tenant and invoice... Please wait ⏳',
    sw: 'Inatafuta mpangaji na ankara... Tafadhali subiri ⏳',
  },

  TENANT_NOT_FOUND: {
    en: 'Tenant not found. Please check the ID and try again.',
    sw: 'Mpangaji hajapatikana. Tafadhali angalia namba na ujaribu tena.',
  },

  INVOICE_NOT_FOUND: {
    en: 'No invoice or rent amount found for this tenant.',
    sw: 'Hakuna ankara au kiasi cha kodi kwa mpangaji huyu.',
  },

  ENTER_MPESA_PHONE: {
    en: 'Enter your M-Pesa phone number (07XXXXXXXX):',
    sw: 'Ingiza namba ya simu ya M-Pesa (07XXXXXXXX):',
  },

  ENTER_PAYMENT_AMOUNT: {
    en: 'How much would you like to pay? Enter an amount (maximum {outstanding}), or tap *Pay full amount*.',
    sw: 'Unataka kulipa kiasi gani? Ingiza kiasi (kiwango cha juu {outstanding}), au gusa *Lipa kiasi chote*.',
  },

  INVALID_AMOUNT_EXCEEDS: {
    en: 'Amount cannot exceed outstanding balance of {outstanding}',
    sw: 'Kiasi hakiwezi kuzidi {outstanding}',
  },

  ENTER_AMOUNT: {
    en: 'Enter the amount (in KES):',
    sw: 'Ingiza kiasi (kwa KES):',
  },

  ENTER_DESCRIPTION: {
    en: 'Enter description (optional):',
    sw: 'Ingiza maelezo (isimu):',
  },

  // Success messages

  // Error messages
  INVALID_ID: {
    en: 'Invalid National ID. Please enter a valid ID (7-10 digits):',
    sw: 'Namba ya kitambulisho si sahihi. Tafadhali ingiza namba sahihi (7-10 tarakamu):',
  },

  INVALID_PHONE: {
    en: 'Invalid phone number. Please enter a valid Kenyan number (07XXXXXXXX):',
    sw: 'Namba ya simu si sahihi. Tafadhali ingiza namba ya Kenya (07XXXXXXXX):',
  },

  INVALID_AMOUNT: {
    en: 'Invalid amount. Please enter a number between 10 and 1,000,000:',
    sw: 'Kiasi si sahihi. Tafadhali ingiza namba kati ya 10 na 1,000,000:',
  },

  PAYMENT_FAILED: {
    en: 'Payment failed. Please try again or contact support.',
    sw: 'Malipo yameshindwa. Tafadhali jaribu tena au wasiliana na msaada.',
  },

  PAYMENT_SUCCESS: {
    en: 'Payment successful! ✅\n\nTransaction ID: {transactionId}\nAmount: Ksh {amount}\nTime: {time}',
    sw: 'Malipo yamefanikiwa! ✅\n\nNamba ya Muamala: {transactionId}\nKiasi: Ksh {amount}\nWakati: {time}',
  },

  // Invalid input
  INVALID_INPUT: {
    en: 'Invalid input. Please try again.',
    sw: 'Ingizo si sahihi. Tafadhali jaribu tena.',
  },

  // Generic errors
  SYSTEM_ERROR: {
    en: 'An error occurred. Please try again later or contact support.',
    sw: 'Kulikuwa na hitilafu. Tafadhali jaribu baadaye au wasiliana na msaada.',
  },

  // Session timeout
  SESSION_EXPIRED: {
    en: 'Your session has expired. Please start over by sending any message.',
    sw: 'Kipindi chako kinatamatisha. Tafadhali anza upya kwa kutuma ujumbe wowote.',
  },

  // ── Pay Rent ──
  TENANT_FOUND: {
    en: '*Tenant found* 🎯\n\n👤 Name: {name}\n💰 Outstanding: {outstanding}\n📅 Billing: {billing}\n\nContinue to pay this invoice?',
    sw: '*Mpangaji amepatikana* 🎯\n\n👤 Jina: {name}\n💰 Kiasi kinachodaiwa: {outstanding}\n📅 Mwezi wa bili: {billing}\n\nUngependa kuendelea kulipa ankara hii?',
  },

  // Lipa Mos Mos: pay rent a little at a time
  LMM_INTRO: {
    en: '*Lipa Mos Mos* 🪙\n\nPay your rent a little at a time. You owe {due}. Your landlord is paid when it is fully covered, or on {settles}. A small fee (2.5%, or 5% on payments under KES 100) is added to each payment.\n\nHow often would you like to pay?',
    sw: '*Lipa Mos Mos* 🪙\n\nLipa kodi yako kidogo kidogo. Unadaiwa {due}. Mwenye nyumba analipwa kodi ikikamilika, au tarehe {settles}. Ada ndogo (2.5%, au 5% kwa malipo chini ya KES 100) huongezwa kwa kila malipo.\n\nUngependa kulipa mara ngapi?',
  },

  LMM_STATUS: {
    en: '*Lipa Mos Mos* 🪙\n\n💰 Paid: {paid} of {due}\n📊 Progress: {pct}%\n⚖️ Balance: {balance}\n📅 Landlord is paid by: {settles}\n🔁 Plan: {freq}',
    sw: '*Lipa Mos Mos* 🪙\n\n💰 Umelipa: {paid} kati ya {due}\n📊 Maendeleo: {pct}%\n⚖️ Salio: {balance}\n📅 Mwenye nyumba analipwa kufikia: {settles}\n🔁 Mpango: {freq}',
  },

  LMM_ASK_AMOUNT: {
    en: 'How much would you like to pay now? Enter a whole-shilling amount (KES 10 to {max}). Suggested: {suggested}.',
    sw: 'Ungependa kulipa kiasi gani sasa? Ingiza kiasi cha shilingi kamili (KES 10 hadi {max}). Inapendekezwa: {suggested}.',
  },

  LMM_INVALID_AMOUNT: {
    en: 'Please enter a whole-shilling amount between KES 10 and {max}.',
    sw: 'Tafadhali ingiza kiasi cha shilingi kamili kati ya KES 10 na {max}.',
  },

  LMM_SUMMARY: {
    en: '*Payment summary* 💳\n\n🏠 To your rent: {credit}\n➕ Fee ({pct}%): {fee}\n💵 You pay: {total}\n📱 M-Pesa number: {phone}\n\nTap *Confirm* to send the M-Pesa prompt.',
    sw: '*Muhtasari wa malipo* 💳\n\n🏠 Kwa kodi yako: {credit}\n➕ Ada ({pct}%): {fee}\n💵 Unalipa: {total}\n📱 Namba ya M-Pesa: {phone}\n\nGusa *Thibitisha* kutuma ombi la M-Pesa.',
  },

  LMM_SENT: {
    en: 'Check your phone for the M-Pesa prompt and enter your PIN. We will text you when it is received. 📲',
    sw: 'Angalia simu yako kwa ombi la M-Pesa kisha weka PIN yako. Tutakutumia ujumbe likipokelewa. 📲',
  },

  LMM_UNAVAILABLE: {
    en: '*Lipa Mos Mos* is not available right now.\n\n{reason}',
    sw: '*Lipa Mos Mos* haipatikani kwa sasa.\n\n{reason}',
  },

  LMM_ERROR: {
    en: 'We could not complete that: {reason}',
    sw: 'Hatukuweza kukamilisha hilo: {reason}',
  },

  PAY_SUMMARY: {
    en: '*Payment summary* 💳\n\n💰 Amount: {amount}\n📱 M-Pesa number: {phone}\n\nTap *Confirm* to send the M-Pesa prompt.',
    sw: '*Muhtasari wa malipo* 💳\n\n💰 Kiasi: {amount}\n📱 Namba ya M-Pesa: {phone}\n\nGusa *Thibitisha* kutuma ombi la M-Pesa.',
  },

  PAY_NOT_AVAILABLE: {
    en: '*Payment not available* ⚠️\n\nOnline payment is currently unavailable for this property.\n\n📱 Please contact the property manager:\n*{name}*\n📞 {phone}\n\nThey will help you complete the payment.',
    sw: '*Malipo hayapatikani* ⚠️\n\nMalipo ya mtandaoni hayapatikani kwa sasa kwa mali hii.\n\n📱 Tafadhali wasiliana na msimamizi wa mali:\n*{name}*\n📞 {phone}\n\nWatakusaidia kukamilisha malipo.',
  },

  PAY_FAILED_DETAIL: {
    en: '*Payment failed* ❌\n\n{reason}\n\nPlease try again later or contact support.',
    sw: '*Malipo yameshindwa* ❌\n\n{reason}\n\nTafadhali jaribu tena baadaye au wasiliana na msaada.',
  },

  PAY_FAILED_UNEXPECTED: {
    en: '*Payment failed* ❌\n\nAn unexpected error occurred. Please try again later.',
    sw: '*Malipo yameshindwa* ❌\n\nKumetokea hitilafu isiyotarajiwa. Tafadhali jaribu tena baadaye.',
  },

  PAY_INITIATED: {
    en: '*Payment initiated* ✅\n\n💰 Amount: {amount}\n👤 Tenant: {name}\n📱 Phone: {phone}\n📅 Date: {date}\n\n*Reference:* {reference}\n\n📲 You will receive an M-Pesa prompt shortly. Enter your M-Pesa PIN to complete the payment. Your invoice updates automatically once the payment is confirmed.',
    sw: '*Malipo yameanzishwa* ✅\n\n💰 Kiasi: {amount}\n👤 Mpangaji: {name}\n📱 Simu: {phone}\n📅 Tarehe: {date}\n\n*Kumbukumbu:* {reference}\n\n📲 Utapokea ombi la M-Pesa hivi punde. Weka PIN yako ya M-Pesa kukamilisha malipo. Ankara yako itasasishwa kiotomatiki malipo yakithibitishwa.',
  },

  // ── Invoice ──
  INVOICE_DETAILS: {
    en: '*Invoice* 📄\n\n👤 Tenant: {name}\n📅 Billing month: {billing}\n\n💰 Rent: {rent}\n💧 Water: {water}\n⚡ Power: {power}\n🏷️ Other: {other}\n📊 Total: {total}\n✅ Paid: {paid}\n⏳ Outstanding: {outstanding}',
    sw: '*Ankara* 📄\n\n👤 Mpangaji: {name}\n📅 Mwezi wa bili: {billing}\n\n💰 Kodi: {rent}\n💧 Maji: {water}\n⚡ Umeme: {power}\n🏷️ Mengineyo: {other}\n📊 Jumla: {total}\n✅ Imelipwa: {paid}\n⏳ Inayobaki: {outstanding}',
  },

  INVOICE_DUE: { en: '\n📆 Due date: {date}', sw: '\n📆 Tarehe ya mwisho: {date}' },
  INVOICE_PAID_ON: { en: '\n✔️ Paid on: {date}', sw: '\n✔️ Ililipwa tarehe: {date}' },
  INVOICE_PDF: { en: '\n\n📥 *Download invoice:*\n{url}', sw: '\n\n📥 *Pakua ankara:*\n{url}' },
  INVOICE_NO_PDF: { en: '\n\n⚠️ The PDF has not been generated yet.', sw: '\n\n⚠️ PDF bado haijatengenezwa.' },

  // Thank you / goodbye
  GOODBYE: {
    en: 'Thank you for using SAMUHIA! See you soon. 👋',
    sw: 'Asante kwa kutumia SAMUHIA! Tutaonana karibuni. 👋',
  },
};

export function getMessage(key: keyof typeof MESSAGES, language: 'en' | 'sw', replacements?: Record<string, string>): string {
  let text = MESSAGES[key]?.[language] || `Message not found: ${key}`;

  if (replacements) {
    Object.entries(replacements).forEach(([key, value]) => {
      // split/join: replaces every occurrence and never interprets `$&` / `$1` inside a value (names, URLs)
      text = text.split(`{${key}}`).join(value);
    });
  }

  return text;
}
