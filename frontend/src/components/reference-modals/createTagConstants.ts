export const CREATE_TAG_FIELD_IDS = {
  name: 'create-tag-name',
  nameError: 'create-tag-name-error',
} as const

// The fields in the order the modal draws them, which are the ones its input can go wrong in
export const CREATE_TAG_FIELDS = ['name'] as const

// Shown on the name field, worded as the category and merchant modals word theirs
export const CREATE_TAG_NAME_REQUIRED_MESSAGE = 'Name is required'
