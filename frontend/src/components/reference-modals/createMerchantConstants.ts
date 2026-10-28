export const NO_DEFAULT_CATEGORY_VALUE = '__none__'

export const CREATE_MERCHANT_FIELD_IDS = {
  name: 'merchant-name',
  nameError: 'merchant-name-error',
  defaultCategory: 'merchant-default-category',
} as const

// The fields in the order the modal draws them, which are the ones its input can go wrong in
export const CREATE_MERCHANT_FIELDS = ['name'] as const

export const CREATE_MERCHANT_NAME_REQUIRED_MESSAGE = 'Name is required'
