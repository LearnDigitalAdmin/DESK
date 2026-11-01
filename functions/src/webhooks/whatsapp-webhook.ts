/**
 * WhatsApp Webhook Handler
 * Main entry point for processing incoming WhatsApp messages
 */

import { Request, Response } from 'express';
import { WhatsAppWebhookPayload, WhatsAppMessage } from '../types/whatsapp.types';
import { clearSessionContext, createOrGetSession, updateSessionState } from '../services/session.service';
import { sendWhatsAppMessage, formatPhoneForWhatsApp } from '../services/whatsapp.service';
import { sendReply } from '../services/outbound.service';
import { handleLanguageSelection } from '../handlers/language.handler';
import { handleLmmAmount, handleLmmConfirm, handleLmmFreq, handleLmmMenu, handleLmmPhone } from '../handlers/lmm.handler';
import { handleHelpMenu, handleIdle, handleMainMenu } from '../handlers/menu.handler';
import {
  handleMyChamaAuthPhone,
  handleMyChamaAuthId,
  handleMyChamaSelectChama,
  handleMyChamaMenu,
  handleContributionSelect,
  handleContributionAmount,
  handleLoanProduct,
  handleLoanAmount,
  handleLoanTerm,
  handleLoanPurpose,
  handleLoanConfirm,
  handleLoanPaySelect,
  handleLoanPayAmount,
  handleLoanBalance,
  handleMgrSelect,
  handleMgrDetail,
  handleMgrPayAmount,
  handleMgrHistory,
  handleStatementType,
  handleStatementPeriod,
  handleStatementView,
  handlePayPhone,
  handlePayProvider,
  handlePayConfirm,
} from '../handlers/mychama.handler';
import {
  handlePayRentId,
  handlePayRentConfirm,
  handlePayRentMpesa,
  handlePayRentAmount,
  handlePayRentProcessing,
  handlePayRentConfirmAmount,
  handleGetInvoice,
} from '../handlers/rent.handler';
import { handleWatchMessage, handleStaleWatchTap, isWatchButtonId } from '../handlers/watch.entry';
import { handleHouseToRent } from '../handlers/house.handler';
import { isWatchState } from '../handlers/watch.handler';
import { claimMessage } from '../services/message-dedup.service';
import { logger } from '../utils/logger';
import { STATE } from '../constants/states';
import { getMessage } from '../constants/messages';
import { describeReply, mainMenuReply, Reply, resolveTap, staleReply, welcomeReply } from '../utils/ui';

/**
 * Main webhook handler for incoming WhatsApp messages
 */
export async function handleIncomingMessage(req: Request, res: Response): Promise<void> {
  try {
    // Log raw webhook receipt FIRST
    logger.info('WhatsApp webhook received', {
      method: req.method,
      contentType: req.get('content-type'),
      hasBody: !!req.body,
    });

    // Parse the incoming webhook payload
    const payload = req.body as WhatsAppWebhookPayload;

    // Log full payload structure for debugging
    logger.info('Webhook payload structure', {
      hasEntry: !!payload.entry,
      entryLength: payload.entry?.length,
      hasChanges: !!payload.entry?.[0]?.changes,
      changesLength: payload.entry?.[0]?.changes?.length,
      hasMessages: !!payload.entry?.[0]?.changes?.[0]?.value?.messages,
      messageCount: (payload.entry?.[0]?.changes?.[0]?.value?.messages || []).length,
    });

    // Validate payload structure
    if (!payload.entry?.[0]?.changes?.[0]?.value?.messages) {
      logger.warn('No messages in webhook payload - likely a status update or other event', {
        hasEntry: !!payload.entry,
        eventType: payload.entry?.[0]?.changes?.[0]?.value?.statuses ? 'status_update' : 'unknown',
      });
      res.status(200).send('ok');
      return;
    }

    // Process each message
    const messages = payload.entry[0].changes[0].value.messages || [];
    logger.info(`Processing ${messages.length} message(s)`);

    for (const message of messages) {
      await processMessage(message);
    }

    // Acknowledge successful processing
    res.status(200).send('ok');
  } catch (error) {
    logger.error('Error processing webhook', error);
    res.status(200).send('ok'); // Still return 200 to prevent retries
  }
}

/**
 * Process a single incoming message
 */
async function processMessage(message: WhatsAppMessage): Promise<void> {
  try {
    const phone = message.from;
    // Reply-button / list-row taps arrive as `interactive`; typed text as `text`.
    const interactiveId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '';
    const text = message.text?.body || interactiveId || '';
    const messageId = message.id;

    logger.setContext({ phone });
    logger.info('Processing WhatsApp message', {
      messageId,
      phone,
      textLength: text.length,
      // The message body is deliberately not logged: it can be an OTP code, an ID number or a phone number.
      messageType: message.type,
    });

    // Get or create session
    let session = await createOrGetSession(phone);

    // WhatsApp retries a delivery it thinks failed; handle each message id once.
    if (!(await claimMessage(phone, messageId))) {
      logger.info('Duplicate WhatsApp message ignored', { messageId });
      return;
    }
    logger.info('Session retrieved/created', {
      phone,
      sessionId: phone,
      currentState: session.currentState,
      language: session.language,
    });
    logger.setContext({ phone, state: session.currentState });

    // A tap on a button or list row of the shared UI is the same as typing its value (see utils/ui.ts). A tap on a
    // screen the user has already left is answered with a notice and never acted on.
    const tap = resolveTap(interactiveId, session.currentState);
    if (tap?.kind === 'stale') {
      logger.info('Stale button tap ignored');
      await sendReply(phone, session.currentState === STATE.LANGUAGE_SELECTION ? welcomeReply() : staleReply(session.language), session.currentState);
      return;
    }
    const input = tap ? tap.value : text;

    // ── Landlord Watch: replies are sent by the module itself (buttons, lists, documents) ──
    if (isWatchState(session.currentState)) {
      await handleWatchMessage(
        phone,
        { text: input, interactiveId: isWatchButtonId(interactiveId) ? interactiveId : undefined },
        session,
        message.timestamp
      );
      return;
    }
    if (isWatchButtonId(interactiveId)) {
      // A Landlord Watch button tapped after the user already left the module
      await handleStaleWatchTap(phone, session);
      return;
    }

    // "Main menu" (#) works from every screen of every flow
    if (input.trim() === '#' && session.currentState !== STATE.LANGUAGE_SELECTION && session.currentState !== STATE.INITIAL) {
      await clearSessionContext(phone);
      await updateSessionState(phone, STATE.MAIN_MENU, {});
      await sendReply(phone, mainMenuReply(session.language), STATE.MAIN_MENU);
      return;
    }

    // Route to appropriate handler based on current state
    let response: Reply | null = null;

    switch (session.currentState) {
      case STATE.LANGUAGE_SELECTION:
        logger.info('Routing to language selection handler');
        response = await handleLanguageSelection(phone, input, session);
        break;

      case STATE.MAIN_MENU:
        logger.info('Routing to main menu handler');
        response = await handleMainMenu(phone, input, session);
        break;

      // Pay Rent flow
      case STATE.PAY_RENT_WAITING_ID:
        logger.info('Routing to pay rent ID handler');
        response = await handlePayRentId(phone, input, session);
        break;

      case STATE.PAY_RENT_CONFIRM:
        logger.info('Routing to pay rent confirm handler');
        response = await handlePayRentConfirm(phone, input, session);
        break;

      case STATE.PAY_RENT_MPESA:
        logger.info('Routing to pay rent M-Pesa handler');
        response = await handlePayRentMpesa(phone, input, session);
        break;

      case STATE.PAY_RENT_AMOUNT:
        logger.info('Routing to pay rent amount handler');
        response = await handlePayRentAmount(phone, input, session);
        break;

      case STATE.PAY_RENT_PROCESSING:
        logger.info('Routing to pay rent processing handler');
        response = await handlePayRentProcessing(phone, input, session);
        break;

      case STATE.PAY_RENT_CONFIRM_AMOUNT:
        logger.info('Routing to pay rent confirm amount handler');
        response = await handlePayRentConfirmAmount(phone, input, session);
        break;

      case STATE.LMM_MENU:
        response = await handleLmmMenu(phone, input, session);
        break;
      case STATE.LMM_FREQ:
        response = await handleLmmFreq(phone, input, session);
        break;
      case STATE.LMM_AMOUNT:
        response = await handleLmmAmount(phone, input, session);
        break;
      case STATE.LMM_PHONE:
        response = await handleLmmPhone(phone, input, session);
        break;
      case STATE.LMM_CONFIRM:
        response = await handleLmmConfirm(phone, input, session);
        break;

      case STATE.GET_INVOICE_WAITING_ID:
        logger.info('Routing to get invoice handler');
        response = await handleGetInvoice(phone, input, session);
        break;

      case STATE.HELP_MENU:
        logger.info('Routing to help handler');
        response = await handleHelpMenu(phone, input, session);
        break;

      case STATE.HTR_AREA:
      case STATE.HTR_RESULTS:
      case STATE.HTR_UNIT:
      case STATE.HTR_CONTACT:
      case STATE.HTR_INQ_PHONE:
      case STATE.HTR_INQ_CONFIRM:
        response = await handleHouseToRent(phone, input, session);
        break;

      case STATE.IDLE:
        logger.info('Routing to idle handler');
        response = await handleIdle(phone, input, session);
        break;

      // ── My Chama flow (cross-project: mychama1) ──
      case STATE.MYCHAMA_AUTH_PHONE:
        logger.info('Routing to My Chama registered-phone step');
        response = await handleMyChamaAuthPhone(phone, input, session);
        break;

      case STATE.MYCHAMA_AUTH_ID:
        logger.info('Routing to My Chama identity verification');
        response = await handleMyChamaAuthId(phone, input, session);
        break;

      case STATE.MYCHAMA_SELECT_CHAMA:
        logger.info('Routing to My Chama selector');
        response = await handleMyChamaSelectChama(phone, input, session);
        break;

      case STATE.MYCHAMA_MENU:
        logger.info('Routing to My Chama menu');
        response = await handleMyChamaMenu(phone, input, session);
        break;

      case STATE.MYCHAMA_CONTRIB_SELECT:
        logger.info('Routing to My Chama contribution selector');
        response = await handleContributionSelect(phone, input, session);
        break;

      case STATE.MYCHAMA_CONTRIB_AMOUNT:
        logger.info('Routing to My Chama contribution amount');
        response = await handleContributionAmount(phone, input, session);
        break;

      case STATE.MYCHAMA_LOAN_PRODUCT:
        logger.info('Routing to My Chama loan product');
        response = await handleLoanProduct(phone, input, session);
        break;

      case STATE.MYCHAMA_LOAN_AMOUNT:
        logger.info('Routing to My Chama loan amount');
        response = await handleLoanAmount(phone, input, session);
        break;

      case STATE.MYCHAMA_LOAN_TERM:
        logger.info('Routing to My Chama loan term');
        response = await handleLoanTerm(phone, input, session);
        break;

      case STATE.MYCHAMA_LOAN_PURPOSE:
        logger.info('Routing to My Chama loan purpose');
        response = await handleLoanPurpose(phone, input, session);
        break;

      case STATE.MYCHAMA_LOAN_CONFIRM:
        logger.info('Routing to My Chama loan confirmation');
        response = await handleLoanConfirm(phone, input, session);
        break;

      case STATE.MYCHAMA_LOAN_PAY_SELECT:
        logger.info('Routing to My Chama loan repayment selector');
        response = await handleLoanPaySelect(phone, input, session);
        break;

      case STATE.MYCHAMA_LOAN_PAY_AMOUNT:
        logger.info('Routing to My Chama loan repayment amount');
        response = await handleLoanPayAmount(phone, input, session);
        break;

      case STATE.MYCHAMA_LOAN_BALANCE:
        logger.info('Routing to My Chama loan balance');
        response = await handleLoanBalance(phone, input, session);
        break;

      case STATE.MYCHAMA_MGR_SELECT:
        logger.info('Routing to My Chama merry-go-round selector');
        response = await handleMgrSelect(phone, input, session);
        break;

      case STATE.MYCHAMA_MGR_DETAIL:
        logger.info('Routing to My Chama merry-go-round detail');
        response = await handleMgrDetail(phone, input, session);
        break;

      case STATE.MYCHAMA_MGR_PAY_AMOUNT:
        logger.info('Routing to My Chama MGR payment amount');
        response = await handleMgrPayAmount(phone, input, session);
        break;

      case STATE.MYCHAMA_MGR_HISTORY:
        logger.info('Routing to My Chama merry-go-round history');
        response = await handleMgrHistory(phone, input, session);
        break;

      case STATE.MYCHAMA_STATEMENT_TYPE:
        logger.info('Routing to My Chama statement type');
        response = await handleStatementType(phone, input, session);
        break;

      case STATE.MYCHAMA_STATEMENT_PERIOD:
        logger.info('Routing to My Chama statement period');
        response = await handleStatementPeriod(phone, input, session);
        break;

      case STATE.MYCHAMA_STATEMENT_VIEW:
        logger.info('Routing to My Chama statement view');
        response = await handleStatementView(phone, input, session);
        break;

      case STATE.MYCHAMA_PAY_PHONE:
        logger.info('Routing to My Chama payment phone');
        response = await handlePayPhone(phone, input, session);
        break;

      case STATE.MYCHAMA_PAY_PROVIDER:
        logger.info('Routing to My Chama payment provider');
        response = await handlePayProvider(phone, input, session);
        break;

      case STATE.MYCHAMA_PAY_CONFIRM:
        logger.info('Routing to My Chama payment confirmation');
        response = await handlePayConfirm(phone, input, session);
        break;
      default:
        logger.warn('Unknown state', { state: session.currentState });
        await updateSessionState(phone, STATE.MAIN_MENU, {});
        response = [{ kind: 'text', text: getMessage('SYSTEM_ERROR', session.language) }, mainMenuReply(session.language)];
    }

    // Log what kind of reply, never its content: it can carry names, amounts or codes
    logger.info('Handler executed', { reply: response ? describeReply(response) : null });

    // Send the reply (text, buttons and lists; interactive ids are stamped with the state the session is now in)
    if (response) {
      await sendReply(phone, response, session.currentState);
      logger.info('Reply sent');
    } else {
      // Handlers such as Landlord Watch send their own replies and return an empty string.
      logger.info('Handler returned no direct reply');
    }
  } catch (error) {
    logger.error('Error processing message', error);

    // Try to send error message to user
    try {
      const formattedPhone = formatPhoneForWhatsApp(message.from);
      const errorMessage = 'An error occurred. Please try again.';
      await sendWhatsAppMessage(formattedPhone, errorMessage);
    } catch (sendError) {
      logger.error('Failed to send error message', sendError);
    }
  } finally {
    logger.clearContext();
  }
}
