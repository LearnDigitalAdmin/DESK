/**
 * Main Menu Handler
 * Routes user selections from the SAMUHIA main menu (a WhatsApp list; typed option numbers still work)
 */

import { Session } from '../types/session.types';
import { updateSessionState } from '../services/session.service';
import { validateMenuSelection } from '../utils/validator';
import { getMessage } from '../constants/messages';
import { STATE } from '../constants/states';
import { logger } from '../utils/logger';
import { beginMyChama } from './mychama.handler';
import { beginWatch } from './watch.entry';
import { beginHouseToRent } from './house.handler';
import { promptNationalId } from './rent.handler';
import { beginLmmx, beginLmmxJoin } from './lmmx.handler';
import { isWatchKeyword } from '../utils/watch.format';
import { helpReply, mainMenuReply, plotReply, Reply } from '../utils/ui';

/**
 * Handle main menu selection
 * Option values are the numbers the menu has always used: 1 Pay Rent, 2 Invoice, 3 My Chama, 4 Plot, 5 Exit, 6 Help,
 * 7 Landlord Watch, 8 House to Rent, 9 Lipa Mdogo Mdogo, 10 Join Lipa Mdogo Mdogo (the list shows them in a friendlier order).
 */
export async function handleMainMenu(phone: string, input: string, session: Session): Promise<Reply> {
  try {
    // Landlord Watch keyword shortcuts (WATCH / LANDLORD / MWENYE NYUMBA)
    if (isWatchKeyword(input)) {
      logger.info('Navigating to Landlord Watch (keyword)');
      return await beginWatch(phone, session);
    }

    // Validate input (1-10)
    const validation = validateMenuSelection(input, 1, 10);

    if (!validation.valid || validation.option === undefined) {
      return mainMenuReply(session.language);
    }

    const option = validation.option;

    switch (option) {
      case 1: // Pay Rent
        await updateSessionState(phone, STATE.PAY_RENT_WAITING_ID, {});
        logger.info('Navigating to Pay Rent');
        return promptNationalId(session.language);

      case 2: // Get Rent Invoice
        await updateSessionState(phone, STATE.GET_INVOICE_WAITING_ID, {});
        logger.info('Navigating to Get Invoice');
        return promptNationalId(session.language);

      case 3: // My Chama (cross-project: mychama1)
        logger.info('Navigating to My Chama');
        return await beginMyChama(phone, session);

      case 4: // Manage My Plot
        logger.info('Showing PMS links');
        return plotReply(session.language);

      case 5: // Exit
        await updateSessionState(phone, STATE.IDLE, {});
        logger.info('User exiting');
        return getMessage('GOODBYE', session.language);

      case 6: // Help
        await updateSessionState(phone, STATE.HELP_MENU, {});
        logger.info('Navigating to Help');
        return helpReply(session.language);

      case 7: // Landlord Watch
        logger.info('Navigating to Landlord Watch');
        return await beginWatch(phone, session);

      case 8: // House to Rent
        logger.info('Navigating to House to Rent');
        return await beginHouseToRent(phone, session);

      case 9: // Lipa Mdogo Mdogo (pay rent in small amounts)
        logger.info('Navigating to Lipa Mdogo Mdogo');
        return await beginLmmx(phone, session);

      case 10: // Join Lipa Mdogo Mdogo
        logger.info('Navigating to Join Lipa Mdogo Mdogo');
        return await beginLmmxJoin(phone, session);

      default:
        return mainMenuReply(session.language);
    }
  } catch (error) {
    logger.error('Error handling main menu', error);
    return getMessage('SYSTEM_ERROR', session.language);
  }
}

/**
 * Help screen: its only exit is the Main menu button, so any message (0, #, "hi") returns to the main menu.
 */
export async function handleHelpMenu(phone: string, _input: string, session: Session): Promise<Reply> {
  return returnToMainMenu(phone, session);
}

/**
 * A message from a user who chose Exit (or whose chat was left idle): welcome them back with the main menu.
 */
export async function handleIdle(phone: string, _input: string, session: Session): Promise<Reply> {
  return returnToMainMenu(phone, session);
}

/**
 * Handle returning to main menu
 */
export async function returnToMainMenu(phone: string, session: Session): Promise<Reply> {
  try {
    await updateSessionState(phone, STATE.MAIN_MENU, {});
    logger.info('Returning to main menu');
    return mainMenuReply(session.language);
  } catch (error) {
    logger.error('Error returning to main menu', error);
    return getMessage('SYSTEM_ERROR', session.language);
  }
}
