/**
 * HostPinnacle transactional SMS — the same provider and endpoint Chama, Register and PAY already use.
 * Credentials are the project's EXISTING secrets HP_SMS_USERID / HP_SMS_PASSWORD / HP_SMS_APIKEY / HP_SMS_SENDERID (the set PMS uses;
 * CYBER, PAY and PMS share one project, so nothing new is created). Bind `HP_SECRETS` on any function that sends.
 * HostPinnacle's SMSApi/send expects FORM-ENCODED fields (a JSON body is not parsed), as Chama's client documents.
 */
import axios from "axios";
import { DeskError } from "../errors.js";
import { normalizeKenyaPhone } from "../paystack/phone.js";
import { BUNDLE_SECRETS, bundleSecret } from "./secretsBundle.js";

export const HP_USERID = bundleSecret("HP_SMS_USERID");
export const HP_PASSWORD = bundleSecret("HP_SMS_PASSWORD");
export const HP_APIKEY = bundleSecret("HP_SMS_APIKEY");
export const HP_SENDER_ID = bundleSecret("HP_SMS_SENDERID");
export const HP_SECRETS = BUNDLE_SECRETS;

export const SMS_API_URL = "https://smsportal.hostpinnacle.co.ke/SMSApi/send";
export const SMS_MAX_LENGTH = 385;

/** Strip emoji / non-GSM characters, collapse whitespace, cap at the provider's limit. */
export function cleanSmsText(text: string): string {
  const stripped = (text ?? "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > SMS_MAX_LENGTH ? stripped.slice(0, SMS_MAX_LENGTH - 3) + "..." : stripped;
}

export interface SmsCredentials { userid: string; password: string; apikey: string; senderid: string }

export function buildSmsForm(c: SmsCredentials, phoneE164: string, message: string): URLSearchParams {
  const msg = cleanSmsText(message);
  if (!msg) throw new DeskError("invalid_argument", "SMS text is empty");
  return new URLSearchParams({
    userid: c.userid, password: c.password, apikey: c.apikey, senderid: c.senderid,
    mobile: phoneE164.replace(/^\+/, ""), msg, sendMethod: "quick", msgType: "text", output: "json", duplicatecheck: "true",
  });
}

/** True when a parsed provider response reports an explicit failure. Unknown shapes are treated as accepted (HTTP 2xx). */
export function smsResponseFailed(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const s = String((body as { status?: unknown }).status ?? "").toLowerCase();
  return s === "error" || s === "fail" || s === "failed" || s === "failure";
}

export async function sendSms(phone: string, message: string): Promise<void> {
  const form = buildSmsForm(
    { userid: HP_USERID.value(), password: HP_PASSWORD.value(), apikey: HP_APIKEY.value(), senderid: HP_SENDER_ID.value() },
    normalizeKenyaPhone(phone), message);
  let data: unknown;
  try {
    const res = await axios.post(SMS_API_URL, form.toString(), {
      timeout: 20_000, headers: { "Content-Type": "application/x-www-form-urlencoded" }, validateStatus: (s) => s >= 200 && s < 300,
    });
    data = res.data;
  } catch {
    throw new DeskError("internal", "Could not send the SMS. Please try again.");
  }
  if (smsResponseFailed(data)) throw new DeskError("internal", "The SMS provider rejected the message.");
}
