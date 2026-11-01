/**
 * Payment Service
 * Handles M-Pesa payment initiation via Cloud Functions
 */

import { logger } from '../utils/logger';
import * as https from 'https';

interface Invoice {
  id: string;
  tenantId: number;
  propertyId: number;
  billingMonth: string;
  rentAmount: number;
  waterCharges?: number;
  powerCharges?: number;
  otherCharges?: number;
  totalAmount: number;
  amountPaid: number;
  arrears: number;
  isPaid: boolean;
  dueDate?: string;
  paidDate?: string;
}

interface PaymentInitiationData {
  invoiceId: number;
  invoice: Invoice;
  tenantName: string;
  amount: number;
  phone: string;
  paymentMethod: 'mpesa' | 'airtel_money';
  assetId: string;
  assetName?: string;
}

interface PaymentResponse {
  success: boolean;
  reference: string;
  message: string;
  data?: {
    reference: string;
    accessCode?: string;
    authorizationUrl?: string;
  };
}

/**
 * Format phone number for M-Pesa payment
 * Accepts: 07XXXXXXXX or 01XXXXXXXX format
 * Returns: Formatted phone ready for cloud function (still keeps 0 prefix)
 */
function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  // Accept 07XXXXXXXX or 01XXXXXXXX (10 digits total)
  if (/^(07|01)\d{8}$/.test(digits)) {
    return digits; // Return as-is, cloud function will format to +254
  }

  return '';
}

/**
 * Rent fee split (mirrors PAY functions/src/desk/rentFees.ts — the processPayment server is authoritative).
 * Tenant pays rent + min(KES 150, 0.5%); the landlord covers the rest of Paystack's ~1.5% plus a 0.2% convenience fee.
 * Integer minor units; the invoice is always credited the rent.
 */
function calculateFees(amount: number, invoiceBalance: number): {
  tenantFee: number;
  total: number;
  netAmount: number;
  deductions: number;
  netPayout: number;
  arrears: number;
} {
  const pct = (minor: number, p: number) => Math.floor((minor * Math.round(p * 100) + 5000) / 10000);
  const rent = Math.round(amount * 100);
  const tenantFee = Math.min(pct(rent, 0.5), 15000);
  const paystackEstimate = Math.min(pct(rent, 1.5), 300000);
  const deductions = Math.max(0, paystackEstimate - tenantFee) + pct(rent, 0.2);
  const arrears = amount < invoiceBalance ? invoiceBalance - amount : 0;

  return {
    tenantFee: tenantFee / 100,
    total: (rent + tenantFee) / 100,
    netAmount: rent / 100,
    deductions: deductions / 100,
    netPayout: (rent - deductions) / 100,
    arrears: Math.round(arrears * 100) / 100,
  };
}

/**
 * Call backend cloud function via HTTP POST (Callable format)
 * Firebase callable functions expect data wrapped in { data: {...} }
 */
export function callCloudFunction(
  functionUrl: string,
  payload: any
): Promise<any> {
  return new Promise((resolve, reject) => {
    // Wrap payload in callable format
    const callablePayload = { data: payload };
    const payloadString = JSON.stringify(callablePayload);

    const options = {
      hostname: new URL(functionUrl).hostname,
      path: new URL(functionUrl).pathname + new URL(functionUrl).search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Callable functions return { result: {...} }
          resolve(parsed.result || parsed);
        } catch (e) {
          resolve({ rawResponse: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(payloadString);
    req.end();
  });
}

/**
 * Initiate M-Pesa payment via backend Cloud Function
 */
export async function initiatePayment(
  data: PaymentInitiationData
): Promise<PaymentResponse> {
  try {
    logger.info('Initiating payment', {
      tenantId: data.invoice.tenantId,
      invoiceId: data.invoice.id,
      amount: data.amount,
      phone: data.phone,
    });

    // Validate and format phone (accept 07/01 format)
    const formattedPhone = formatPhoneNumber(data.phone);
    if (!formattedPhone) {
      throw new Error('Invalid phone number format. Please use 07XXXXXXXX or 01XXXXXXXX');
    }

    // Calculate fees
    const outstanding = data.invoice.totalAmount - data.invoice.amountPaid;
    const fees = calculateFees(data.amount, outstanding);

    logger.info('Payment fees calculated', {
      amount: data.amount,
      tenantFee: fees.tenantFee,
      total: fees.total,
      arrears: fees.arrears,
    });

    // Map payment method to provider code
    const provider = data.paymentMethod === 'mpesa' ? 'mpesa' : 'airtel_money';

    logger.info('Payment request prepared', {
      phone: formattedPhone,
      amount: data.amount,
      provider: provider,
      tenantId: data.invoice.tenantId,
      agentId: data.assetId,
    });

    // Get cloud function URL
    const cloudFunctionUrl = process.env.CLOUD_FUNCTION_URL ||
      'https://africa-south1-plot-9fd6e.cloudfunctions.net/processPayment';

    logger.info('Calling backend cloud function', {
      url: cloudFunctionUrl,
      phone: formattedPhone,
      amount: data.amount,
      provider: provider,
    });

    // Call backend cloud function with same data structure as frontend
    const cloudFunctionResponse = await callCloudFunction(cloudFunctionUrl, {
      email: `tenant${data.invoice.tenantId}@samuhia.co.ke`,
      amount: data.amount,
      currency: 'KES',
      phone: formattedPhone,
      provider: provider,
      metadata: {
        userId: data.invoice.tenantId.toString(),
        userName: data.tenantName,
        invoiceId: data.invoice.id,
        billingMonth: data.invoice.billingMonth,
        propertyId: data.invoice.propertyId,
        arrears: fees.arrears,
        agentId: data.assetId, // user.id from users collection document
        agentName: data.assetName || 'Unknown',
        paymentType: 'rent',
        tenantFee: fees.tenantFee,
        totalAmount: fees.total,
        netPayout: fees.netPayout,
      },
    });

    if (!cloudFunctionResponse || !cloudFunctionResponse.success) {
      const errorMsg = cloudFunctionResponse?.message || 'Cloud function error';
      logger.error('Cloud function error', {
        message: errorMsg,
        response: cloudFunctionResponse,
      });
      throw new Error(`Payment processing failed: ${errorMsg}`);
    }

    logger.info('Cloud function response received', {
      response: cloudFunctionResponse,
    });

    const response: PaymentResponse = {
      success: true,
      reference: cloudFunctionResponse.reference || cloudFunctionResponse.data?.reference || '',
      message: cloudFunctionResponse.message || 'Payment initiated successfully. Please check your phone for M-Pesa prompt.',
      data: {
        reference: cloudFunctionResponse.reference || cloudFunctionResponse.data?.reference || '',
        accessCode: cloudFunctionResponse.accessCode || cloudFunctionResponse.data?.accessCode,
        authorizationUrl: cloudFunctionResponse.authorizationUrl || cloudFunctionResponse.data?.authorizationUrl,
      },
    };

    logger.info('Payment initiated successfully', {
      reference: response.reference,
      tenantId: data.invoice.tenantId,
      amount: data.amount,
    });

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Payment initiation failed', {
      error: errorMessage,
      tenantId: data.invoice.tenantId,
    });

    return {
      success: false,
      reference: '',
      message: `Payment initiation failed: ${errorMessage}`,
    };
  }
}

/**
 * Check if asset has payment info
 */
export function hasPaymentInfo(assetData: any): boolean {
  return !!(assetData?.paymentPhone || assetData?.paymentInfo?.phone);
}

/**
 * Get asset contact info
 */
export function getAssetContactInfo(assetData: any): { phone?: string; name?: string } {
  return {
    phone: assetData?.paymentPhone || assetData?.paymentInfo?.phone || assetData?.phone,
    name: assetData?.name || assetData?.email,
  };
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
  }).format(amount);
}
