import { z } from 'zod';

export const conditionOptions = [
  { value: 'NEW', label: 'Novo' },
  { value: 'SEMI_NEW', label: 'Seminovo' },
  { value: 'DEFECTIVE', label: 'Defeito' },
  { value: 'DAMAGED', label: 'Avariado' },
  { value: 'INCOMPLETE', label: 'Incompleto' },
  { value: 'OTHER', label: 'Outro' },
] as const;

export const destinationOptions = [
  { value: 'STOCK', label: 'Voltar ao estoque' },
  { value: 'SEMI_NEW_STOCK', label: 'Estoque de seminovos' },
  { value: 'TEST', label: 'Testar' },
  { value: 'REPAIR', label: 'Assistência / conserto' },
  { value: 'SUPPLIER', label: 'Devolver ao fornecedor' },
  { value: 'DISCARD', label: 'Descarte' },
  { value: 'OTHER', label: 'Outro destino' },
] as const;

const destinationCodes = new Set<string>(destinationOptions.map((option) => option.value));

const optionalText = z.string().trim().max(500).optional().default('');

export const returnItemSchema = z.object({
  id: z.string().optional(),
  product: z.string().trim().min(1, 'Informe o produto').max(200),
  sku: z.string().trim().max(100).optional().default(''),
  quantity: z.coerce.number().int().min(1, 'A quantidade deve ser maior que zero').max(9999),
  condition: z.string().trim().max(60).optional().default(''),
  conditionNotes: z.string().trim().max(1000).optional().default(''),
  destination: z.string().trim().max(60)
    .refine((value) => !value || destinationCodes.has(value), 'Selecione um destino válido')
    .optional().default(''),
  testResult: z.string().trim().max(1000).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
});

export const createReturnSchema = z.object({
  source: z.enum(['PHOTO', 'MANUAL']),
  store: optionalText,
  receivedLocation: z.string().trim().min(1, 'Informe o local de recebimento').max(150),
  receivedAt: z.string().trim().min(1, 'Informe a data de recebimento'),
  orderId: optionalText,
  trackingCode: optionalText,
  notes: z.string().trim().max(2000).optional().default(''),
  product: optionalText,
  quantity: z.coerce.number().int().min(1).max(9999).optional().default(1),
});

export const updateReturnSchema = z.object({
  store: z.string().trim().min(1, 'Informe a loja').max(150),
  receivedLocation: z.string().trim().min(1, 'Informe o local de recebimento').max(150),
  receivedAt: z.string().trim().min(1, 'Informe a data de recebimento'),
  orderId: optionalText,
  trackingCode: optionalText,
  status: z.string().trim().min(1),
  notes: z.string().trim().max(2000).optional().default(''),
  invoiceNumber: z.string().trim().max(150).optional().default(''),
  invoiceDate: z.string().trim().max(30).optional().default(''),
  items: z.array(returnItemSchema).max(50),
});

export type ReturnItemInput = z.infer<typeof returnItemSchema>;
export type ReturnUpdateInput = z.infer<typeof updateReturnSchema>;

export type StatusDefinition = {
  code: string;
  label: string;
  color: string;
  is_system: number;
  sort_order: number;
  active: number;
  usage_count?: number;
};

export type ConfigOption = {
  code: string;
  type: 'LOCATION' | 'STORE' | 'CONDITION';
  label: string;
  color: string;
  is_system: number;
  sort_order: number;
  active: number;
  requires_invoice: number;
  requires_notes: number;
  usage_count?: number;
};

export type RetentionOverview = {
  automaticEnabled: boolean;
  photoRetentionDays: number;
  returnRetentionDays: number;
  lastCleanupAt: string | null;
  lastCleanupPhotos: number;
  lastCleanupVideos: number;
  lastCleanupReturns: number;
  eligiblePhotos: number;
  eligiblePhotoBytes: number;
  eligibleVideos: number;
  eligibleVideoBytes: number;
  eligibleReturns: number;
};

export type ConfigOptionsResponse = {
  locations: ConfigOption[];
  stores: ConfigOption[];
  conditions: ConfigOption[];
};

export type ReturnSummary = {
  id: string;
  protocol: string;
  store: string | null;
  received_location: string;
  received_at: string;
  order_id: string | null;
  tracking_code: string | null;
  status: string;
  status_label: string;
  status_color: string;
  store_color: string;
  notes: string | null;
  source: 'PHOTO' | 'MANUAL';
  invoice_number: string | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
  item_count: number;
  photo_count: number;
  video_count: number;
  first_photo_id: string | null;
};

export type ReturnDetail = ReturnSummary & {
  invoice_date: string | null;
  created_by: string;
  updated_by: string;
  finalized_by: string | null;
  items: Array<{
    id: string;
    product: string;
    sku: string | null;
    quantity: number;
    condition: string | null;
    condition_notes: string | null;
    destination: string | null;
    test_result: string | null;
    notes: string | null;
  }>;
  photos: Array<{
    id: string;
    file_name: string;
    content_type: string;
    size: number;
    created_at: string;
  }>;
  videos: Array<{
    id: string;
    file_name: string;
    content_type: string;
    size: number;
    duration_ms: number | null;
    created_at: string;
  }>;
  history: Array<{
    id: string;
    actor: string;
    action: string;
    details: string | null;
    created_at: string;
  }>;
  canFinalize: boolean;
  blockingReasons: string[];
};

export type WorkflowStep = 'receipt' | 'package' | 'products' | 'entry';

export type WorkflowIssue = {
  code: string;
  step: WorkflowStep;
  message: string;
  itemIndex?: number;
};

export function getWorkflowIssues(returnData: {
  store?: string | null;
  received_location?: string | null;
  received_at?: string | null;
  order_id?: string | null;
  tracking_code?: string | null;
  invoice_number?: string | null;
  status?: string | null;
  items?: Array<{
    product?: string | null;
    quantity?: number | null;
    condition?: string | null;
    condition_notes?: string | null;
    destination?: string | null;
    test_result?: string | null;
  }>;
}, invoiceExemptConditionCodes: string[] = ['DEFECTIVE'], noteRequiredConditionCodes: string[] = ['DEFECTIVE', 'DAMAGED', 'INCOMPLETE', 'OTHER']) {
  const issues: WorkflowIssue[] = [];
  if (!returnData.received_location?.trim()) issues.push({ code: 'RECEIVED_LOCATION_REQUIRED', step: 'receipt', message: 'Informe o local de recebimento.' });
  if (!returnData.store?.trim()) issues.push({ code: 'STORE_REQUIRED', step: 'receipt', message: 'Informe a loja de origem.' });
  if (!returnData.received_at?.trim()) issues.push({ code: 'RECEIVED_AT_REQUIRED', step: 'receipt', message: 'Informe a data de recebimento.' });
  if (!returnData.order_id?.trim() && !returnData.tracking_code?.trim()) {
    issues.push({ code: 'PACKAGE_IDENTIFIER_REQUIRED', step: 'package', message: 'Informe o ID do pedido ou o código de rastreio.' });
  }
  if (!returnData.items?.length) issues.push({ code: 'PRODUCT_REQUIRED', step: 'products', message: 'Adicione pelo menos um produto.' });
  returnData.items?.forEach((item, index) => {
    const name = item.product?.trim() || `Item ${index + 1}`;
    if (!item.product?.trim()) issues.push({ code: 'PRODUCT_NAME_REQUIRED', step: 'products', message: `Item ${index + 1}: informe o produto.`, itemIndex: index });
    if (!item.quantity || item.quantity < 1) issues.push({ code: 'PRODUCT_QUANTITY_REQUIRED', step: 'products', message: `${name}: informe uma quantidade válida.`, itemIndex: index });
    if (!item.condition?.trim()) issues.push({ code: 'PRODUCT_CONDITION_REQUIRED', step: 'products', message: `${name}: defina a condição.`, itemIndex: index });
    if (!item.destination?.trim()) issues.push({ code: 'PRODUCT_DESTINATION_REQUIRED', step: 'products', message: `${name}: defina o destino.`, itemIndex: index });
    else if (!destinationCodes.has(item.destination)) issues.push({ code: 'PRODUCT_DESTINATION_INVALID', step: 'products', message: `${name}: selecione um destino válido.`, itemIndex: index });
    if (noteRequiredConditionCodes.includes(item.condition || '') && !item.condition_notes?.trim()) {
      issues.push({ code: 'PRODUCT_CONDITION_NOTES_REQUIRED', step: 'products', message: `${name}: descreva as condições encontradas.`, itemIndex: index });
    }
    if (item.destination === 'TEST' && !item.test_result?.trim()) {
      issues.push({ code: 'PRODUCT_TEST_RESULT_REQUIRED', step: 'products', message: `${name}: registre o resultado do teste.`, itemIndex: index });
    }
  });
  const classifiedItems = returnData.items?.filter((item) => item.condition?.trim()) || [];
  const allProductsExemptFromInvoice = classifiedItems.length > 0 && classifiedItems.every((item) => invoiceExemptConditionCodes.includes(item.condition || ''));
  if (!allProductsExemptFromInvoice && !returnData.invoice_number?.trim()) issues.push({ code: 'INVOICE_REQUIRED', step: 'entry', message: 'Informe a nota de entrada.' });
  if (returnData.status === 'WAITING_TEST') issues.push({ code: 'TEST_STATUS_PENDING', step: 'entry', message: 'Conclua o teste antes de finalizar.' });
  return issues;
}

export function getBlockingReasons(
  returnData: Parameters<typeof getWorkflowIssues>[0],
  invoiceExemptConditionCodes: string[] = ['DEFECTIVE'],
  noteRequiredConditionCodes: string[] = ['DEFECTIVE', 'DAMAGED', 'INCOMPLETE', 'OTHER'],
) {
  return [...new Set(getWorkflowIssues(returnData, invoiceExemptConditionCodes, noteRequiredConditionCodes).map((issue) => issue.message))];
}
