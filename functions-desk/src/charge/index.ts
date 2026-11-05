import { onCall } from "firebase-functions/v2/https";
import type { ChargeTicketIn, ChargeTicketOut } from "../contract.js";
import { DESK_REGION } from "../contract.js";

import { deskCallable } from "./callable.js";
import { chargeTicket } from "./chargeTicket.js";
import { BUNDLE_SECRETS } from "../kernel/secretsBundle.js";

/** STK push for the caller's own draft ticket, charged in the MAIN Paystack account with the 97.5% agent split. */
export const desk_chargeTicket = onCall<ChargeTicketIn, Promise<ChargeTicketOut>>(
  { region: DESK_REGION, cors: true, timeoutSeconds: 90, secrets: BUNDLE_SECRETS },
  deskCallable((uid, data) => chargeTicket(uid, data)),
);
