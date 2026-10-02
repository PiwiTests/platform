import { isPasswordInput } from './record-capture.js';

/**
 * Fields whose value is never written down: a password field, and a field
 * whose `autocomplete` asks for a password, a one-time code or a card's number
 * or security code. A field stays one once seen as one, whatever it becomes
 * (a "show password" button makes it `type="text"`): each is kept in a set on
 * the isolated world's `globalThis`, which every content script injected into
 * the document shares.
 */

const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc']);

interface SensitiveGlobals {
  __piwiSensitiveFields?: WeakSet<Element>;
}

function seen(): WeakSet<Element> {
  const g = globalThis as SensitiveGlobals;
  g.__piwiSensitiveFields ??= new WeakSet();
  return g.__piwiSensitiveFields;
}

/** Whether an `autocomplete` attribute names a secret among its tokens. */
function secretAutocomplete(value: string | null): boolean {
  return (value ?? '')
    .toLowerCase()
    .split(/\s+/)
    .some((token) => SECRET_AUTOCOMPLETE.has(token));
}

/** Whether `el` holds a secret now, or held one when it was seen before; one that does is remembered. */
export function isSensitiveField(el: Element): boolean {
  const fields = seen();
  if (fields.has(el)) return true;
  const tag = el.localName;
  const secret =
    isPasswordInput(tag, el.getAttribute('type')) ||
    ((tag === 'input' || tag === 'textarea') && secretAutocomplete(el.getAttribute('autocomplete')));
  if (secret) fields.add(el);
  return secret;
}

/** Remembers each field the records show held a secret before its `type` or `autocomplete` changed. */
export function rememberChangedFields(records: MutationRecord[]): void {
  for (const record of records) {
    if (record.type !== 'attributes' || record.target.nodeType !== 1 || record.oldValue == null) continue;
    const held =
      record.attributeName === 'type'
        ? record.oldValue.toLowerCase() === 'password'
        : secretAutocomplete(record.oldValue);
    if (held) seen().add(record.target as Element);
  }
}
