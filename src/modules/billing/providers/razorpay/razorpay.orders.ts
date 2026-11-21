import { executeGatewayCall, getRazorpayClient } from './razorpay.client';

export interface CreateOrderParams {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayPaymentResult {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string | null;
  invoice_id: string | null;
  international: boolean;
  method: string;
  amount_refunded: number;
  refund_status: string | null;
  captured: boolean;
  description?: string | null;
  card_id?: string | null;
  bank?: string | null;
  wallet?: string | null;
  vpa?: string | null;
  email?: string;
  contact?: string;
  notes: Record<string, string>;
  fee?: number;
  tax?: number;
  error_code?: string | null;
  error_description?: string | null;
  created_at: number;
}

export async function createRazorpayOrder(params: CreateOrderParams): Promise<RazorpayOrderResult> {
  return executeGatewayCall(
    async () => {
      const razorpay = getRazorpayClient();
      const order = await razorpay.orders.create({
        amount: params.amountMinor,
        currency: params.currency,
        receipt: params.receipt,
        notes: params.notes ?? {},
      });
      return order as unknown as RazorpayOrderResult;
    },
    { operationName: 'Create Razorpay order' },
  );
}

export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayOrderResult> {
  return executeGatewayCall(
    async () => {
      const razorpay = getRazorpayClient();
      const order = await razorpay.orders.fetch(orderId);
      return order as unknown as RazorpayOrderResult;
    },
    { isGet: true, operationName: 'Fetch Razorpay order' },
  );
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPaymentResult> {
  return executeGatewayCall(
    async () => {
      const razorpay = getRazorpayClient();
      const payment = await razorpay.payments.fetch(paymentId);
      return payment as unknown as RazorpayPaymentResult;
    },
    { isGet: true, operationName: 'Fetch Razorpay payment' },
  );
}
