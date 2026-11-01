/**
 * Rent Payment Handler
 * Handles complete rent payment flow: tenant lookup, invoice retrieval, payment processing.
 *
 * Presentation is interactive (buttons, see utils/ui.ts); the business logic (Firestore lookup, payment initiation)
 * is unchanged. Tapping a button is the same as typing its value: CONTINUE, EDIT, FULL, YES, NEW, 0 (back), # (menu).
 */

import { Session } from '../types/session.types';
import { updateSessionState, updateSessionContext, clearSessionContext } from '../services/session.service';
import { validateNationalId, validatePhoneNumber, checkNavigationCommand } from '../utils/validator';
import { getMessage } from '../constants/messages';
import { ulabel } from '../constants/ui.messages';
import { STATE } from '../constants/states';
import { logger } from '../utils/logger';
import { db } from '../config/firebase.config';
import { initiatePayment, hasPaymentInfo, getAssetContactInfo } from '../services/payment.service';
import { btn, mainButton, mainMenuReply, Reply, row, uiButtons, uiList, uiText, welcomeReply, withNotice } from '../utils/ui';
import { startLmm } from './lmm.handler';
import { Outbound } from '../types/watch.types';

interface TenantData {
  id: string;
  localId: number;
  name: string;
  phone?: string;
  email?: string;
  rentAmount?: number;
}

interface InvoiceData {
  id: string;
  tenantId: number;
  propertyId: number;
  billingMonth: string;
  rentAmount: number;
  waterCharges?: number;
  powerCharges?: number;
  otherCharges?: number;
  totalAmount: number;
  amountPaid: number;
  arrears: number;
  isPaid: boolean;
  dueDate?: string;
  paidDate?: string;
  pdfUrl?: string;
}

type Lang = Session['language'];

/**
 * Format currency for display
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
  }).format(amount);
}

const outstandingOf = (invoice: InvoiceData): number => invoice.totalAmount - invoice.amountPaid;

/* ================================================================== *
 * Screens
 * ================================================================== */

const backButton = (lang: Lang) => btn('0', ulabel('BACK', lang));

/** First prompt, from the main menu. */
export function promptNationalId(lang: Lang): Outbound {
  return uiButtons(getMessage('ENTER_NATIONAL_ID', lang), [mainButton(lang)]);
}

/** Re-prompt for the tenant ID (after an error, "search again" or a restart). */
function promptTenantId(lang: Lang): Outbound {
  return uiButtons(getMessage('ENTER_TENANT_ID', lang), [mainButton(lang)]);
}

function tenantFound(lang: Lang, tenant: TenantData, invoice: InvoiceData): Outbound {
  // A list, not buttons: WhatsApp shows at most 3 buttons, and there are now 4 choices (the row ids are the same values as before).
  return uiList(
    getMessage('TENANT_FOUND', lang, {
      name: tenant.name,
      outstanding: formatCurrency(outstandingOf(invoice)),
      billing: String(invoice.billingMonth),
    }),
    ulabel('LIST_BUTTON', lang),
    [
      row('CONTINUE', ulabel('PAY_ALL_AT_ONCE', lang)),
      row('LMM', ulabel('LMM', lang)),
      row('EDIT', ulabel('SEARCH_AGAIN', lang)),
      row('#', ulabel('MAIN', lang)),
    ]
  );
}

/** The tenant-found screen rebuilt from the saved session (used by Lipa Mos Mos to go back). */
export function tenantFoundScreen(session: Session): Outbound | null {
  const { tenant, invoice } = readSaved(session);
  return tenant && invoice ? tenantFound(session.language, tenant, invoice) : null;
}

function promptPhone(lang: Lang): Outbound {
  return uiButtons(getMessage('ENTER_MPESA_PHONE', lang), [backButton(lang), mainButton(lang)]);
}

function promptAmount(lang: Lang, invoice: InvoiceData): Outbound {
  return uiButtons(getMessage('ENTER_PAYMENT_AMOUNT', lang, { outstanding: formatCurrency(outstandingOf(invoice)) }), [
    btn('FULL', ulabel('PAY_FULL', lang)),
    backButton(lang),
    mainButton(lang),
  ]);
}

function paymentSummary(lang: Lang, amount: number, mpesaPhone: string): Outbound {
  return uiButtons(getMessage('PAY_SUMMARY', lang, { amount: formatCurrency(amount), phone: mpesaPhone }), [
    btn('YES', ulabel('CONFIRM', lang)),
    backButton(lang),
    mainButton(lang),
  ]);
}

/** A result message followed by the main menu, so the user is never left at a dead end. */
const thenMenu = (message: string, lang: Lang): Reply => [uiText(message), mainMenuReply(lang)];

/** Unexpected error: say so, reset to the main menu, and show it. */
async function failToMenu(phone: string, session: Session): Promise<Reply> {
  await clearSessionContext(phone);
  await updateSessionState(phone, STATE.MAIN_MENU, {});
  return thenMenu(getMessage('SYSTEM_ERROR', session.language), session.language);
}

/* ================================================================== *
 * Navigation
 * ================================================================== */

/** Where "Back" (0) goes from each step. A step without an entry goes to the main menu. */
const RENT_BACK: Partial<Record<string, STATE>> = {
  [STATE.PAY_RENT_CONFIRM]: STATE.PAY_RENT_WAITING_ID,
  [STATE.PAY_RENT_MPESA]: STATE.PAY_RENT_WAITING_ID,
  [STATE.PAY_RENT_AMOUNT]: STATE.PAY_RENT_MPESA,
  [STATE.PAY_RENT_PROCESSING]: STATE.PAY_RENT_AMOUNT,
  [STATE.PAY_RENT_CONFIRM_AMOUNT]: STATE.PAY_RENT_PROCESSING,
};

function readSaved(session: Session): { tenant: TenantData | null; invoice: InvoiceData | null } {
  const ctx = session.context || {};
  try {
    return {
      tenant: ctx.foundTenant ? (JSON.parse(ctx.foundTenant as string) as TenantData) : null,
      invoice: ctx.foundInvoice ? (JSON.parse(ctx.foundInvoice as string) as InvoiceData) : null,
    };
  } catch {
    return { tenant: null, invoice: null };
  }
}

/**
 * The screen for a Pay Rent step, rebuilt from the saved session. Returns null when what the step needs is missing
 * (the caller then falls back to the first step).
 */
function renderRentStep(state: string, session: Session): Outbound | null {
  const lang = session.language;
  const { tenant, invoice } = readSaved(session);
  switch (state) {
    case STATE.PAY_RENT_WAITING_ID:
      return promptTenantId(lang);
    case STATE.PAY_RENT_MPESA:
      return tenant && invoice ? tenantFound(lang, tenant, invoice) : null;
    case STATE.PAY_RENT_AMOUNT:
      return promptPhone(lang);
    case STATE.PAY_RENT_PROCESSING:
      return invoice ? promptAmount(lang, invoice) : null;
    case STATE.PAY_RENT_CONFIRM_AMOUNT: {
      const ctx = session.context || {};
      return typeof ctx.paymentAmount === 'number' && ctx.mpesaPhone ? paymentSummary(lang, ctx.paymentAmount, String(ctx.mpesaPhone)) : null;
    }
    default:
      return null;
  }
}

/**
 * Typed navigation shared by Pay Rent and Get Invoice: 0 back, 00 start over, 000 exit to the language screen.
 * Returns the reply when the input was a navigation command, otherwise null.
 */
async function handleNavigation(phone: string, input: string, session: Session): Promise<Reply | null> {
  const lang = session.language;
  const nav = checkNavigationCommand(input);

  if (nav.type === 'exit') {
    logger.info('User exiting to language selection', { phone });
    await clearSessionContext(phone);
    await updateSessionState(phone, STATE.LANGUAGE_SELECTION, {});
    return welcomeReply();
  }

  if (nav.type === 'restart') {
    logger.info('User restarting', { phone });
    const first = session.currentState === STATE.GET_INVOICE_WAITING_ID ? STATE.GET_INVOICE_WAITING_ID : STATE.PAY_RENT_WAITING_ID;
    await clearSessionContext(phone);
    await updateSessionState(phone, first, {});
    return promptTenantId(lang);
  }

  if (nav.type === 'back') {
    const target = RENT_BACK[session.currentState];
    const screen = target ? renderRentStep(target, session) : null;
    if (!target || !screen) {
      // First step (or nothing saved to go back to): leave to the main menu
      await clearSessionContext(phone);
      await updateSessionState(phone, STATE.MAIN_MENU, {});
      return mainMenuReply(lang);
    }
    logger.info('User going back', { phone, from: session.currentState, to: target });
    await updateSessionState(phone, target, {});
    return screen;
  }

  return null;
}

/* ================================================================== *
 * Pay Rent
 * ================================================================== */

/**
 * Handle tenant ID for pay rent
 */
export async function handlePayRentId(phone: string, input: string, session: Session): Promise<Reply> {
  try {
    const lang = session.language;

    // Check navigation
    const nav = await handleNavigation(phone, input, session);
    if (nav) return nav;

    // Validate tenant ID format
    if (!validateNationalId(input)) {
      return withNotice(promptTenantId(lang), getMessage('INVALID_ID', lang));
    }

    const tenantId = input.trim();

    // Perform the search immediately (don't wait for next message)
    logger.info('Tenant ID collected, searching for tenant and invoice', { tenantId });

    // Search for tenant and invoice in Firestore
    const usersRef = db.collection('users');
    const allUsers = await usersRef.get();

    let foundTenant: TenantData | null = null;
    let foundInvoice: InvoiceData | null = null;
    let assetId: string | null = null;

    // Search through all users for the tenant
    for (const userDoc of allUsers.docs) {
      const tenantIdNum = parseInt(tenantId);
      const searchIds = isNaN(tenantIdNum) ? [tenantId] : [tenantId, tenantIdNum];

      try {
        const tenantsRef = userDoc.ref.collection('tenants');
        const tenantSnapshot = await tenantsRef.where('localId', 'in', searchIds).get();

        if (!tenantSnapshot.empty) {
          const tenantDoc = tenantSnapshot.docs[0];
          foundTenant = {
            id: tenantDoc.id,
            ...(tenantDoc.data() as any),
          };
          assetId = userDoc.id;

          logger.info('Tenant found', { tenantId, assetId });
          break;
        }
      } catch (err) {
        // Continue searching other users
        continue;
      }
    }

    if (!foundTenant) {
      logger.warn('Tenant not found', { tenantId });
      return withNotice(promptTenantId(lang), getMessage('TENANT_NOT_FOUND', lang));
    }

    // Find unpaid invoice or last paid invoice
    if (assetId) {
      const invoicesRef = db.collection('users').doc(assetId).collection('invoices');
      const tenantIdNum = parseInt(tenantId);
      const searchIds = isNaN(tenantIdNum) ? [tenantId] : [tenantId, tenantIdNum];

      // Search for unpaid invoices first
      const unpaidSnapshot = await invoicesRef
        .where('tenantId', 'in', searchIds)
        .where('isPaid', '==', false)
        .get();

      if (!unpaidSnapshot.empty) {
        const invoiceDoc = unpaidSnapshot.docs[0];
        foundInvoice = {
          id: invoiceDoc.id,
          ...(invoiceDoc.data() as any),
        };
      }
    }

    if (!foundInvoice) {
      logger.warn('No invoice found for tenant', { tenantId });
      return withNotice(promptTenantId(lang), getMessage('INVOICE_NOT_FOUND', lang));
    }

    // Store found data in session
    await updateSessionContext(phone, {
      tenantId,
      foundTenant: JSON.stringify(foundTenant),
      foundInvoice: JSON.stringify(foundInvoice),
      assetId,
    });

    // Move to next state
    await updateSessionState(phone, STATE.PAY_RENT_MPESA, {});

    return tenantFound(lang, foundTenant, foundInvoice);
  } catch (error) {
    logger.error('Error handling rent ID', error);
    return failToMenu(phone, session);
  }
}

/**
 * Legacy step: the tenant-found screen now lives in PAY_RENT_MPESA. A session parked here (for example mid-deploy)
 * is moved across and handled as if it had been there all along.
 */
export async function handlePayRentConfirm(phone: string, input: string, session: Session): Promise<Reply> {
  await updateSessionState(phone, STATE.PAY_RENT_MPESA, {});
  return handlePayRentMpesa(phone, input, { ...session, currentState: STATE.PAY_RENT_MPESA });
}

/**
 * Step 2: tenant found. Continue to payment, or search again.
 */
export async function handlePayRentMpesa(phone: string, input: string, session: Session): Promise<Reply> {
  try {
    const lang = session.language;

    // Check navigation
    const nav = await handleNavigation(phone, input, session);
    if (nav) return nav;

    const response = input.trim().toUpperCase();

    // Handle EDIT request
    if (['EDIT', 'BAGUISHA', 'NO'].includes(response)) {
      logger.info('User requested to edit tenant', { phone });
      await clearSessionContext(phone);
      await updateSessionState(phone, STATE.PAY_RENT_WAITING_ID, {});
      return promptTenantId(lang);
    }

    // Lipa Mos Mos: pay a little at a time
    if (response === 'LMM') return startLmm(phone, session);

    // Handle CONTINUE
    if (['CONTINUE', 'ENDELEA', 'YES', 'NDIO'].includes(response)) {
      logger.info('User proceeding to payment', { phone });
      await updateSessionState(phone, STATE.PAY_RENT_AMOUNT, {});
      return promptPhone(lang);
    }

    // Anything else: show the choices again
    const screen = renderRentStep(STATE.PAY_RENT_MPESA, session);
    if (!screen) {
      await clearSessionContext(phone);
      await updateSessionState(phone, STATE.PAY_RENT_WAITING_ID, {});
      return promptTenantId(lang);
    }
    return withNotice(screen, getMessage('INVALID_INPUT', lang));
  } catch (error) {
    logger.error('Error handling rent confirmation', error);
    return failToMenu(phone, session);
  }
}

/**
 * Step 3: collect the M-Pesa phone number
 */
export async function handlePayRentAmount(phone: string, input: string, session: Session): Promise<Reply> {
  try {
    const lang = session.language;

    // Check navigation
    const nav = await handleNavigation(phone, input, session);
    if (nav) return nav;

    const mpesaPhone = input.trim();
    const validation = validatePhoneNumber(mpesaPhone);

    if (!validation.valid || !validation.formatted) {
      return withNotice(promptPhone(lang), getMessage('INVALID_PHONE', lang));
    }

    const { invoice } = readSaved(session);
    if (!invoice) {
      await clearSessionContext(phone);
      await updateSessionState(phone, STATE.PAY_RENT_WAITING_ID, {});
      return promptTenantId(lang);
    }

    // Store raw phone in 07/01 format for payment service to format
    await updateSessionContext(phone, { mpesaPhone });
    await updateSessionState(phone, STATE.PAY_RENT_PROCESSING, {});
    return promptAmount(lang, invoice);
  } catch (error) {
    logger.error('Error handling M-Pesa phone', error);
    return failToMenu(phone, session);
  }
}

/**
 * Step 4: collect the amount
 */
export async function handlePayRentProcessing(phone: string, input: string, session: Session): Promise<Reply> {
  try {
    const lang = session.language;

    // Check navigation
    const nav = await handleNavigation(phone, input, session);
    if (nav) return nav;

    const { invoice } = readSaved(session);
    if (!invoice) {
      await clearSessionContext(phone);
      await updateSessionState(phone, STATE.PAY_RENT_WAITING_ID, {});
      return promptTenantId(lang);
    }
    const outstanding = outstandingOf(invoice);

    const amountInput = input.trim();
    const wantsFull = ['FULL', 'ZOTE', 'YOTE'].includes(amountInput.toUpperCase());
    const amount = wantsFull ? outstanding : parseFloat(amountInput);

    if (isNaN(amount) || amount <= 0) {
      return withNotice(promptAmount(lang, invoice), getMessage('INVALID_AMOUNT', lang));
    }

    if (amount > outstanding) {
      return withNotice(
        promptAmount(lang, invoice),
        getMessage('INVALID_AMOUNT_EXCEEDS', lang, { outstanding: formatCurrency(outstanding) })
      );
    }

    await updateSessionContext(phone, { paymentAmount: amount });
    await updateSessionState(phone, STATE.PAY_RENT_CONFIRM_AMOUNT, {});

    return paymentSummary(lang, amount, String(session.context.mpesaPhone ?? ''));
  } catch (error) {
    logger.error('Error processing payment amount', error);
    return failToMenu(phone, session);
  }
}

/**
 * Step 5: Confirm and complete payment
 */
export async function handlePayRentConfirmAmount(phone: string, input: string, session: Session): Promise<Reply> {
  try {
    const lang = session.language;

    // Check navigation
    const nav = await handleNavigation(phone, input, session);
    if (nav) return nav;

    const response = input.trim().toUpperCase();

    if (!['YES', 'Y', 'NDIO', 'NDIYO'].includes(response)) {
      const screen = renderRentStep(STATE.PAY_RENT_CONFIRM_AMOUNT, session);
      if (!screen) return failToMenu(phone, session);
      return withNotice(screen, getMessage('INVALID_INPUT', lang));
    }

    logger.info('Processing rent payment', { phone });

    const context = session.context;
    const foundTenant = JSON.parse(context.foundTenant as string);
    const foundInvoice = JSON.parse(context.foundInvoice as string);
    const mpesaPhone = context.mpesaPhone as string;
    const paymentAmount = context.paymentAmount as number;
    const assetId = context.assetId as string;

    // CRITICAL: Update state immediately to prevent duplicate processing
    // if webhook receives the same message twice
    await updateSessionState(phone, STATE.PAY_RENT_PROCESSING, {});

    // Process payment and update invoice
    try {
      logger.info('Processing rent payment', {
        phone: mpesaPhone,
        amount: paymentAmount,
        tenantName: foundTenant.name,
        invoiceId: foundInvoice.id,
        assetId,
      });

      // Step 1: Fetch asset document to get payment info and contact details
      let assetData: any = null;
      try {
        const assetDoc = await db.collection('users').doc(assetId).get();
        if (assetDoc.exists) {
          assetData = assetDoc.data();
          logger.info('Asset document retrieved', {
            assetId,
            hasPaymentInfo: hasPaymentInfo(assetData),
          });
        }
      } catch (assetError) {
        logger.warn('Failed to fetch asset document', assetError);
      }

      // Step 2: Check if asset has payment processing capability
      if (!hasPaymentInfo(assetData)) {
        // No payment info - provide fallback contact info
        const contactInfo = getAssetContactInfo(assetData);
        const assetPhone = contactInfo.phone || 'unavailable';
        const assetName = contactInfo.name || 'Property Manager';

        logger.info('Asset has no payment processing info, providing contact fallback', {
          assetId,
          assetPhone,
        });

        // Clear session and show fallback message
        await clearSessionContext(phone);
        await updateSessionState(phone, STATE.MAIN_MENU, {});

        return thenMenu(getMessage('PAY_NOT_AVAILABLE', lang, { name: assetName, phone: assetPhone }), lang);
      }

      // Step 3: Initiate payment with asset details
      let paymentReference: string = '';

      try {
        const paymentResult = await initiatePayment({
          invoiceId: foundInvoice.id as any,
          invoice: foundInvoice,
          tenantName: foundTenant.name,
          amount: paymentAmount,
          phone: mpesaPhone,
          paymentMethod: 'mpesa',
          assetId,
          assetName: assetData?.name,
        });

        if (!paymentResult.success) {
          logger.error('Payment initiation failed', {
            reference: paymentResult.reference,
            message: paymentResult.message,
          });

          // Clear session and show error - DO NOT update invoice
          await clearSessionContext(phone);
          await updateSessionState(phone, STATE.MAIN_MENU, {});

          return thenMenu(getMessage('PAY_FAILED_DETAIL', lang, { reason: paymentResult.message }), lang);
        }

        paymentReference = paymentResult.reference;

        logger.info('Payment initiated successfully', {
          reference: paymentReference,
          phone: mpesaPhone,
          amount: paymentAmount,
          tenantId: foundTenant.localId,
        });
      } catch (paymentInitError) {
        logger.error('Payment initiation error', paymentInitError);

        // Clear session and show error - DO NOT update invoice
        await clearSessionContext(phone);
        await updateSessionState(phone, STATE.MAIN_MENU, {});

        return thenMenu(getMessage('PAY_FAILED_UNEXPECTED', lang), lang);
      }

      // The invoice is NOT touched here. Initiating an M-Pesa prompt is not a payment: PAY's webhook credits the invoice
      // (users/{agent}/invoices/{id}) when Paystack confirms it — full => paid, part-payment => partial with the balance
      // as arrears — and sends the payment SMS. A prompt that is never completed leaves the invoice as it was.

      // Step 4: Clear session and return to main menu
      await clearSessionContext(phone);
      await updateSessionState(phone, STATE.MAIN_MENU, {});

      return thenMenu(
        getMessage('PAY_INITIATED', lang, {
          amount: formatCurrency(paymentAmount),
          name: foundTenant.name,
          phone: mpesaPhone,
          date: new Date().toLocaleDateString('en-KE'),
          reference: paymentReference,
        }),
        lang
      );
    } catch (paymentError) {
      logger.error('Payment processing failed', paymentError);

      // Clear session on payment error and return to main menu
      await clearSessionContext(phone);
      await updateSessionState(phone, STATE.MAIN_MENU, {});

      const errorMessage = paymentError instanceof Error ? paymentError.message : 'Payment processing failed';
      return thenMenu(getMessage('PAY_FAILED_DETAIL', lang, { reason: errorMessage }), lang);
    }
  } catch (error) {
    logger.error('Error confirming rent payment', error);
    return failToMenu(phone, session);
  }
}

/* ================================================================== *
 * Get Invoice
 * ================================================================== */

/**
 * Entry for GET_INVOICE_WAITING_ID. The first message is the tenant ID; once an invoice has been shown (tenantId is
 * saved) later messages are navigation, "Another invoice", or a new ID typed straight away.
 */
export async function handleGetInvoice(phone: string, input: string, session: Session): Promise<Reply> {
  return session.context?.tenantId === undefined ? handleGetInvoiceId(phone, input, session) : handleGetInvoiceMenu(phone, input, session);
}

/**
 * Get Invoice Handler
 * Fetch and display tenant invoice with PDF link if available
 * Similar to Pay Rent flow but only retrieves and displays invoice
 */
export async function handleGetInvoiceId(phone: string, input: string, session: Session): Promise<Reply> {
  try {
    const lang = session.language;

    // Check navigation
    const nav = await handleNavigation(phone, input, session);
    if (nav) return nav;

    // Validate tenant ID format
    if (!validateNationalId(input)) {
      return withNotice(promptTenantId(lang), getMessage('INVALID_ID', lang));
    }

    const tenantId = input.trim();

    logger.info('🔍 Get Invoice: Tenant ID collected, searching for tenant and invoice', { tenantId });

    // Search for tenant and invoice in Firestore (same as Pay Rent)
    const usersRef = db.collection('users');
    const allUsers = await usersRef.get();

    let foundTenant: TenantData | null = null;
    let foundInvoice: InvoiceData | null = null;
    let assetId: string | null = null;

    // Search through all users for the tenant
    for (const userDoc of allUsers.docs) {
      const tenantIdNum = parseInt(tenantId);
      const searchIds = isNaN(tenantIdNum) ? [tenantId] : [tenantId, tenantIdNum];

      try {
        const tenantsRef = userDoc.ref.collection('tenants');
        const tenantSnapshot = await tenantsRef.where('localId', 'in', searchIds).get();

        if (!tenantSnapshot.empty) {
          const tenantDoc = tenantSnapshot.docs[0];
          foundTenant = {
            id: tenantDoc.id,
            ...(tenantDoc.data() as any),
          };
          assetId = userDoc.id;

          logger.info('👤 Tenant found for invoice retrieval', { tenantId, assetId });
          break;
        }
      } catch (err) {
        // Continue searching other users
        continue;
      }
    }

    if (!foundTenant) {
      logger.warn('❌ Tenant not found for invoice', { tenantId });
      return withNotice(promptTenantId(lang), getMessage('TENANT_NOT_FOUND', lang));
    }

    // Find unpaid invoice or last paid invoice
    if (assetId) {
      const invoicesRef = db.collection('users').doc(assetId).collection('invoices');
      const tenantIdNum = parseInt(tenantId);
      const searchIds = isNaN(tenantIdNum) ? [tenantId] : [tenantId, tenantIdNum];

      // Search for unpaid invoices first
      const unpaidSnapshot = await invoicesRef
        .where('tenantId', 'in', searchIds)
        .where('isPaid', '==', false)
        .get();

      if (!unpaidSnapshot.empty) {
        const invoiceDoc = unpaidSnapshot.docs[0];
        foundInvoice = {
          id: invoiceDoc.id,
          ...(invoiceDoc.data() as any),
        };
      }
    }

    if (!foundInvoice) {
      logger.warn('❌ No invoice found for tenant', { tenantId });
      return withNotice(promptTenantId(lang), getMessage('INVOICE_NOT_FOUND', lang));
    }

    // Store found data in session for potential future use
    await updateSessionContext(phone, {
      tenantId,
      foundTenant: JSON.stringify(foundTenant),
      foundInvoice: JSON.stringify(foundInvoice),
      assetId,
    });

    logger.info('📄 Invoice retrieved successfully', {
      tenantId,
      invoiceId: foundInvoice.id,
      hasPdfUrl: !!foundInvoice.pdfUrl,
    });

    // Format invoice display
    const body =
      getMessage('INVOICE_DETAILS', lang, {
        name: foundTenant.name,
        billing: String(foundInvoice.billingMonth),
        rent: formatCurrency(foundInvoice.rentAmount),
        water: formatCurrency(foundInvoice.waterCharges || 0),
        power: formatCurrency(foundInvoice.powerCharges || 0),
        other: formatCurrency(foundInvoice.otherCharges || 0),
        total: formatCurrency(foundInvoice.totalAmount),
        paid: formatCurrency(foundInvoice.amountPaid),
        outstanding: formatCurrency(outstandingOf(foundInvoice)),
      }) +
      (foundInvoice.dueDate ? getMessage('INVOICE_DUE', lang, { date: foundInvoice.dueDate }) : '') +
      (foundInvoice.paidDate ? getMessage('INVOICE_PAID_ON', lang, { date: foundInvoice.paidDate }) : '') +
      (foundInvoice.pdfUrl ? getMessage('INVOICE_PDF', lang, { url: foundInvoice.pdfUrl }) : getMessage('INVOICE_NO_PDF', lang));

    // Stay in this state: follow-up messages are handled by handleGetInvoiceMenu
    await updateSessionState(phone, STATE.GET_INVOICE_WAITING_ID, {});

    return uiButtons(body, [btn('NEW', ulabel('ANOTHER_INVOICE', lang)), mainButton(lang)]);
  } catch (error) {
    logger.error('Error handling get invoice', error);
    return failToMenu(phone, session);
  }
}

/**
 * Handle GET_INVOICE_WAITING_ID once an invoice has been shown:
 * "Another invoice" (NEW) or a new tenant ID starts a fresh lookup; 0 / # return to the main menu.
 */
export async function handleGetInvoiceMenu(phone: string, input: string, session: Session): Promise<Reply> {
  try {
    const lang = session.language;

    // Check navigation commands
    const nav = await handleNavigation(phone, input, session);
    if (nav) return nav;

    // Start over: forget the previous lookup so the next message is treated as a tenant ID
    await clearSessionContext(phone);

    if (input.trim().toUpperCase() === 'NEW') {
      return promptTenantId(lang);
    }
    if (validateNationalId(input)) {
      return handleGetInvoiceId(phone, input, { ...session, context: {} });
    }
    return promptTenantId(lang);
  } catch (error) {
    logger.error('Error in get invoice menu', error);
    return failToMenu(phone, session);
  }
}
