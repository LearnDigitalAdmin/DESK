import { bundleSecret } from "./secretsBundle";
/**
 * Paystack Configuration
 * Stores Paystack API credentials and settings
 */


export const PAYSTACK_SECRET_KEY = bundleSecret('PAYSTACK_SECRET_KEY');

// MyChama's OWN Paystack account. Used ONLY by the MyChama payment flow
// (services/mychama.payment.service.ts). Every other flow (CYBER_, SHOP_,
// REPORT_, SUB_, INV_) keeps PAYSTACK_SECRET_KEY above.
export const MYCHAMA_PAYSTACK_SECRET_KEY = bundleSecret('MYCHAMA_PAYSTACK_SECRET_KEY');

export const PAYSTACK_CONFIG = {
  BASE_URL: 'https://api.paystack.co',
};

export const getPaystackHeaders = () => {
  return {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}`,
    'Content-Type': 'application/json',
  };
};

// Currency configuration
export const CURRENCY = {
  CODE: 'KES',
  SYMBOL: 'Ksh',
  KOBO_MULTIPLIER: 100, // 1 KES = 100 kobo for Paystack
};
