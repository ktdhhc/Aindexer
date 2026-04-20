import { fetchJson } from "./http";

const DEFAULT_TEMPLATE_ID = "tpl_default";

export interface FieldDefinition {
  field_key: string;
  label: string;
  description: string;
  field_type: string;
  required: boolean | number;
  enabled: boolean | number;
  sort_order: number;
  is_default: boolean | number;
}

export interface FieldTemplate {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  field_count: number;
}

function buildTemplateQuery(templateId?: string): string {
  const value = String(templateId || DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID;
  return `template_id=${encodeURIComponent(value)}`;
}

export function listFields(templateId?: string): Promise<FieldDefinition[]> {
  return fetchJson<FieldDefinition[]>(`/api/fields?${buildTemplateQuery(templateId)}`);
}

export function updateFields(payload: FieldDefinition[], templateId?: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/api/fields?${buildTemplateQuery(templateId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function resetFields(templateId?: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/api/fields/reset?${buildTemplateQuery(templateId)}`, {
    method: "POST",
  });
}

export function listFieldTemplates(): Promise<FieldTemplate[]> {
  return fetchJson<FieldTemplate[]>("/api/fields/templates");
}

export function createFieldTemplate(payload: {
  name: string;
  description?: string;
  source_template_id?: string;
}): Promise<FieldTemplate> {
  return fetchJson<FieldTemplate>("/api/fields/templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateFieldTemplate(
  templateId: string,
  payload: { name: string; description?: string },
): Promise<FieldTemplate> {
  return fetchJson<FieldTemplate>(`/api/fields/templates/${encodeURIComponent(templateId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteFieldTemplate(templateId: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/api/fields/templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}
