export const CREATE_CATEGORY_FIELD_IDS = {
  icon: 'category-icon',
  name: 'category-name',
  nameError: 'category-name-error',
  kind: 'category-kind',
  iconError: 'category-icon-error',
} as const

// The fields in the order the modal draws them, which are the ones its input can go wrong in
export const CREATE_CATEGORY_FIELDS = ['icon', 'name'] as const

export const CREATE_CATEGORY_ICON_REQUIRED_MESSAGE = 'Choose an icon'
export const CREATE_CATEGORY_NAME_REQUIRED_MESSAGE = 'Name is required'
