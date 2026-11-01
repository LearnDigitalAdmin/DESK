/**
 * Shared interactive UI: labels and static copy, English + Kiswahili.
 *
 * Label limits (WhatsApp): reply button 20, list row title 24, row description 72, list button 20.
 * Every label here stays within 20 so it is valid as a button *or* a row (enforced by __tests__/ui/ui.test.ts).
 * Placeholders use {braces}; see `ulabel` / `umsg`.
 */

import { Lang } from '../types/watch.types';
import { fill } from '../utils/watch.format';

type Bi = { en: string; sw: string };

export const UI_LABELS = {
  // list / navigation
  LIST_BUTTON: { en: 'Choose', sw: 'Chagua' },
  BACK: { en: 'Back', sw: 'Nyuma' },
  MAIN: { en: 'Main menu', sw: 'Menyu kuu' },
  CHAMA_MENU: { en: 'My Chama menu', sw: 'Menyu ya My Chama' },
  CANCEL: { en: 'Cancel', sw: 'Ghairi' },
  PREV: { en: '‹ Previous', sw: '‹ Iliyopita' },
  MORE: { en: 'More ›', sw: 'Zaidi ›' },
  // language
  ENGLISH: { en: 'English', sw: 'English' },
  KISWAHILI: { en: 'Kiswahili', sw: 'Kiswahili' },
  // actions
  CONTINUE: { en: 'Continue', sw: 'Endelea' },
  SEARCH_AGAIN: { en: 'Search again', sw: 'Tafuta tena' },
  CONFIRM: { en: 'Confirm', sw: 'Thibitisha' },
  PAY_NOW: { en: 'Pay now', sw: 'Lipa sasa' },
  LMM: { en: 'Lipa Mos Mos', sw: 'Lipa Mos Mos' },
  DAILY: { en: 'Daily', sw: 'Kila siku' },
  WEEKLY: { en: 'Weekly', sw: 'Kila wiki' },
  BIWEEKLY: { en: 'Every 2 weeks', sw: 'Kila wiki 2' },
  CHANGE_PLAN: { en: 'Change how often', sw: 'Badilisha mara' },
  PAY_ALL_AT_ONCE: { en: 'Pay in full', sw: 'Lipa kikamilifu' },
  PAY_FULL: { en: 'Pay full amount', sw: 'Lipa kiasi chote' },
  PAY_INSTALMENT: { en: 'Pay instalment', sw: 'Lipa awamu' },
  CLEAR_LOAN: { en: 'Clear the loan', sw: 'Maliza mkopo' },
  SKIP: { en: 'Skip', sw: 'Ruka' },
  SUBMIT: { en: 'Submit', sw: 'Tuma' },
  ANOTHER_INVOICE: { en: 'Another invoice', sw: 'Ankara nyingine' },
  USE_NUMBER: { en: 'Use {phone}', sw: 'Tumia {phone}' },
  MPESA: { en: 'M-Pesa', sw: 'M-Pesa' },
  AIRTEL: { en: 'Airtel Money', sw: 'Airtel Money' },
} satisfies Record<string, Bi>;

export type UiLabelKey = keyof typeof UI_LABELS;

export function ulabel(key: UiLabelKey, lang: Lang, params?: Record<string, string | number>): string {
  return fill(UI_LABELS[key][lang], params);
}

/**
 * Main-menu rows. `value` is the option number the main-menu handler has always understood, so typing 7 still opens
 * Landlord Watch. The ORDER here is the display order (Exit last), not numeric.
 */
export const MAIN_MENU_ROWS = [
  { value: '1', title: { en: 'Pay Rent', sw: 'Lipa Kodi' }, desc: { en: 'Pay your rent with M-Pesa', sw: 'Lipa kodi yako kwa M-Pesa' } },
  {
    value: '2',
    title: { en: 'Get Rent Invoice', sw: 'Pata Ankara ya Kodi' },
    desc: { en: 'View your invoice and its PDF link', sw: 'Ona ankara yako na kiungo cha PDF' },
  },
  {
    value: '3',
    title: { en: 'My Chama', sw: 'My Chama' },
    desc: { en: 'Contributions, loans, merry-go-round', sw: 'Michango, mikopo, mzunguko' },
  },
  {
    value: '4',
    title: { en: 'Manage My Plot', sw: 'Simamia Kipande Changu' },
    desc: { en: 'Property management portal and contacts', sw: 'Portali ya usimamizi wa mali na mawasiliano' },
  },
  {
    value: '7',
    title: { en: 'Landlord Watch', sw: 'Landlord Watch' },
    desc: { en: 'Follow rent collected on your property', sw: 'Fuatilia kodi iliyokusanywa kwenye mali yako' },
  },
  {
    value: '8',
    title: { en: 'House to Rent', sw: 'Nyumba ya Kupanga' },
    desc: { en: 'Find vacant houses and units to rent', sw: 'Tafuta nyumba na vyumba vilivyo wazi vya kupanga' },
  },
  { value: '6', title: { en: 'Help', sw: 'Msaada' }, desc: { en: 'Contact SAMUHIA support', sw: 'Wasiliana na msaada wa SAMUHIA' } },
  { value: '5', title: { en: 'Exit', sw: 'Toka' }, desc: { en: 'End this chat', sw: 'Maliza mazungumzo haya' } },
] as const satisfies ReadonlyArray<{ value: string; title: Bi; desc: Bi }>;

export const UI_MESSAGES = {
  // Shown before a language is chosen, so it is bilingual in both entries.
  WELCOME: {
    en: 'Welcome to *SAMUHIA* — Property & Chama Manager 🏠\nKaribu *SAMUHIA* — Msimamizi wa Mali na Chama\n\nChoose your language / Chagua lugha yako:',
    sw: 'Welcome to *SAMUHIA* — Property & Chama Manager 🏠\nKaribu *SAMUHIA* — Msimamizi wa Mali na Chama\n\nChoose your language / Chagua lugha yako:',
  },
  MAIN_MENU: {
    en: '🏠 *SAMUHIA* — Property & Chama Manager\n\nWhat would you like to do?',
    sw: '🏠 *SAMUHIA* — Msimamizi wa Mali na Chama\n\nUngependa kufanya nini?',
  },
  HELP: {
    en: '*Help & Support*\n\n📞 Phone: +254791286165\n📧 Email: info@samuhia.co.ke\n🌐 Web: www.samuhia.co.ke\n\nSupport hours: 9 AM – 5 PM (weekdays)',
    sw: '*Msaada na Usaidizi*\n\n📞 Simu: +254791286165\n📧 Barua pepe: info@samuhia.co.ke\n🌐 Wavuti: www.samuhia.co.ke\n\nSaa za msaada: 9 AM – 5 PM (siku za kazi)',
  },
  PLOT: {
    en: '*Manage Your Property*\n\n📞 Call us: 0791286165 or 0111538613\n\n📱 Mobile app: https://plot.samuhia.co.ke\n🌐 Web portal: https://plot.samuhia.co.ke\n💻 Desk portal: https://desk.samuhia.co.ke',
    sw: '*Simamia Ploti Yako*\n\n📞 Tupigie: 0791286165 au 0111538613\n\n📱 Programu ya simu: https://plot.samuhia.co.ke\n🌐 Portali ya wavuti: https://plot.samuhia.co.ke\n💻 Portali ya Desk: https://desk.samuhia.co.ke',
  },
  STALE: {
    en: '⏱️ That option is no longer active. Please use the latest menu, or tap *Main menu*.',
    sw: '⏱️ Chaguo hilo halifanyi kazi tena. Tafadhali tumia menyu ya hivi karibuni, au gusa *Menyu kuu*.',
  },
} satisfies Record<string, Bi>;

export type UiMsgKey = keyof typeof UI_MESSAGES;

export function umsg(key: UiMsgKey, lang: Lang, params?: Record<string, string | number>): string {
  return fill(UI_MESSAGES[key][lang], params);
}
