export interface Merchant {
  id: string;
  owner_id: string;
  group_id: string | null;
  name: string;
  default_category_id: string | null;
  created_at: string;
}

export interface CreateMerchantPayload {
  name: string;
  default_category_id?: string | null;
  group_id?: string | null;
}

export interface UpdateMerchantPayload {
  name?: string;
  default_category_id?: string | null;
}

export interface MergeMerchantPayload {
  replacement_merchant_id: string;
}

export interface MerchantFilters {
  group_id?: string;
  q?: string;
}

export interface UpdateMerchantRequest {
  merchantId: string;
  payload: UpdateMerchantPayload;
}

export interface MergeMerchantRequest {
  merchantId: string;
  payload: MergeMerchantPayload;
}
