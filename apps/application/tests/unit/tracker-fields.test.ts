import { describe, test, expect } from 'vitest';
import {
  MAX_FIELD_VALUES,
  coerceFieldValue,
  fieldPayload,
  fieldValueHint,
  joinFieldNames,
  missingFieldsMessage,
  missingRequiredFields,
  normalizeFieldValues,
  parseRawFieldValue,
  requiredFieldsToFill,
  settableFields,
  textToDocument,
  type TrackerField,
} from '#shared/integrations/fields';
import { jiraFieldKind, jiraFieldToTrackerField } from '../../server/utils/integrations/jira/fields';

function field(overrides: Partial<TrackerField> & { id: string }): TrackerField {
  return {
    name: overrides.id,
    required: false,
    hasDefault: false,
    kind: 'string',
    options: null,
    typeName: 'string',
    ...overrides,
  };
}

const SCREEN: TrackerField[] = [
  field({ id: 'project', required: true }),
  field({ id: 'issuetype', required: true }),
  field({ id: 'summary', required: true }),
  field({ id: 'reporter', required: true, hasDefault: true }),
  field({ id: 'priority', required: true, hasDefault: true, kind: 'option' }),
  field({ id: 'customfield_10042', name: 'Team', required: true, kind: 'raw' }),
  field({ id: 'customfield_10050', name: 'Severity', required: true, kind: 'option' }),
  field({ id: 'components', name: 'Components', kind: 'option-array' }),
];

describe('Jira create metadata → tracker fields', () => {
  test.each([
    [{ type: 'string', system: 'summary' }, 'string'],
    [{ type: 'string', system: 'description' }, 'text'],
    [{ type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' }, 'text'],
    [{ type: 'number' }, 'number'],
    [{ type: 'date', system: 'duedate' }, 'date'],
    [{ type: 'datetime' }, 'datetime'],
    [{ type: 'user', system: 'assignee' }, 'user'],
    [{ type: 'priority', system: 'priority' }, 'option'],
    [{ type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' }, 'option'],
    [{ type: 'array', items: 'option' }, 'option-array'],
    [{ type: 'array', items: 'component', system: 'components' }, 'option-array'],
    [{ type: 'array', items: 'version', system: 'fixVersions' }, 'option-array'],
    [{ type: 'array', items: 'user' }, 'user-array'],
    [{ type: 'array', items: 'string', system: 'labels' }, 'string-array'],
    [{ type: 'issuelink', system: 'parent' }, 'issue'],
    [{ type: 'team', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team' }, 'raw'],
    [{ type: 'option-with-child' }, 'raw'],
  ] as const)('%j is a %s field', (schema, kind) => {
    expect(jiraFieldKind(schema)).toBe(kind);
  });

  test('a field keeps its name, flags and listed values', () => {
    expect(
      jiraFieldToTrackerField({
        fieldId: 'customfield_10050',
        name: 'Severity',
        required: true,
        hasDefaultValue: false,
        schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' },
        allowedValues: [
          { id: '10100', value: 'Critical' },
          { id: 10101, value: 'Major' },
        ],
      }),
    ).toEqual({
      id: 'customfield_10050',
      name: 'Severity',
      required: true,
      hasDefault: false,
      kind: 'option',
      options: [
        { id: '10100', label: 'Critical' },
        { id: '10101', label: 'Major' },
      ],
      typeName: 'select',
    });
  });

  test('an optional field a create cannot set is skipped, unless Jira requires it', () => {
    const rank = {
      fieldId: 'customfield_10019',
      name: 'Rank',
      schema: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-lexo-rank' },
    };
    expect(jiraFieldToTrackerField(rank)).toBeNull();
    expect(jiraFieldToTrackerField({ ...rank, required: true })?.kind).toBe('raw');
    expect(
      jiraFieldToTrackerField({
        fieldId: 'issuerestriction',
        schema: { type: 'issuerestriction', system: 'issuerestriction' },
      }),
    ).toBeNull();
    // A parent is an issue key, and a Subtask requires one.
    expect(
      jiraFieldToTrackerField({
        fieldId: 'parent',
        name: 'Parent',
        required: true,
        schema: { type: 'issuelink', system: 'parent' },
      }),
    ).toMatchObject({ kind: 'issue', required: true });
  });

  test('a pick-list without listed values is typed by hand, and a field without an id is skipped', () => {
    expect(jiraFieldToTrackerField({ fieldId: 'x', schema: { type: 'option' } })?.kind).toBe('raw');
    expect(jiraFieldToTrackerField({ name: 'No id' })).toBeNull();
    expect(
      jiraFieldToTrackerField({
        fieldId: 'fixVersions',
        schema: { type: 'array', items: 'version' },
        allowedValues: [{ id: '1', name: '1.2' }],
      })?.options,
    ).toEqual([{ id: '1', label: '1.2' }]);
  });
});

describe('which fields to ask for', () => {
  test('the required fields to fill leave out what Jira defaults and what Piwi fills', () => {
    expect(requiredFieldsToFill(SCREEN).map((f) => f.id)).toEqual(['customfield_10042', 'customfield_10050']);
    expect(settableFields(SCREEN).map((f) => f.id)).not.toContain('summary');
  });

  test('a value fills a required field; an empty one does not', () => {
    const missing = missingRequiredFields(SCREEN, {
      customfield_10042: { value: 'team-uuid', label: 'team-uuid' },
      customfield_10050: { value: {}, label: '' },
    });
    expect(missing.map((f) => f.name)).toEqual(['Severity']);
  });

  test('a required assignee counts unless one is set; required components count unless a route sets one', () => {
    const screen = [
      field({ id: 'assignee', name: 'Assignee', required: true, kind: 'user' }),
      field({ id: 'components', name: 'Components', required: true, kind: 'option-array' }),
    ];
    expect(missingRequiredFields(screen, {}).map((f) => f.id)).toEqual(['assignee', 'components']);
    expect(missingRequiredFields(screen, {}, { assignee: true, components: true })).toEqual([]);
  });
});

describe('what is sent', () => {
  test('only set values for fields on the screen, never a Piwi-managed one', () => {
    expect(
      fieldPayload(
        {
          customfield_10050: { value: { id: '10100' }, label: 'Critical' },
          customfield_99999: { value: 'elsewhere', label: 'elsewhere' },
          components: { value: [], label: '' },
        },
        SCREEN,
      ),
    ).toEqual({ customfield_10050: { id: '10100' } });
  });

  test('without the screen, every set value is sent', () => {
    expect(fieldPayload({ customfield_99999: { value: 7, label: '7' } }, null)).toEqual({ customfield_99999: 7 });
  });
});

describe('normalizeFieldValues', () => {
  test('keeps valid entries and labels them', () => {
    expect(
      normalizeFieldValues({
        customfield_10050: { value: { id: '10100' }, label: 'Critical' },
        customfield_10060: { value: 42 },
      }),
    ).toEqual({
      customfield_10050: { value: { id: '10100' }, label: 'Critical' },
      customfield_10060: { value: 42, label: '42' },
    });
  });

  test('drops bad ids, Piwi-managed fields, empty values and oversized ones', () => {
    expect(
      normalizeFieldValues({
        'bad id': { value: 1 },
        summary: { value: 'x' },
        customfield_1: { value: '' },
        customfield_2: { value: 'x'.repeat(5000) },
        customfield_3: 'not an entry',
      }),
    ).toEqual({});
    expect(normalizeFieldValues(null)).toEqual({});
    expect(normalizeFieldValues(['a'])).toEqual({});
  });

  test('caps the number of values', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_FIELD_VALUES + 10 }, (_, i) => [`customfield_${i}`, { value: i + 1 }]),
    );
    expect(Object.keys(normalizeFieldValues(many))).toHaveLength(MAX_FIELD_VALUES);
  });
});

describe('wording and values', () => {
  test('field names are joined the way a person says them', () => {
    expect(joinFieldNames(['Team'])).toBe('Team');
    expect(joinFieldNames(['Team', 'Severity'])).toBe('Team and Severity');
    expect(joinFieldNames(['Team', 'Severity', 'Squad'])).toBe('Team, Severity and Squad');
    expect(missingFieldsMessage([{ name: 'Team' }])).toMatch(/^Jira requires Team for this issue type\. Fill it in/);
  });

  test('plain text becomes a document, a raw value is JSON when it parses', () => {
    expect(textToDocument('one\n\ntwo')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    });
    expect(parseRawFieldValue('42')).toBe(42);
    expect(parseRawFieldValue('{"id":"1"}')).toEqual({ id: '1' });
    expect(parseRawFieldValue('team-uuid')).toBe('team-uuid');
    expect(parseRawFieldValue('  ')).toBeNull();
  });
});

describe('values given without the form', () => {
  const severity = field({
    id: 'customfield_10050',
    kind: 'option',
    options: [
      { id: '10100', label: 'Critical' },
      { id: '10101', label: 'Major' },
    ],
  });

  test('a listed value is found by its name or id, in any case', () => {
    expect(coerceFieldValue(severity, 'major')).toEqual({ id: '10101' });
    expect(coerceFieldValue(severity, '10100')).toEqual({ id: '10100' });
    expect(coerceFieldValue(severity, { id: '10100' })).toEqual({ id: '10100' });
    expect(coerceFieldValue({ ...severity, kind: 'option-array' }, ['Critical', 'Major'])).toEqual([
      { id: '10100' },
      { id: '10101' },
    ]);
    // Not listed: left for Jira to refuse, naming the field.
    expect(coerceFieldValue(severity, 'Blocker')).toBe('Blocker');
  });

  test('people, text, numbers, issues and tags take their API shape', () => {
    expect(coerceFieldValue(field({ id: 'a', kind: 'user' }), ' 5b10a ')).toEqual({ accountId: '5b10a' });
    expect(coerceFieldValue(field({ id: 'a', kind: 'user-array' }), 'x')).toEqual([{ accountId: 'x' }]);
    expect(coerceFieldValue(field({ id: 'a', kind: 'text' }), 'hi')).toEqual(textToDocument('hi'));
    expect(coerceFieldValue(field({ id: 'a', kind: 'number' }), '3')).toBe(3);
    expect(coerceFieldValue(field({ id: 'a', kind: 'number' }), 'three')).toBe('three');
    expect(coerceFieldValue(field({ id: 'a', kind: 'issue' }), 'proj-12')).toEqual({ key: 'PROJ-12' });
    expect(coerceFieldValue(field({ id: 'a', kind: 'string-array' }), 'one')).toEqual(['one']);
    expect(coerceFieldValue(field({ id: 'a', kind: 'raw' }), 'team-uuid')).toBe('team-uuid');
  });

  test('a hint says what a field takes', () => {
    expect(fieldValueHint(severity)).toBe('one of Critical, Major');
    expect(fieldValueHint({ kind: 'option-array', options: [], typeName: 'multiselect' })).toBe('listed values');
    expect(fieldValueHint({ kind: 'raw', options: null, typeName: 'atlassian-team' })).toBe(
      "Jira's API value (type atlassian-team)",
    );
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i), label: `v${i}` }));
    expect(fieldValueHint({ kind: 'option', options: many, typeName: 'select' })).toMatch(/v9, …$/);
  });
});
