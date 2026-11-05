import axios, { type AxiosInstance } from "axios";
import { DeskError } from "../errors.js";
import { bundleSecret } from "../kernel/secretsBundle.js";

/** Same project secret CYBER and PAY already use. Bind it with `secrets: [PAYSTACK_SECRET_KEY]` on each function. */
export const PAYSTACK_SECRET_KEY = bundleSecret("PAYSTACK_SECRET_KEY");
/** MyChama's own Paystack account (the new key). Already in this project; only the payout-account sync binds it. */
export const MYCHAMA_PAYSTACK_SECRET_KEY = bundleSecret("MYCHAMA_PAYSTACK_SECRET_KEY");

function http(): AxiosInstance {
  return axios.create({
    baseURL: "https://api.paystack.co",
    timeout: 30_000,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}`, "Content-Type": "application/json" },
  });
}
export function paystackMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e.response?.data?.message ?? e.message ?? "Paystack request failed";
}

export interface MpesaChargeInput {
  amountMinor: number; phoneE164: string; reference: string; email: string; splitCode: string;
  metadata: Record<string, unknown>;
}
export interface MpesaChargeResult { reference: string; status: string; displayText?: string; accountReference?: string }

/** STK push via Paystack /charge (same payload shape PAY's chargeCustomer uses). */
export async function chargeMpesa(i: MpesaChargeInput): Promise<MpesaChargeResult> {
  try {
    const res = await http().post("/charge", {
      email: i.email, amount: i.amountMinor, currency: "KES", reference: i.reference,
      mobile_money: { phone: i.phoneE164, provider: "mpesa" }, split_code: i.splitCode, metadata: i.metadata,
    });
    if (!res.data?.status) throw new DeskError("payment_failed", res.data?.message ?? "Paystack declined the charge");
    const d = res.data.data ?? {};
    return { reference: d.reference ?? i.reference, status: d.status ?? "pending", displayText: d.display_text, accountReference: d.account_reference };
  } catch (err) {
    if (err instanceof DeskError) throw err;
    throw new DeskError("payment_failed", paystackMessage(err));
  }
}

export interface VerifiedTransaction { status: string; amountMinor: number; feesMinor: number; reference: string; raw: Record<string, unknown> }
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  try {
    const res = await http().get(`/transaction/verify/${encodeURIComponent(reference)}`);
    const d = (res.data?.data ?? {}) as Record<string, unknown>;
    return { status: String(d.status ?? "unknown"), amountMinor: Number(d.amount ?? 0), feesMinor: Number(d.fees ?? 0), reference, raw: d };
  } catch (err) {
    throw new DeskError("payment_failed", paystackMessage(err));
  }
}

export interface VerifiedTransfer { status: string; amountMinor: number; reference: string; transferCode?: string }
/** Used by the bonus confirmation: the admin dash pays via Transfers; we verify before marking paid. */
export async function verifyTransfer(reference: string): Promise<VerifiedTransfer> {
  try {
    const res = await http().get(`/transfer/verify/${encodeURIComponent(reference)}`);
    const d = (res.data?.data ?? {}) as { status?: string; amount?: number; transfer_code?: string };
    return { status: String(d.status ?? "unknown"), amountMinor: Number(d.amount ?? 0), reference, transferCode: d.transfer_code };
  } catch (err) {
    throw new DeskError("payment_failed", paystackMessage(err));
  }
}
