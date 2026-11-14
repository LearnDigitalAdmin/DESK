/**
 * Landlord Watch: every user-facing string, English + Kiswahili.
 * Swahili follows the contract glossary (Mpangaji, Kodi, Taarifa, Kamisheni, Salio, Amelipa / Hajalipa,
 * Nambari ya uthibitisho, Fungua maelezo ...). "Landlord Watch" is kept as the product name in both languages.
 * Money is never formatted here: values come from the server's `d` strings and are passed in as params.
 */

import { Lang, LwErrorCode } from '../types/watch.types';
import { fill } from '../utils/watch.format';

type Bi = { en: string; sw: string };

// ── Button / list-row labels (WhatsApp limits: button 20, row title 24, row description 72, list button 20) ──

export const WATCH_LABELS = {
  // watch menu rows
  ROW_SUMMARY: { en: 'Summary', sw: 'Muhtasari' },
  ROW_PAID: { en: 'Who has paid', sw: 'Waliolipa' },
  ROW_UNPAID: { en: "Who hasn't paid", sw: 'Wasiolipa' },
  ROW_MONEY: { en: 'Money breakdown', sw: 'Mgawanyo wa pesa' },
  ROW_MONTHS: { en: 'Other months', sw: 'Miezi mingine' },
  ROW_TRANSCRIPT: { en: 'Transcript (PDF)', sw: 'Taarifa (PDF)' },
  ROW_REPORT: { en: 'Tax report (MRI)', sw: 'Ripoti ya kodi (MRI)' },
  ROW_PROPS: { en: 'Properties', sw: 'Mali zangu' },
  ROW_UNLOCK: { en: 'Unlock details', sw: 'Fungua maelezo' },
  ROW_SETTINGS: { en: 'Language & help', sw: 'Lugha na msaada' },
  ROW_MAIN: { en: 'Main menu', sw: 'Menyu kuu' },
  DESC_SUMMARY: { en: 'Tenants, billed, collected, what you get', sw: 'Wapangaji, madai, makusanyo, kiasi chako' },
  DESC_PAID: { en: 'Tenants who paid in full', sw: 'Wapangaji waliolipa kikamilifu' },
  DESC_UNPAID: { en: 'Not paid or partly paid', sw: 'Hawajalipa au wamelipa sehemu' },
  DESC_MONEY: { en: 'Commission and the agent statement', sw: 'Kamisheni na taarifa ya wakala' },
  DESC_MONTHS: { en: 'Pick a month or see 6 months', sw: 'Chagua mwezi au ona miezi 6' },
  DESC_TRANSCRIPT: { en: 'Download the monthly statement', sw: 'Pakua taarifa ya mwezi' },
  DESC_REPORT: { en: 'MRI working paper or annual summary (PDF)', sw: 'Karatasi ya MRI au muhtasari wa mwaka (PDF)' },
  DESC_PROPS: { en: 'Switch, add or disconnect', sw: 'Badilisha, ongeza au tenganisha' },
  DESC_UNLOCK: { en: 'Show tenant names and phones', sw: 'Onyesha majina na namba za wapangaji' },
  DESC_SETTINGS: { en: 'Change language, get help', sw: 'Badilisha lugha, pata msaada' },
  DESC_MAIN: { en: 'Back to the SAMUHIA menu', sw: 'Rudi kwenye menyu ya SAMUHIA' },
  LIST_BUTTON: { en: 'Choose', sw: 'Chagua' },
  // buttons
  YES: { en: 'Yes', sw: 'Ndiyo' },
  NO: { en: 'No', sw: 'Hapana' },
  NEXT: { en: 'Next ›', sw: 'Inayofuata ›' },
  PREV: { en: '‹ Previous', sw: '‹ Iliyopita' },
  WATCH_MENU: { en: 'Watch menu', sw: 'Menyu ya Watch' },
  MAIN: { en: 'Main menu', sw: 'Menyu kuu' },
  UNLOCK: { en: 'Unlock details', sw: 'Fungua maelezo' },
  SEND_CODE: { en: 'Send code', sw: 'Tuma nambari' },
  RESEND: { en: 'Resend code', sw: 'Tuma tena' },
  CANCEL: { en: 'Cancel', sw: 'Ghairi' },
  CHECK_STATUS: { en: 'Check status', sw: 'Angalia hali' },
  MY_NUMBER: { en: 'My number', sw: 'Nambari yangu' },
  OTHER_NUMBER: { en: 'Another number', sw: 'Nambari nyingine' },
  SEND_AGAIN: { en: 'Send again', sw: 'Tuma tena' },
  NEW_ONE: { en: 'Make a new one', sw: 'Tengeneza mpya' },
  TRY_AGAIN: { en: 'Try again', sw: 'Jaribu tena' },
  ADD_PROPERTY: { en: 'Add property', sw: 'Ongeza mali' },
  DISCONNECT: { en: 'Disconnect', sw: 'Tenganisha' },
  TREND: { en: 'Last 6 months', sw: 'Miezi 6 iliyopita' },
  ENGLISH: { en: 'English', sw: 'English' },
  KISWAHILI: { en: 'Kiswahili', sw: 'Kiswahili' },
  HELP: { en: 'Help', sw: 'Msaada' },
  MORE_PROPS: { en: 'More properties ›', sw: 'Mali zaidi ›' },
  MORE_MONTHS: { en: 'More months ›', sw: 'Miezi zaidi ›' },
  RP_MRI: { en: 'MRI working paper', sw: 'Karatasi ya MRI' },
  RP_ANNUAL: { en: 'Annual summary', sw: 'Muhtasari wa mwaka' },
  RP_GET_FREE: { en: 'Get free report', sw: 'Pata ripoti bure' },
} satisfies Record<string, Bi>;

export type WatchLabelKey = keyof typeof WATCH_LABELS;

export function wlabel(key: WatchLabelKey, lang: Lang): string {
  return WATCH_LABELS[key][lang];
}

// ── Messages ─────────────────────────────────────────────────────────────

export const WATCH_MESSAGES = {
  INTRO_ADD: {
    en: '🏠 *Landlord Watch*\nSee how your property is doing: rent billed, collected and pending, and what you receive after the agent\'s commission.\n\nEnter your *Owner ID* (it looks like PYP-0001):\n\n_Reply 0 to go back, # for the main menu._',
    sw: '🏠 *Landlord Watch* – Fuatilia mali yako\nOna hali ya mali yako: kodi iliyodaiwa, iliyokusanywa na inayosubiriwa, pamoja na kiasi chako baada ya kamisheni ya wakala.\n\nIngiza *Owner ID* yako (inaonekana hivi: PYP-0001):\n\n_Jibu 0 kurudi, # kwenda Menyu kuu._',
  },
  ASK_ID_AGAIN: {
    en: 'Enter the *Owner ID* of the property (for example PYP-0001):\n\n_Reply 0 to go back, # for the main menu._',
    sw: 'Ingiza *Owner ID* ya mali (mfano PYP-0001):\n\n_Jibu 0 kurudi, # kwenda Menyu kuu._',
  },
  BAD_ID: {
    en: 'That doesn\'t look like an Owner ID. It should look like PYP-0001. Please try again.',
    sw: 'Hiyo si Owner ID sahihi. Inapaswa kuonekana hivi: PYP-0001. Tafadhali jaribu tena.',
  },
  CHECKING: { en: 'Checking… please wait ⏳', sw: 'Inakagua… tafadhali subiri ⏳' },
  CONFIRM_PROPERTY: {
    en: 'Is this your property?\n\n🏢 *{name}*{addressLine}\nID: {ownerId}',
    sw: 'Je, hii ndiyo mali yako?\n\n🏢 *{name}*{addressLine}\nID: {ownerId}',
  },
  CONFIRM_REPROMPT: {
    en: 'Please tap *Yes* to connect {ownerId}, or *No* to cancel.',
    sw: 'Tafadhali gusa *Ndiyo* kuunganisha {ownerId}, au *Hapana* kughairi.',
  },
  CONNECTED: { en: '✅ Connected: *{name}*', sw: '✅ Imeunganishwa: *{name}*' },
  NOT_CONNECTED: {
    en: 'OK, nothing was connected. Enter another Owner ID, or reply 0 to go back.',
    sw: 'Sawa, hakuna kilichounganishwa. Ingiza Owner ID nyingine, au jibu 0 kurudi.',
  },
  DISCONNECT_CONFIRM: {
    en: 'Disconnect *{name}* ({ownerId})? You can connect it again later with its Owner ID.',
    sw: 'Tenganisha *{name}* ({ownerId})? Unaweza kuiunganisha tena baadaye kwa Owner ID yake.',
  },
  DISCONNECTED: { en: '✅ Disconnected: {ownerId}', sw: '✅ Imetenganishwa: {ownerId}' },
  PICK_PROPERTY: {
    en: 'Which property do you want to watch? ({n} connected)',
    sw: 'Ungependa kufuatilia mali ipi? (zilizounganishwa: {n})',
  },
  PICK_DISCONNECT: {
    en: 'Which property do you want to disconnect?',
    sw: 'Ungependa kutenganisha mali ipi?',
  },
  PROPS_HEADER: {
    en: '🏢 *Your properties* ({n})\nTap one to watch it, or add / disconnect.',
    sw: '🏢 *Mali zako* ({n})\nGusa moja kuifuatilia, au ongeza / tenganisha.',
  },
  NO_PROPERTIES: {
    en: 'You have no connected properties yet.',
    sw: 'Bado huna mali zilizounganishwa.',
  },

  MENU_BODY: {
    en: '🏢 *{name}*{addressLine}\n📅 {month}\n{lock}\n\nWhat would you like to see?',
    sw: '🏢 *{name}*{addressLine}\n📅 {month}\n{lock}\n\nUngependa kuona nini?',
  },
  LOCK_OPEN: { en: '🔓 Tenant names and phones: visible', sw: '🔓 Majina na namba za wapangaji: zinaonekana' },
  LOCK_HIDDEN: { en: '🔒 Tenant names and phones: hidden', sw: '🔒 Majina na namba za wapangaji: zimefichwa' },

  SUMMARY: {
    en:
      '📊 *{name}* · {month}\n\n' +
      '👥 Tenants: {active} · Units occupied: {occupied} · Vacant: {vacant} · Occupancy: {occupancy}\n' +
      '🧾 Billed: {billed}\n' +
      '✅ Collected: {collected} ({rate})\n' +
      '⏳ Pending: {pending}\n' +
      '🤝 Commission ({commissionRate} of base rent): {commission}\n' +
      '💰 *Net amount to you* (after commission): {net}\n' +
      '📈 *Still to receive*: {stillToReceive}\n' +
      '📅 Due to you by {dueDate}: {netByDue} · after that date: {netAfterDue}',
    sw:
      '📊 *{name}* · {month}\n\n' +
      '👥 Wapangaji: {active} · Vyumba vilivyopangishwa: {occupied} · Vitupu: {vacant} · Kiwango cha upangaji: {occupancy}\n' +
      '🧾 Imedaiwa: {billed}\n' +
      '✅ Iliyokusanywa: {collected} ({rate})\n' +
      '⏳ Inayosubiriwa: {pending}\n' +
      '🤝 Kamisheni ({commissionRate} ya kodi ya msingi): {commission}\n' +
      '💰 *Kiasi chako baada ya kamisheni*: {net}\n' +
      '📈 *Bado utapokea*: {stillToReceive}\n' +
      '📅 Unastahili kupokea hadi {dueDate}: {netByDue} · baada ya tarehe hiyo: {netAfterDue}',
  },
  ESTIMATE_NOTE: {
    en: 'ℹ️ Estimate: the agent has not issued this statement yet.',
    sw: 'ℹ️ Makadirio: wakala bado hajatoa taarifa ya mwezi huu.',
  },
  HIDDEN_NOTE: {
    en: '🔒 Tenant names and phones are hidden. Tap *Unlock details* to see them.',
    sw: '🔒 Majina na namba za wapangaji zimefichwa. Gusa *Fungua maelezo* kuziona.',
  },

  PAID_HEADER: { en: '✅ *Who has paid* · {month} ({count})', sw: '✅ *Waliolipa* · {month} ({count})' },
  UNPAID_HEADER: {
    en: '⏳ *Who has not paid* (including part payments) · {month} ({count})',
    sw: '⏳ *Ambao hawajalipa* (pamoja na waliolipa sehemu) · {month} ({count})',
  },
  EMPTY_PAID: { en: 'Nobody has paid in full yet for this month.', sw: 'Bado hakuna aliyelipa kikamilifu mwezi huu.' },
  EMPTY_UNPAID: { en: '🎉 Everyone with an invoice has paid in full.', sw: '🎉 Kila mwenye ankara amelipa kikamilifu.' },
  NO_INVOICE_NOTE: { en: 'No invoice yet: {count}', sw: 'Hawana ankara bado: {count}' },
  PAGE_FOOTER: { en: 'Page {page} of {pages}', sw: 'Ukurasa {page} kati ya {pages}' },
  ROW_PAID: {
    en: '{n}. {who}\n    {phone} · {paid}{paidOn}{timing}',
    sw: '{n}. {who}\n    {phone} · {paid}{paidOn}{timing}',
  },
  PAID_ON: { en: ' · paid {date}', sw: ' · alilipa {date}' },
  ROW_PARTIAL: {
    en: '{n}. {who}\n    {phone} · paid {paid} of {billed} · balance {balance}{due}',
    sw: '{n}. {who}\n    {phone} · amelipa {paid} kati ya {billed} · salio {balance}{due}',
  },
  ROW_UNPAID: {
    en: '{n}. {who}\n    {phone} · owes {balance}{due}',
    sw: '{n}. {who}\n    {phone} · anadaiwa {balance}{due}',
  },
  ON_TIME: { en: ' ✅ on time', sw: ' ✅ kwa wakati' },
  LATE: { en: ' ⚠️ late', sw: ' ⚠️ amechelewa' },
  DUE: { en: ' · due {date}', sw: ' · mwisho {date}' },
  OVERDUE: { en: ' · overdue', sw: ' · amechelewa' },

  MONEY_HEAD: {
    en:
      '💰 *Money breakdown* · {month}\n\n' +
      '🧾 Billed: {billed}\n✅ Collected: {collected}\n⏳ Pending: {pending}\n\n' +
      '🤝 *Commission* ({rate}, on base rent only)\n' +
      '• Base rent collected: {baseCollected} → commission {onCollected}\n' +
      '• Base rent billed: {baseBilled} → commission if all is paid {onExpected}\n\n' +
      '📄 *Agent\'s statement*',
    sw:
      '💰 *Mgawanyo wa pesa* · {month}\n\n' +
      '🧾 Imedaiwa: {billed}\n✅ Iliyokusanywa: {collected}\n⏳ Inayosubiriwa: {pending}\n\n' +
      '🤝 *Kamisheni* ({rate}, kwa kodi ya msingi tu)\n' +
      '• Kodi ya msingi iliyokusanywa: {baseCollected} → kamisheni {onCollected}\n' +
      '• Kodi ya msingi iliyodaiwa: {baseBilled} → kamisheni ikilipwa yote {onExpected}\n\n' +
      '📄 *Taarifa ya wakala*',
  },
  MONEY_STATUS: { en: 'Status: {status}', sw: 'Hali: {status}' },
  STATUS_draft: { en: 'draft', sw: 'rasimu' },
  STATUS_finalized: { en: 'finalized', sw: 'imekamilika' },
  STATUS_sent: { en: 'sent', sw: 'imetumwa' },
  STATUS_acknowledged: { en: 'acknowledged', sw: 'imethibitishwa' },
  STATEMENT_INCOME: { en: 'Income', sw: 'Mapato' },
  STATEMENT_DEDUCTIONS: { en: 'Deductions', sw: 'Makato' },
  STATEMENT_NET: { en: '💰 *Net payable to you*: {net}', sw: '💰 *Kiasi cha kulipwa kwako*: {net}' },
  STATEMENT_NOTES: { en: 'Agent\'s note: {notes}', sw: 'Maelezo ya wakala: {notes}' },
  MONEY_IF_ALL: {
    en: 'If everything billed is collected, you would receive {expected}.',
    sw: 'Ikiwa kila kilichodaiwa kitakusanywa, utapokea {expected}.',
  },

  MONTH_LATEST: { en: 'Latest month', sw: 'Mwezi wa karibuni' },
  PICK_MONTH: { en: 'Pick a month to view:', sw: 'Chagua mwezi wa kuona:' },
  PICK_MONTH_TR: { en: 'Which month do you want the transcript for?', sw: 'Ungependa taarifa ya mwezi upi?' },
  NO_MONTHS: { en: 'No months with data yet.', sw: 'Bado hakuna miezi yenye taarifa.' },
  TREND_HEAD: { en: '📈 *Last months* · {name}', sw: '📈 *Miezi ya karibuni* · {name}' },
  TREND_ROW: {
    en: '*{month}*\nBilled {billed} · Collected {collected}\nPending {pending} · Net to you {net}',
    sw: '*{month}*\nImedaiwa {billed} · Iliyokusanywa {collected}\nInayosubiriwa {pending} · Kiasi chako {net}',
  },

  UNLOCK_ASK: {
    en: '🔒 To show tenant names and phones, we send a verification code by SMS to the *owner\'s phone* on file. Send the code?',
    sw: '🔒 Ili kuonyesha majina na namba za wapangaji, tunatuma nambari ya uthibitisho kwa SMS kwenda *simu ya mmiliki* iliyosajiliwa. Tuma nambari?',
  },
  UNLOCK_OK: {
    en: '🔓 Done. Tenant details are now visible{until}.',
    sw: '🔓 Imekamilika. Maelezo ya wapangaji sasa yanaonekana{until}.',
  },
  UNLOCK_UNTIL: { en: ' until {when}', sw: ' hadi {when}' },
  ALREADY_OPEN: { en: '🔓 Tenant details are already visible.', sw: '🔓 Maelezo ya wapangaji tayari yanaonekana.' },
  OTP_SENT: {
    en: '🔐 We sent a 6-digit verification code to the owner\'s phone {sentTo}.\nType the code here. It is valid for {minutes} min.\n\n_Reply 0 to cancel._',
    sw: '🔐 Tumetuma nambari ya uthibitisho ya tarakimu 6 kwa simu ya mmiliki {sentTo}.\nIandike hapa. Ni halali kwa dakika {minutes}.\n\n_Jibu 0 kughairi._',
  },
  OTP_REPROMPT: {
    en: 'Please type the 6-digit code, or tap *Resend code*.',
    sw: 'Tafadhali andika nambari ya tarakimu 6, au gusa *Tuma tena*.',
  },
  OTP_WAIT: {
    en: 'You can ask for a new code in {wait}.',
    sw: 'Unaweza kuomba nambari mpya baada ya {wait}.',
  },
  OTP_NEW_NEEDED: {
    en: 'Tap *Resend code* to get a new code.',
    sw: 'Gusa *Tuma tena* kupata nambari mpya.',
  },

  TR_QUOTA_FREE: {
    en: '📄 *Transcript* · {month}\nThis one is *free* ({left} of {limit} free this month).\nFor your security we first send a code to the owner\'s phone.',
    sw: '📄 *Taarifa* · {month}\nHii ni *bure* (zilizobaki: {left} kati ya {limit} bure mwezi huu).\nKwa usalama wako, kwanza tunatuma nambari ya uthibitisho kwa simu ya mmiliki.',
  },
  TR_QUOTA_PAID: {
    en: '📄 *Transcript* · {month}\nYour free transcript for this month is used. This one costs *{price}*.\nFor your security we first send a code to the owner\'s phone.',
    sw: '📄 *Taarifa* · {month}\nTaarifa yako ya bure ya mwezi huu imetumika. Hii itagharimu *{price}*.\nKwa usalama wako, kwanza tunatuma nambari ya uthibitisho kwa simu ya mmiliki.',
  },
  TR_EXISTING: {
    en: '📄 You already have the {month} transcript{until}. Sending it again is free and needs no code.',
    sw: '📄 Tayari una taarifa ya {month}{until}. Kuitumia tena ni bure na haihitaji nambari.',
  },
  TR_EXISTING_UNTIL: { en: ' (available until {when})', sw: ' (inapatikana hadi {when})' },
  TR_GENERATING: { en: '⏳ Preparing your PDF… please wait.', sw: '⏳ Inaandaa PDF yako… tafadhali subiri.' },
  TR_PAY_ASK: {
    en: '💳 This transcript costs *{price}*.\nPay with M-Pesa on *{phone}*, or use another number?',
    sw: '💳 Taarifa hii inagharimu *{price}*.\nLipa kwa M-Pesa kupitia *{phone}*, au tumia nambari nyingine?',
  },
  TR_PHONE_ASK: {
    en: 'Type the Safaricom number to charge (07XX XXX XXX).\n\n_Reply 0 to cancel._',
    sw: 'Andika nambari ya Safaricom ya kulipia (07XX XXX XXX).\n\n_Jibu 0 kughairi._',
  },
  TR_PHONE_BAD: {
    en: 'That is not a valid Safaricom number. Use the format 07XXXXXXXX or 01XXXXXXXX.',
    sw: 'Hiyo si nambari sahihi ya Safaricom. Tumia muundo 07XXXXXXXX au 01XXXXXXXX.',
  },
  TR_PAY_SENT: {
    en: '📲 Check your phone ({phone}) for the M-Pesa prompt and enter your PIN. I will send the PDF as soon as the payment is confirmed.',
    sw: '📲 Angalia simu yako ({phone}) kwa ujumbe wa M-Pesa na uweke PIN yako. Nitakutumia PDF mara malipo yakithibitishwa.',
  },
  TR_STILL_WAITING: { en: '⏳ Still waiting for the payment…', sw: '⏳ Bado tunasubiri malipo…' },
  TR_TIMEOUT: {
    en: 'We have not seen the payment yet. If you already paid, tap *Check status*.',
    sw: 'Bado hatujaona malipo. Ikiwa umeshalipa, gusa *Angalia hali*.',
  },
  TR_NOT_YET: {
    en: 'Not confirmed yet. Please finish the M-Pesa prompt on your phone, then check again.',
    sw: 'Bado haijathibitishwa. Tafadhali kamilisha ujumbe wa M-Pesa kwenye simu yako, kisha angalia tena.',
  },
  TR_PAY_FAILED: {
    en: '❌ The payment did not go through. No transcript was issued. Would you like to try again?',
    sw: '❌ Malipo hayakukamilika. Hakuna taarifa iliyotolewa. Ungependa kujaribu tena?',
  },
  TR_EXPIRED: {
    en: 'This request has expired. Please start a new transcript.',
    sw: 'Ombi hili limeisha muda. Tafadhali anza taarifa mpya.',
  },
  TR_FAILED: {
    en: '❌ We could not prepare the transcript. Please try again in a moment.',
    sw: '❌ Hatukuweza kuandaa taarifa. Tafadhali jaribu tena baada ya muda mfupi.',
  },
  TR_CAPTION: {
    en: '📄 Landlord Watch · {month} · {ownerId}',
    sw: '📄 Landlord Watch · Taarifa ya {month} · {ownerId}',
  },
  TR_SENT: {
    en: '✅ Your transcript is above. The download link works for a short time only, so save the file now{until}.',
    sw: '✅ Taarifa yako iko hapo juu. Kiungo cha kupakua kinafanya kazi kwa muda mfupi tu, hivyo ihifadhi sasa{until}.',
  },
  TR_SENT_UNTIL: { en: '. You can ask for it again until {when}', sw: '. Unaweza kuiomba tena hadi {when}' },
  TR_DOC_FAILED: {
    en: 'The file could not be sent. Tap *Send again* to get a fresh link.',
    sw: 'Faili haikuweza kutumwa. Gusa *Tuma tena* kupata kiungo kipya.',
  },
  TR_CANCELLED: { en: 'Okay, cancelled.', sw: 'Sawa, imeghairiwa.' },

  RP_KIND: {
    en: '📊 *Tax report*\nWhich report do you need?\n\n• *MRI working paper*: one month\'s rent received, the 7.5% MRI and the KES 288,000 band test.\n• *Annual summary*: month by month for the year so far.',
    sw: '📊 *Ripoti ya kodi*\nUnahitaji ripoti ipi?\n\n• *Karatasi ya MRI*: kodi iliyopokelewa mwezi mmoja, MRI ya 7.5% na kipimo cha KES 288,000.\n• *Muhtasari wa mwaka*: mwezi kwa mwezi kwa mwaka huu hadi sasa.',
  },
  RP_MONTH: {
    en: '📅 Pick the month the rent was received.',
    sw: '📅 Chagua mwezi ambao kodi ilipokelewa.',
  },
  RP_FREE: {
    en: '📊 *{title}* · {month}\nThis one is *free*: your plan includes one report per property each month.\nThe PDF is sent only after you confirm.',
    sw: '📊 *{title}* · {month}\nHii ni *bure*: mpango wako unajumuisha ripoti moja kwa kila mali kila mwezi.\nPDF inatumwa tu baada ya wewe kuthibitisha.',
  },
  RP_EXISTING: {
    en: '📊 You already have the {title} for {month}{until}. Sending it again is free.',
    sw: '📊 Tayari una {title} ya {month}{until}. Kuitumia tena ni bure.',
  },
  RP_PAY_ASK: {
    en: '💳 *{title}* · {month}\nThis report costs *{price}*.\nPay with M-Pesa on *{phone}*, or use another number?',
    sw: '💳 *{title}* · {month}\nRipoti hii inagharimu *{price}*.\nLipa kwa M-Pesa kupitia *{phone}*, au tumia nambari nyingine?',
  },
  RP_PRICE_CHANGED: {
    en: 'This month\'s free report has been used, so this one costs *{price}*.',
    sw: 'Ripoti ya bure ya mwezi huu imetumika, kwa hiyo hii inagharimu *{price}*.',
  },
  RP_PAY_SENT: {
    en: '📲 Check your phone ({phone}) for the M-Pesa prompt and enter your PIN. I will send the PDF as soon as the payment is confirmed.',
    sw: '📲 Angalia simu yako ({phone}) kwa ujumbe wa M-Pesa na uweke PIN yako. Nitakutumia PDF mara malipo yakithibitishwa.',
  },
  RP_PAY_FAILED: {
    en: '❌ The payment did not go through. No report was issued. Would you like to try again?',
    sw: '❌ Malipo hayakukamilika. Hakuna ripoti iliyotolewa. Ungependa kujaribu tena?',
  },
  RP_EXPIRED: {
    en: 'This report order has expired. Please start a new one.',
    sw: 'Ombi hili la ripoti limeisha muda. Tafadhali anza jipya.',
  },
  RP_FAILED: {
    en: '❌ We could not prepare the report. Please try again in a moment.',
    sw: '❌ Hatukuweza kuandaa ripoti. Tafadhali jaribu tena baada ya muda mfupi.',
  },
  RP_CAPTION: {
    en: '📊 {title} · {month} · {ownerId}',
    sw: '📊 {title} · {month} · {ownerId}',
  },
  RP_SENT: {
    en: '✅ Your report is above. It is made from the records in Plot Yangu: check it against your M-Pesa and bank statements before you file on iTax. Plot Yangu does not file with KRA{until}.',
    sw: '✅ Ripoti yako iko hapo juu. Imetengenezwa kutokana na kumbukumbu za Plot Yangu: ilinganishe na taarifa zako za M-Pesa na benki kabla ya kuwasilisha kwenye iTax. Plot Yangu haiwasilishi kwa KRA{until}.',
  },
  RP_SENT_UNTIL: { en: '. You can ask for it again until {when}', sw: '. Unaweza kuiomba tena hadi {when}' },
  RP_DOC_FAILED: {
    en: 'The file could not be sent. Tap *Send again* to get a fresh link.',
    sw: 'Faili haikuweza kutumwa. Gusa *Tuma tena* kupata kiungo kipya.',
  },

  SETTINGS: {
    en: '🌐 *Language & help*\nChoose your language:',
    sw: '🌐 *Lugha na msaada*\nChagua lugha yako:',
  },
  LANG_SET: { en: '✅ Language: English', sw: '✅ Lugha: Kiswahili' },
  HELP: {
    en:
      '❓ *Landlord Watch help*\n\n' +
      '• Watch rent billed, collected and pending for a property managed by an agency.\n' +
      '• Tenant names and phones stay hidden until you unlock them with a code sent to the owner\'s phone.\n' +
      '• A monthly transcript (PDF) needs a code too. You get one free transcript per property each month.\n' +
      '• Reply *0* to go back, *#* for the main menu.\n\n' +
      '📞 +254791286165 · 📧 info@samuhia.co.ke\nSupport: 9 AM - 5 PM (weekdays)',
    sw:
      '❓ *Msaada wa Landlord Watch*\n\n' +
      '• Fuatilia kodi iliyodaiwa, iliyokusanywa na inayosubiriwa kwa mali inayosimamiwa na wakala.\n' +
      '• Majina na namba za wapangaji hubaki zimefichwa hadi uzifungue kwa nambari ya uthibitisho inayotumwa kwa simu ya mmiliki.\n' +
      '• Taarifa ya mwezi (PDF) pia inahitaji nambari ya uthibitisho. Unapata taarifa moja bila malipo kwa kila mali kila mwezi.\n' +
      '• Jibu *0* kurudi, *#* kwenda Menyu kuu.\n\n' +
      '📞 +254791286165 · 📧 info@samuhia.co.ke\nMsaada: saa 3 asubuhi - saa 11 jioni (siku za kazi)',
  },

  REPROMPT_USE_BUTTONS: {
    en: 'Sorry, I didn\'t understand that. Please use the buttons or reply with a number from the list.',
    sw: 'Samahani, sijaelewa. Tafadhali tumia vitufe au jibu kwa nambari kutoka kwenye orodha.',
  },
  STALE_BUTTON: {
    en: 'That button is no longer active. Here is the menu again.',
    sw: 'Kitufe hicho hakifanyi kazi tena. Hii hapa menyu tena.',
  },
  LOADING: { en: 'One moment… ⏳', sw: 'Subiri kidogo… ⏳' },
  PAGE_EMPTY_PROPS: { en: 'No properties on this page.', sw: 'Hakuna mali kwenye ukurasa huu.' },
  GENERIC_ERROR: {
    en: 'Something went wrong. Please try again.',
    sw: 'Kuna hitilafu. Tafadhali jaribu tena.',
  },
  LATE_REPLY: {
    en: 'Sorry, the chat window has expired. Please send "Hi" to start again.',
    sw: 'Samahani, muda wa mazungumzo umeisha. Tafadhali tuma "Hi" kuanza tena.',
  },
} satisfies Record<string, Bi>;

export type WatchMsgKey = keyof typeof WATCH_MESSAGES;

export function wmsg(key: WatchMsgKey, lang: Lang, params: Record<string, string | number | undefined> = {}): string {
  return fill(WATCH_MESSAGES[key][lang], params);
}

// ── Errors (contract section 7) ──────────────────────────────────────────

export const WATCH_ERRORS: Record<LwErrorCode, Bi> = {
  LW_BAD_OWNER_ID: {
    en: 'That Owner ID is not valid. It should look like PYP-0001.',
    sw: 'Owner ID hiyo si sahihi. Inapaswa kuonekana hivi: PYP-0001.',
  },
  LW_NOT_FOUND: {
    en: 'No property found for that ID. Please check it and try again.',
    sw: 'Hakuna mali iliyopatikana kwa ID hiyo. Tafadhali ikague na ujaribu tena.',
  },
  LW_RATE_LIMITED: {
    en: 'Too many attempts. Please try again in {wait}.',
    sw: 'Majaribio mengi mno. Tafadhali jaribu tena baada ya {wait}.',
  },
  LW_NO_PHONE_ON_FILE: {
    en: 'This property has no owner phone number on file, so it cannot be verified. The owner must add a phone number in their Plot Yangu (PMS) app first.',
    sw: 'Mali hii haina nambari ya simu ya mmiliki, kwa hiyo haiwezi kuthibitishwa. Mmiliki anapaswa kwanza kuongeza nambari ya simu kwenye programu yake ya Plot Yangu (PMS).',
  },
  LW_OTP_COOLDOWN: {
    en: 'Please wait {wait} before asking for a new code.',
    sw: 'Tafadhali subiri {wait} kabla ya kuomba nambari mpya.',
  },
  LW_OTP_WRONG: {
    en: '❌ Wrong code. {attempts}',
    sw: '❌ Nambari si sahihi. {attempts}',
  },
  LW_OTP_EXPIRED: {
    en: 'That code has expired. Please request a new one.',
    sw: 'Nambari hiyo imeisha muda. Tafadhali omba nambari mpya.',
  },
  LW_OTP_LOCKED: {
    en: 'Too many wrong tries, so that code is locked. Please request a new one.',
    sw: 'Umekosea mara nyingi, kwa hiyo nambari hiyo imefungiwa. Tafadhali omba nambari mpya.',
  },
  LW_SMS_FAILED: {
    en: 'We could not send the SMS. Please try again in a moment.',
    sw: 'Hatukuweza kutuma SMS. Tafadhali jaribu tena baada ya muda mfupi.',
  },
  LW_LOCKED: {
    en: 'Tenant details are locked. Please unlock them first.',
    sw: 'Maelezo ya wapangaji yamefungwa. Tafadhali yafungue kwanza.',
  },
  LW_CONNECTION_LIMIT: {
    en: 'You have reached the maximum number of connected properties. Disconnect one to add another.',
    sw: 'Umefikia idadi ya juu ya mali zilizounganishwa. Tenganisha moja ili kuongeza nyingine.',
  },
  LW_BAD_MONTH: {
    en: 'That month is not available. Please pick another month.',
    sw: 'Mwezi huo haupatikani. Tafadhali chagua mwezi mwingine.',
  },
  LW_PAYMENT_FAILED: {
    en: 'The M-Pesa payment could not start or did not go through. Please try again.',
    sw: 'Malipo ya M-Pesa hayakuweza kuanza au hayakukamilika. Tafadhali jaribu tena.',
  },
  LW_NOT_ALLOWED: {
    en: 'Sorry, that action is not allowed. Please start again from the menu.',
    sw: 'Samahani, kitendo hicho hakiruhusiwi. Tafadhali anza tena kutoka kwenye menyu.',
  },
  LW_REPORT_NO_DATA: {
    en: 'There are no synced tenant or invoice records for this property yet, so a report cannot be made. Ask the agent to turn on cloud sync.',
    sw: 'Bado hakuna kumbukumbu za wapangaji au ankara zilizosawazishwa za mali hii, kwa hiyo ripoti haiwezi kutengenezwa. Mwombe wakala awashe usawazishaji wa wingu.',
  },
  LW_REPORT_STALE: {
    en: 'Your records have not synced to the cloud for over 7 days, so a report cannot be made or paid for yet. Open Plot Yangu online so it syncs, then try again.',
    sw: 'Kumbukumbu zako hazijasawazishwa kwenye wingu kwa zaidi ya siku 7, kwa hiyo ripoti haiwezi kutengenezwa wala kulipiwa bado. Fungua Plot Yangu ukiwa mtandaoni ili isawazishe, kisha ujaribu tena.',
  },
  LW_UNAVAILABLE: {
    en: 'Something went wrong on our side. Please try again in a moment.',
    sw: 'Kuna hitilafu upande wetu. Tafadhali jaribu tena baada ya muda mfupi.',
  },
};

/** "45 seconds" / "3 minutes" (rounded up). */
export function waitText(sec: number | undefined, lang: Lang): string {
  const s = Math.max(1, Math.ceil(sec ?? 60));
  if (s < 90) return lang === 'en' ? `${s} seconds` : `sekunde ${s}`;
  const m = Math.ceil(s / 60);
  return lang === 'en' ? `${m} minutes` : `dakika ${m}`;
}

/** Friendly bilingual text for any LW_* code. Unknown codes fall back to LW_UNAVAILABLE. */
export function lwErrorMessage(
  code: string,
  lang: Lang,
  extra: { retryAfterSec?: number; attemptsLeft?: number } = {}
): string {
  const entry = (WATCH_ERRORS as Record<string, Bi | undefined>)[code] ?? WATCH_ERRORS.LW_UNAVAILABLE;
  const attempts =
    extra.attemptsLeft === undefined
      ? lang === 'en' ? 'Please try again.' : 'Tafadhali jaribu tena.'
      : lang === 'en'
        ? `${extra.attemptsLeft} ${extra.attemptsLeft === 1 ? 'try' : 'tries'} left.`
        : `Umebakiza majaribio ${extra.attemptsLeft}.`;
  return fill(entry[lang], { wait: waitText(extra.retryAfterSec, lang), attempts });
}

/** What the UI should offer next for each error (contract section 7 "UI behaviour"). */
export type ErrorNext = 'retry-input' | 'new-code' | 'wait' | 'unlock' | 'properties' | 'retry' | 'menu';

export function errorNext(code: string): ErrorNext {
  switch (code) {
    case 'LW_BAD_OWNER_ID':
    case 'LW_NOT_FOUND':
    case 'LW_OTP_WRONG':
    case 'LW_BAD_MONTH':
      return 'retry-input';
    case 'LW_OTP_EXPIRED':
    case 'LW_OTP_LOCKED':
      return 'new-code';
    case 'LW_OTP_COOLDOWN':
    case 'LW_RATE_LIMITED':
      return 'wait';
    case 'LW_LOCKED':
      return 'unlock';
    case 'LW_CONNECTION_LIMIT':
      return 'properties';
    case 'LW_SMS_FAILED':
    case 'LW_PAYMENT_FAILED':
    case 'LW_UNAVAILABLE':
      return 'retry';
    default:
      return 'menu';
  }
}
