export type {
  CreateMerchantPayload,
  Merchant,
  MerchantFilters,
  MergeMerchantPayload,
  MergeMerchantRequest,
  UpdateMerchantPayload,
  UpdateMerchantRequest,
} from '@/api/merchants/types';

export {
  createMerchant,
  deleteMerchant,
  fetchMerchant,
  fetchMerchantsPage,
  mergeMerchant,
  updateMerchant,
} from '@/api/merchants/requests';

export {
  useCreateMerchant,
  useDeleteMerchant,
  useInfiniteMerchants,
  useMerchant,
  useMerchantDetails,
  useMergeMerchant,
  useRefreshMerchants,
  useUpdateMerchant,
} from '@/api/merchants/hooks';
