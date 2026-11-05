import { BUNDLE_SECRETS, bundleSecret } from "./secretsBundle";
/**
 * HostPinnacle SMS credentials. These are the project's EXISTING secrets (the same set PMS, PAY and Desk bind):
 * CYBER, PAY and PMS share one project, so nothing new is created. Bind `HP_SECRETS` on any function that sends.
 */

export const HP_SMS_USERID = bundleSecret('HP_SMS_USERID');
export const HP_SMS_PASSWORD = bundleSecret('HP_SMS_PASSWORD');
export const HP_SMS_APIKEY = bundleSecret('HP_SMS_APIKEY');
export const HP_SMS_SENDERID = bundleSecret('HP_SMS_SENDERID');

export const HP_SECRETS = BUNDLE_SECRETS;

export const SMS_API_URL = 'https://smsportal.hostpinnacle.co.ke/SMSApi/send';
