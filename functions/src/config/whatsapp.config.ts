import { bundleSecret } from "./secretsBundle";
/**
 * WhatsApp Configuration
 * Stores WhatsApp API credentials and settings
 */


export const WHATSAPP_PHONE_NUMBER_ID = bundleSecret('WHATSAPP_PHONE_NUMBER_ID');
export const WHATSAPP_ACCESS_TOKEN = bundleSecret('WHATSAPP_ACCESS_TOKEN');
export const WHATSAPP_VERIFY_TOKEN = bundleSecret('WHATSAPP_VERIFY_TOKEN');

export const WHATSAPP_CONFIG = {
  API_VERSION: 'v24.0',
  BASE_URL: 'https://graph.facebook.com',
};

export const getWhatsAppApiUrl = () => {
  return `${WHATSAPP_CONFIG.BASE_URL}/${WHATSAPP_CONFIG.API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID.value()}/messages`;
};

export const getWhatsAppHeaders = () => {
  return {
    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN.value()}`,
    'Content-Type': 'application/json',
  };
};
