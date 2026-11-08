/**
 * The ONLY way desk UI talks to the backend. Never call httpsCallable / getFunctions elsewhere.
 */
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import "../../services/firebaseService"; // side effect: initialises the Firebase app
import { DESK_REGION } from "./contract";
import type {
  NetDecideIn, NetInviteIn, NetOptionsIn, NetTeamIn,
  CreateRequestIn, ListMyDocsIn, ListRequestsIn, SyncEmailIn, SyncPayoutAccountsIn, TopGetDeskIn, TopGetDocIn,
  TopListDesksIn, TopListPayablesIn, TopPayoutIn, TopRequestOtpIn, TopSetDeskStatusIn, TopSetRankIn,
  UpdateRequestIn, UploadDocIn,
  ApplyAgentIn, ChargeTicketIn, DeskCallableMap, DeskCallableName, EndSessionIn, GetEarningsIn,
  ConfirmSupportIn, InitiateRentStkIn, LogSupportIn, QuoteServiceIn, RequestAccessIn, RequestActionOtpIn,
  ReportPropertiesIn, ResolveEntityIn, SaveDraftIn, ValidateImportIn, VerifyAccessIn, VerifyActionOtpIn,
} from "./contract";

export class DeskApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DeskApiError";
    this.code = code;
  }
}

const FRIENDLY: Record<string, string> = {
  "functions/unauthenticated": "Please sign in again.",
  "functions/permission-denied": "That isn't allowed. Check your session or the code you entered.",
  "functions/not-found": "We couldn't find that.",
  "functions/invalid-argument": "Some details are missing or wrong.",
  "functions/failed-precondition": "That can't be done right now.",
  "functions/unavailable": "Network problem. Please try again.",
  "functions/deadline-exceeded": "That took too long. Please try again.",
};

export async function callDesk<K extends DeskCallableName>(
  name: K, input: DeskCallableMap[K]["in"],
): Promise<DeskCallableMap[K]["out"]> {
  try {
    const fns = getFunctions(getApp(), DESK_REGION);
    const res = await httpsCallable<DeskCallableMap[K]["in"], DeskCallableMap[K]["out"]>(fns, name)(input);
    return res.data;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = err.code ?? "unknown";
    // Server-side DeskError messages are written for people: prefer them over the generic text.
    const serverMsg = code.startsWith("functions/") && err.message && !/^(internal|INTERNAL)$/.test(err.message) ? err.message : undefined;
    throw new DeskApiError(code, serverMsg ?? FRIENDLY[code] ?? "Something went wrong. Please try again.");
  }
}

export const deskApi = {
  applyAgent: (i: ApplyAgentIn) => callDesk("desk_applyAgent", i),
  resolveEntity: (i: ResolveEntityIn) => callDesk("desk_resolveEntity", i),
  requestAccess: (i: RequestAccessIn) => callDesk("desk_requestAccess", i),
  verifyAccess: (i: VerifyAccessIn) => callDesk("desk_verifyAccess", i),
  requestActionOtp: (i: RequestActionOtpIn) => callDesk("desk_requestActionOtp", i),
  verifyActionOtp: (i: VerifyActionOtpIn) => callDesk("desk_verifyActionOtp", i),
  endSession: (i: EndSessionIn) => callDesk("desk_endSession", i),
  validateImport: (i: ValidateImportIn) => callDesk("desk_validateImport", i),
  quoteService: (i: QuoteServiceIn) => callDesk("desk_quoteService", i),
  reportProperties: (i: ReportPropertiesIn) => callDesk("desk_reportProperties", i),
  saveDraft: (i: SaveDraftIn) => callDesk("desk_saveDraft", i),
  chargeTicket: (i: ChargeTicketIn) => callDesk("desk_chargeTicket", i),
  initiateRentStk: (i: InitiateRentStkIn) => callDesk("desk_initiateRentStk", i),
  getEarnings: (i: GetEarningsIn) => callDesk("desk_getEarnings", i),
  logSupport: (i: LogSupportIn) => callDesk("desk_logSupport", i),
  confirmSupport: (i: ConfirmSupportIn) => callDesk("desk_confirmSupport", i),
  uploadDoc: (i: UploadDocIn) => callDesk("desk_uploadDoc", i),
  listMyDocs: (i: ListMyDocsIn = {}) => callDesk("desk_listMyDocs", i),
  syncPayoutAccounts: (i: SyncPayoutAccountsIn = {}) => callDesk("desk_syncPayoutAccounts", i),
  syncEmail: (i: SyncEmailIn = {}) => callDesk("desk_syncEmail", i),
  listRequests: (i: ListRequestsIn = {}) => callDesk("desk_listRequests", i),
  updateRequest: (i: UpdateRequestIn) => callDesk("desk_updateRequest", i),
  createRequest: (i: CreateRequestIn) => callDesk("desk_createRequest", i),
  net: {
    options: (i: NetOptionsIn) => callDesk("desk_net_options", i),
    invite: (i: NetInviteIn) => callDesk("desk_net_invite", i),
    decide: (i: NetDecideIn) => callDesk("desk_net_decide", i),
    team: (i: NetTeamIn = {}) => callDesk("desk_net_team", i),
    dashboard: () => callDesk("desk_net_dashboard", {}),
  },
  top: {
    requestOtp: (i: TopRequestOtpIn) => callDesk("desk_top_requestOtp", i),
    listDesks: (i: TopListDesksIn = {}) => callDesk("desk_top_listDesks", i),
    getDesk: (i: TopGetDeskIn) => callDesk("desk_top_getDesk", i),
    getDoc: (i: TopGetDocIn) => callDesk("desk_top_getDoc", i),
    setDeskStatus: (i: TopSetDeskStatusIn) => callDesk("desk_top_setDeskStatus", i),
    setRank: (i: TopSetRankIn) => callDesk("desk_top_setRank", i),
    listPayables: (i: TopListPayablesIn = {}) => callDesk("desk_top_listPayables", i),
    payout: (i: TopPayoutIn) => callDesk("desk_top_payout", i),
  },
};
