/**
 * Lipa Mdogo Mdogo for standalone tenants (LMMX): copy, English + Kiswahili.
 * Labels stay within 20 characters so they are valid as reply buttons (enforced by __tests__/lmmx/lmmx.test.ts).
 * Amounts, dates and names are filled in by the handler from what PAY returns; this file holds no numbers of its own
 * except the support phone (the same one the Help screen shows).
 */
import { Lang } from '../types/watch.types';
import { fill } from '../utils/watch.format';

type Bi = { en: string; sw: string };

export const LMMX_SUPPORT_PHONE = '0791286165';

export const LMMX_LABELS = {
  TRY_AGAIN: { en: 'Try again', sw: 'Jaribu tena' },
  JOIN: { en: 'Join Lipa Mdogo', sw: 'Jiunge Lipa Mdogo' },
  CHECK: { en: 'Check balance', sw: 'Angalia salio' },
  PAY_MORE: { en: 'Pay more', sw: 'Lipa zaidi' },
  PAY_AMOUNT: { en: 'Pay {amount}', sw: 'Lipa {amount}' },
  MONEY: { en: 'My money', sw: 'Pesa zangu' },
  PAY_LANDLORD: { en: 'Pay landlord now', sw: 'Lipa mwenye nyumba' },
  WITHDRAW: { en: 'Withdraw', sw: 'Toa pesa' },
  SEND_CODE: { en: 'Send me a code', sw: 'Nitumie msimbo' },
} satisfies Record<string, Bi>;

export type LmmxLabelKey = keyof typeof LMMX_LABELS;

/** Button label, cut to the WhatsApp limit of 20 characters (an amount such as "KES 1,250,000" could otherwise overflow it). */
export function lmxl(key: LmmxLabelKey, lang: Lang, params?: Record<string, string | number>): string {
  return fill(LMMX_LABELS[key][lang], params).slice(0, 20);
}

export const LMMX_MESSAGES = {
  ASK_ID: {
    en: '*Lipa Mdogo Mdogo* 🪙\n\nPay your rent in small amounts, at your own pace.\n\nPlease type your *ID number* (the one you gave when you signed up).\n\nSend *0* to go back or *#* for the main menu.',
    sw: '*Lipa Mdogo Mdogo* 🪙\n\nLipa kodi yako kwa awamu ndogo, kwa kasi yako.\n\nTafadhali andika *namba yako ya kitambulisho* (ile ulioipa ulipojiunga).\n\nTuma *0* kurudi nyuma au *#* kwenda menyu kuu.',
  },
  BAD_ID: {
    en: 'That does not look like a valid ID number. Please check it and type it again.',
    sw: 'Hiyo haionekani kuwa namba sahihi ya kitambulisho. Tafadhali iangalie na uiandike tena.',
  },
  NOT_FOUND: {
    en: '*Lipa Mdogo Mdogo*\n\nWe could not find an account for this WhatsApp number and ID. Check the ID, and use the same phone number you gave when you signed up. Or join below.',
    sw: '*Lipa Mdogo Mdogo*\n\nHatukupata akaunti ya namba hii ya WhatsApp na kitambulisho hiki. Angalia kitambulisho, na utumie namba ile ile ya simu uliyotoa ulipojiunga. Au jiunge hapa chini.',
  },
  FROZEN: {
    en: '*Lipa Mdogo Mdogo*\n\nYour account is on hold for now. Please contact support on {phone}.',
    sw: '*Lipa Mdogo Mdogo*\n\nAkaunti yako imesitishwa kwa sasa. Tafadhali wasiliana na msaada kwa {phone}.',
  },
  AWAITING: {
    en: '*Lipa Mdogo Mdogo*\n\nYour sign-up is almost done. Please send the code from your SMS (it looks like *LMM1234*) in this chat to switch on your account.\n\nIf the code has expired, ask your Samuhia desk agent for a new one.',
    sw: '*Lipa Mdogo Mdogo*\n\nKujiunga kwako kumekaribia kukamilika. Tafadhali tuma msimbo kutoka kwenye SMS yako (unaonekana kama *LMM1234*) kwenye mazungumzo haya ili kuwasha akaunti yako.\n\nIkiwa msimbo umeisha muda, mwombe wakala wako wa Samuhia akutumie mpya.',
  },
  HOME: {
    en: '*Lipa Mdogo Mdogo* 🪙\n\nHello {name}.\n\n🏠 Monthly rent: {rent}\n⚖️ Still to pay: {balance}\n📅 Rent due: {due}\n⏰ Pay by: {payby}\n\nPay by {payby} so your landlord gets all of it on {due}.',
    sw: '*Lipa Mdogo Mdogo* 🪙\n\nHujambo {name}.\n\n🏠 Kodi ya mwezi: {rent}\n⚖️ Bado unadaiwa: {balance}\n📅 Kodi inatakiwa: {due}\n⏰ Lipa kufikia: {payby}\n\nLipa kufikia {payby} ili mwenye nyumba apate yote tarehe {due}.',
  },
  ASK_AMOUNT: {
    en: 'How much do you want to put towards your rent now?\n\nType the amount in shillings (at least {min}, at most {max}). Fees are added on top and shown before you pay.\n\nSuggested: {suggested}\n\nSend *0* to go back or *#* for the main menu.',
    sw: 'Unataka kuweka kiasi gani kwenye kodi yako sasa?\n\nAndika kiasi kwa shilingi (angalau {min}, kisichozidi {max}). Ada huongezwa juu na huonyeshwa kabla ya kulipa.\n\nIlipendekezwa: {suggested}\n\nTuma *0* kurudi nyuma au *#* kwenda menyu kuu.',
  },
  BAD_AMOUNT: {
    en: 'Please type a whole number of shillings between {min} and {max}, for example 500.',
    sw: 'Tafadhali andika namba kamili ya shilingi kati ya {min} na {max}, kwa mfano 500.',
  },
  QUOTE: {
    en: '*Your payment* 💳\n\n🏠 Goes to your rent: {credit}\n➕ Fees: {fees}\n💰 You pay: {charge}\n\nPay by {payby} so your landlord gets all of it on time.',
    sw: '*Malipo yako* 💳\n\n🏠 Inaenda kwenye kodi yako: {credit}\n➕ Ada: {fees}\n💰 Unalipa: {charge}\n\nLipa kufikia {payby} ili mwenye nyumba apate yote kwa wakati.',
  },
  ASK_PHONE: {
    en: 'Which M-Pesa number will pay? Tap the button to use your WhatsApp number, or type another one (07… or 01…).',
    sw: 'Ni namba gani ya M-Pesa italipa? Gusa kitufe kutumia namba yako ya WhatsApp, au andika nyingine (07… au 01…).',
  },
  CONFIRM: {
    en: '*Please confirm* ✅\n\n🏠 Goes to your rent: {credit}\n➕ Fees: {fees}\n💰 You pay: {charge}\n📱 M-Pesa number: {phone}\n\nTap *Confirm* to send the M-Pesa prompt.',
    sw: '*Tafadhali thibitisha* ✅\n\n🏠 Inaenda kwenye kodi yako: {credit}\n➕ Ada: {fees}\n💰 Unalipa: {charge}\n📱 Namba ya M-Pesa: {phone}\n\nGusa *Thibitisha* kutuma ombi la M-Pesa.',
  },
  BAD_PHONE: {
    en: 'That number is not valid. Type a Kenyan number starting with 07 or 01.',
    sw: 'Namba hiyo si sahihi. Andika namba ya Kenya inayoanza na 07 au 01.',
  },
  BAD_CHOICE: {
    en: 'Please tap *Confirm* or *Back*.',
    sw: 'Tafadhali gusa *Thibitisha* au *Nyuma*.',
  },
  QUOTE_REFRESHED: {
    en: 'The price was refreshed. Please check it before you confirm.',
    sw: 'Bei imesasishwa. Tafadhali iangalie kabla ya kuthibitisha.',
  },
  SENT: {
    en: 'M-Pesa prompt sent to {phone} 📲\n\nEnter your PIN to pay {charge}. We will text you when your rent credit is recorded. Please do not pay twice: tap *Check balance* after a minute.',
    sw: 'Ombi la M-Pesa limetumwa kwa {phone} 📲\n\nWeka PIN yako ili ulipe {charge}. Tutakutumia ujumbe malipo yakirekodiwa kwenye kodi yako. Tafadhali usilipe mara mbili: gusa *Angalia salio* baada ya dakika moja.',
  },
  PAY_UNSURE: {
    en: 'We could not confirm if the M-Pesa prompt was sent. If you get a prompt, enter your PIN. Please check your balance before trying again, so you do not pay twice.',
    sw: 'Hatukuweza kuthibitisha kama ombi la M-Pesa limetumwa. Ukipata ombi, weka PIN yako. Tafadhali angalia salio lako kabla ya kujaribu tena, ili usilipe mara mbili.',
  },
  PAY_FAILED: {
    en: 'We could not start the payment. Nothing is taken from your M-Pesa until you enter your PIN. Please try again in a few minutes.',
    sw: 'Hatukuweza kuanzisha malipo. Hakuna kinachotolewa kwenye M-Pesa yako hadi uweke PIN yako. Tafadhali jaribu tena baada ya dakika chache.',
  },
  E_RATE: {
    en: 'Too many tries. Please wait a few minutes and try again.',
    sw: 'Majaribio mengi sana. Tafadhali subiri dakika chache kisha ujaribu tena.',
  },
  E_AMOUNT: {
    en: 'That amount cannot be paid right now. Check your balance and try another amount.',
    sw: 'Kiasi hicho hakiwezi kulipwa sasa. Angalia salio lako kisha ujaribu kiasi kingine.',
  },
  E_QUOTE: {
    en: 'That price has expired. Please choose the amount again to get a fresh one.',
    sw: 'Bei hiyo imeisha muda. Tafadhali chagua kiasi tena upate mpya.',
  },
  E_STATE: {
    en: 'We cannot take a payment right now. Please check your balance, or contact support on {phone}.',
    sw: 'Hatuwezi kupokea malipo sasa. Tafadhali angalia salio lako, au wasiliana na msaada kwa {phone}.',
  },
  E_DISABLED: {
    en: '*Lipa Mdogo Mdogo* is not available right now. Please try again later.',
    sw: '*Lipa Mdogo Mdogo* haipatikani kwa sasa. Tafadhali jaribu tena baadaye.',
  },
  TRY_LATER: {
    en: 'Something went wrong on our side. Please try again in a few minutes.',
    sw: 'Kuna tatizo upande wetu. Tafadhali jaribu tena baada ya dakika chache.',
  },
  JOIN: {
    en: '*Join Lipa Mdogo Mdogo* 🪙\n\n{text}\n\nCall or WhatsApp Samuhia: {phones}\n\nOr visit a nearby Samuhia desk agent and carry your ID.',
    sw: '*Jiunge Lipa Mdogo Mdogo* 🪙\n\n{text}\n\nPiga simu au tuma WhatsApp kwa Samuhia: {phones}\n\nAu tembelea wakala wa Samuhia aliye karibu ukiwa na kitambulisho chako.',
  },
  JOIN_DEFAULT_TEXT: {
    en: 'Pay your rent in small amounts, at your own pace. Your landlord does not need to join.',
    sw: 'Lipa kodi yako kwa awamu ndogo, kwa kasi yako. Mwenye nyumba hahitaji kujiunga.',
  },
  MONEY: {
    en: '*My money* 💰\n\nYou have *{avail}* paid in that has not gone to your landlord yet.\n\n• *Pay landlord now*: we send all of it to your landlord within 24 hours.\n• *Withdraw*: we send {net} to your M-PESA (after a {fee} fee), within 24 hours.\n\nYou do not type an amount. We move everything you have here.',
    sw: '*Pesa zangu* 💰\n\nUna *{avail}* ulizolipa ambazo bado hazijaenda kwa mwenye nyumba.\n\n• *Lipa mwenye nyumba*: tunamtumia zote ndani ya saa 24.\n• *Toa pesa*: tunakutumia {net} kwenye M-PESA yako (baada ya ada ya {fee}), ndani ya saa 24.\n\nHuandiki kiasi. Tunahamisha zote ulizo nazo hapa.',
  },
  MONEY_NONE: {
    en: '*My money* 💰\n\nYou have {avail} paid in. You need at least {min} to pay your landlord early or to withdraw.',
    sw: '*Pesa zangu* 💰\n\nUna {avail} ulizolipa. Unahitaji angalau {min} ili umlipe mwenye nyumba mapema au utoe pesa.',
  },
  MONEY_PENDING: {
    en: 'A request is already on its way. It will be done within 24 hours.',
    sw: 'Ombi lipo njiani tayari. Litakamilika ndani ya saa 24.',
  },
  LCONFIRM: {
    en: 'Send *{avail}* to your landlord now? It goes to the landlord account on record, within 24 hours.',
    sw: 'Mtumie mwenye nyumba *{avail}* sasa? Inaenda kwenye akaunti yake iliyosajiliwa, ndani ya saa 24.',
  },
  LDONE: {
    en: '✅ {message}',
    sw: '✅ {message}',
  },
  WCONFIRM: {
    en: 'Withdraw *{avail}* to your M-PESA *{phone}*?\n\nAfter the {fee} fee you get *{net}*. It goes only to this number. We will text a code to it first.',
    sw: 'Toa *{avail}* kwenda M-PESA yako *{phone}*?\n\nBaada ya ada ya {fee} unapata *{net}*. Inaenda kwa namba hii tu. Kwanza tutatuma msimbo kwa namba hii.',
  },
  WCODE_SENT: {
    en: '📲 We texted a code to *{phone}*, like *LMW1234*.\n\nSend that code here as a message (or tap the link in the SMS). It lasts 30 minutes. Never share it with anyone else.',
    sw: '📲 Tumetuma msimbo kwa *{phone}*, kama *LMW1234*.\n\nTuma msimbo huo hapa kama ujumbe (au bonyeza kiungo kwenye SMS). Unadumu dakika 30. Usimpe mtu mwingine.',
  },
  CODE_WD_OK: {
    en: '✅ *Withdrawal requested.*\n\n{summary} will be sent to your M-PESA within 24 hours. We will text you when it is sent.\n\nIf you did not ask for this, contact support on {phone} at once.',
    sw: '✅ *Ombi la kutoa pesa limepokelewa.*\n\n{summary} itatumwa kwenye M-PESA yako ndani ya saa 24. Tutakutumia SMS ikitumwa.\n\nUsipoomba hili, wasiliana na msaada kwa {phone} mara moja.',
  },
  CODE_SETUP_OK: {
    en: '✅ *Lipa Mdogo Mdogo is on!*\n\nYour sign-up is confirmed.{summary}\n\nNext: type *#*, then choose *Lipa Mdogo Mdogo* to pay your rent in small amounts.',
    sw: '✅ *Lipa Mdogo Mdogo imewashwa!*\n\nKujiunga kwako kumethibitishwa.{summary}\n\nInayofuata: andika *#*, kisha chagua *Lipa Mdogo Mdogo* ulipe kodi yako kwa awamu ndogo.',
  },
  CODE_CHANGE_OK: {
    en: '✅ *Change confirmed.*{summary}\n\nIf you did not ask for this change, contact support on {phone} at once.',
    sw: '✅ *Mabadiliko yamethibitishwa.*{summary}\n\nUsipoomba mabadiliko haya, wasiliana na msaada kwa {phone} mara moja.',
  },
  CODE_CANCELLED: {
    en: '✅ The change has been cancelled. Your details stay as they were.',
    sw: '✅ Mabadiliko yamefutwa. Taarifa zako zinabaki kama zilivyokuwa.',
  },
  CODE_INVALID: {
    en: 'That code is not right. Check your SMS and send it again exactly as written (for example *LMM1234*). Too many wrong tries will lock it.',
    sw: 'Msimbo huo si sahihi. Angalia SMS yako kisha uutume tena kama ulivyoandikwa (kwa mfano *LMM1234*). Makosa mengi yatausimamisha.',
  },
  CODE_EXPIRED: {
    en: 'That code has expired. Ask your Samuhia desk agent to send a new one.',
    sw: 'Msimbo huo umeisha muda. Mwombe wakala wako wa Samuhia akutumie mpya.',
  },
  CODE_LOCKED: {
    en: 'That code is locked after too many wrong tries. Please wait an hour, or contact support on {phone}.',
    sw: 'Msimbo huo umesimamishwa baada ya makosa mengi. Tafadhali subiri saa moja, au wasiliana na msaada kwa {phone}.',
  },
  CODE_NOT_FOUND: {
    en: 'We could not match this code to your number. Send it from the same WhatsApp number you gave when you signed up.',
    sw: 'Hatukuweza kuhusisha msimbo huu na namba yako. Utume kutoka kwa namba ile ile ya WhatsApp uliyotoa ulipojiunga.',
  },
  CODE_ERROR: {
    en: 'We could not check that code right now. Please send it again in a minute.',
    sw: 'Hatukuweza kuhakiki msimbo huo sasa. Tafadhali utume tena baada ya dakika moja.',
  },
} satisfies Record<string, Bi>;

export type LmmxMsgKey = keyof typeof LMMX_MESSAGES;

export function lmxm(key: LmmxMsgKey, lang: Lang, params?: Record<string, string | number>): string {
  return fill(LMMX_MESSAGES[key][lang], { phone: LMMX_SUPPORT_PHONE, ...params });
}
