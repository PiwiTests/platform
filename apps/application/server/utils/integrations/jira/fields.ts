import type { TrackerField, TrackerFieldKind, TrackerFieldOption } from '#shared/integrations/fields';

/** One field of Jira's create metadata (`GET /rest/api/3/issue/createmeta/{project}/issuetypes/{type}`). */
export interface JiraCreateMetaField {
  fieldId?: string;
  key?: string;
  name?: string;
  required?: boolean;
  hasDefaultValue?: boolean;
  schema?: { type?: string; items?: string; system?: string; custom?: string };
  allowedValues?: Array<{ id?: string | number; value?: string; name?: string }>;
}

const TEXTAREA = 'com.atlassian.jira.plugin.system.customfieldtypes:textarea';

/** Rich-text system fields: REST v3 takes them as documents, like the description. */
const RICH_TEXT_SYSTEM_FIELDS = new Set(['description', 'environment']);

/** How a Jira field's value is shaped, from its create-metadata schema. */
export function jiraFieldKind(schema: JiraCreateMetaField['schema']): TrackerFieldKind {
  const type = schema?.type;
  switch (type) {
    case 'string':
      return RICH_TEXT_SYSTEM_FIELDS.has(schema?.system ?? '') || schema?.custom === TEXTAREA ? 'text' : 'string';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'user':
      return 'user';
    case 'option':
    case 'priority':
    case 'resolution':
    case 'version':
    case 'component':
    case 'securitylevel':
      return 'option';
    case 'issuelink':
      return 'issue';
    case 'array':
      if (schema?.items === 'option' || schema?.items === 'component' || schema?.items === 'version') {
        return 'option-array';
      }
      if (schema?.items === 'user') return 'user-array';
      if (schema?.items === 'string') return 'string-array';
      return 'raw';
    default:
      return 'raw';
  }
}

/** The short type name a raw field is shown with: the custom type's last segment, else the schema type. */
function typeName(schema: JiraCreateMetaField['schema']): string {
  const custom = schema?.custom;
  if (custom) return custom.split(':').pop() ?? custom;
  return schema?.system ?? schema?.type ?? 'unknown';
}

function toOptions(values: JiraCreateMetaField['allowedValues']): TrackerFieldOption[] | null {
  if (!Array.isArray(values)) return null;
  const options = values
    .filter((v) => v && v.id != null)
    .map((v) => ({ id: String(v.id), label: v.value ?? v.name ?? String(v.id) }));
  return options.length ? options : null;
}

/**
 * Whether a create cannot usefully set an optional field: the fields Jira types
 * `any` (the board rank, the development summary) are refused or ignored on
 * create, and an issue restriction is not a default a project sets.
 */
function unsettableOnCreate(raw: JiraCreateMetaField): boolean {
  if (raw.required === true) return false;
  return raw.schema?.type === 'any' || raw.schema?.system === 'issuerestriction';
}

/**
 * A create-metadata field as a {@link TrackerField}, or null when it has no id
 * or is an optional field a create cannot usefully set.
 */
export function jiraFieldToTrackerField(raw: JiraCreateMetaField): TrackerField | null {
  const id = raw.fieldId ?? raw.key;
  if (!id || unsettableOnCreate(raw)) return null;
  const options = toOptions(raw.allowedValues);
  let kind = jiraFieldKind(raw.schema);
  // A pick-list Jira lists no values for can only be typed by hand.
  if ((kind === 'option' || kind === 'option-array') && !options) kind = 'raw';
  return {
    id,
    name: raw.name ?? id,
    required: raw.required === true,
    hasDefault: raw.hasDefaultValue === true,
    kind,
    options: kind === 'option' || kind === 'option-array' ? options : null,
    typeName: typeName(raw.schema),
  };
}
