export interface Category {
  id: string;
  group_id: string | null;
  owner_id: string | null;
  name: string;
  kind: 'expense' | 'income' | 'transfer';
  icon: string | null;
  is_system: boolean;
  created_at: string;
}

export interface UpdateCategoryPayload {
  name?: string;
  icon?: string | null;
}

export interface CreateCategoryPayload {
  name: string;
  kind: Category['kind'];
  icon?: string | null;
  group_id?: string | null;
}

export interface MergeCategoryPayload {
  replacement_category_id: string;
}

export interface UpdateCategoryRequest {
  categoryId: string;
  payload: UpdateCategoryPayload;
}

export interface MergeCategoryRequest {
  categoryId: string;
  payload: MergeCategoryPayload;
}
