/**
 * Typed client for the Lipa Mdogo Mdogo (LMMX) callables. They live in the PAY functions, region `africa-south1`
 * (LMMX_REGION), not in the desk codebase. With VITE_LMMX_MOCK=true every call is answered from lmmxMock.ts instead.
 * Like client.ts, this is the only place the LMMX UI touches Firebase callables.
 */
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import "../../services/firebaseService"; // side effect: initialises the Firebase app
import { LMMX_REGION } from "./lmmxContract.ts";
import type { LmmxCallableMap, LmmxCallableName } from "./lmmxContract.ts";
import { toLmmxError } from "./lmmxErrors.ts";

export { LmmxApiError, LMMX_ERROR_MESSAGES, errorText, lmmxCodeOf, toLmmxError } from "./lmmxErrors.ts";

export const LMMX_MOCK: boolean = import.meta.env.VITE_LMMX_MOCK === "true";

export async function callLmmx<K extends LmmxCallableName>(name: K, input: LmmxCallableMap[K]["in"]): Promise<LmmxCallableMap[K]["out"]> {
  try {
    if (import.meta.env.VITE_LMMX_MOCK === "true") return await (await import("./lmmxMock.ts")).mockCall(name, input);
    const fns = getFunctions(getApp(), LMMX_REGION);
    const res = await httpsCallable<LmmxCallableMap[K]["in"], LmmxCallableMap[K]["out"]>(fns, name)(input);
    return res.data;
  } catch (e) {
    throw toLmmxError(e);
  }
}

export interface Bank { name: string; code: string }
const MOCK_BANKS: Bank[] = [
  { name: "Equity Bank Kenya", code: "68" }, { name: "KCB Bank Kenya", code: "01" }, { name: "Co-operative Bank of Kenya", code: "11" },
  { name: "Absa Bank Kenya", code: "03" }, { name: "NCBA Bank Kenya", code: "07" }, { name: "Stanbic Bank Kenya", code: "31" },
];
/** The EXISTING `listKenyaBanks` callable, called in africa-south1 (the shared firebaseService client points at us-central1). */
export async function listBanks(): Promise<Bank[]> {
  try {
    if (LMMX_MOCK) return MOCK_BANKS;
    const fns = getFunctions(getApp(), LMMX_REGION);
    const res = await httpsCallable<Record<string, never>, { banks: Bank[] }>(fns, "listKenyaBanks")({});
    return res.data.banks;
  } catch (e) {
    throw toLmmxError(e);
  }
}

/** Short names for the screens. Each is exactly one callable. */
export const lmmx = {
  checkRecipient: (i: LmmxCallableMap["lmmx_desk_checkRecipient"]["in"]) => callLmmx("lmmx_desk_checkRecipient", i),
  createTenant: (i: LmmxCallableMap["lmmx_desk_createTenant"]["in"]) => callLmmx("lmmx_desk_createTenant", i),
  setupStatus: (tenantId: string) => callLmmx("lmmx_desk_setupStatus", { tenantId }),
  confirmSetup: (tenantId: string, otp: string) => callLmmx("lmmx_desk_confirmSetup", { tenantId, otp }),
  resendOtp: (tenantId: string) => callLmmx("lmmx_desk_resendOtp", { tenantId }),
  listTenants: (i: LmmxCallableMap["lmmx_desk_listTenants"]["in"]) => callLmmx("lmmx_desk_listTenants", i),
  getTenant: (tenantId: string) => callLmmx("lmmx_desk_getTenant", { tenantId }),
  requestChange: (i: LmmxCallableMap["lmmx_desk_requestChange"]["in"]) => callLmmx("lmmx_desk_requestChange", i),
  confirmChange: (changeId: string, otp: string) => callLmmx("lmmx_desk_confirmChange", { changeId, otp }),
  cancelChange: (changeId: string) => callLmmx("lmmx_desk_cancelChange", { changeId }),
  earnings: (from: number, to: number) => callLmmx("lmmx_desk_earnings", { from, to }),
  preview: (i: LmmxCallableMap["lmmx_desk_preview"]["in"]) => callLmmx("lmmx_desk_preview", i),
  pipeline: (cursor?: string) => callLmmx("lmmx_desk_pipeline", cursor ? { cursor } : {}),
  top: {
    reviewQueue: () => callLmmx("lmmx_top_reviewQueue", {}),
    reviewDecision: (i: LmmxCallableMap["lmmx_top_reviewDecision"]["in"]) => callLmmx("lmmx_top_reviewDecision", i),
    freeze: (i: LmmxCallableMap["lmmx_top_freeze"]["in"]) => callLmmx("lmmx_top_freeze", i),
    unfreeze: (i: LmmxCallableMap["lmmx_top_unfreeze"]["in"]) => callLmmx("lmmx_top_unfreeze", i),
    reassign: (i: LmmxCallableMap["lmmx_top_reassign"]["in"]) => callLmmx("lmmx_top_reassign", i),
    reveal: (i: LmmxCallableMap["lmmx_top_reveal"]["in"]) => callLmmx("lmmx_top_reveal", i),
    updateTenant: (i: LmmxCallableMap["lmmx_top_updateTenant"]["in"]) => callLmmx("lmmx_top_updateTenant", i),
    auditList: (i: LmmxCallableMap["lmmx_top_auditList"]["in"]) => callLmmx("lmmx_top_auditList", i),
    auditVerify: (i: LmmxCallableMap["lmmx_top_auditVerify"]["in"] = {}) => callLmmx("lmmx_top_auditVerify", i),
    leadsList: (i: LmmxCallableMap["lmmx_top_leadsList"]["in"]) => callLmmx("lmmx_top_leadsList", i),
    leadGet: (leadId: string) => callLmmx("lmmx_top_leadGet", { leadId }),
    leadUpdate: (i: LmmxCallableMap["lmmx_top_leadUpdate"]["in"]) => callLmmx("lmmx_top_leadUpdate", i),
    stats: () => callLmmx("lmmx_top_stats", {}),
  },
};
