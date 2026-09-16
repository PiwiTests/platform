export const HTML_REPORT_BOOTSTRAP = `
(() => {
  function createStorage() {
    const values = Object.create(null);

    function has(key) {
      return Object.prototype.hasOwnProperty.call(values, key);
    }

    const target = {
      clear() {
        for (const key of Object.keys(values)) delete values[key];
      },
      getItem(key) {
        key = String(key);
        return has(key) ? values[key] : null;
      },
      key(index) {
        return Object.keys(values)[index] ?? null;
      },
      removeItem(key) {
        delete values[String(key)];
      },
      setItem(key, value) {
        values[String(key)] = String(value);
      },
    };

    Object.defineProperty(target, 'length', {
      configurable: false,
      enumerable: false,
      get: () => Object.keys(values).length,
    });

    return new Proxy(target, {
      deleteProperty(object, key) {
        if (typeof key === 'string' && !(key in object)) {
          delete values[key];
          return true;
        }
        return Reflect.deleteProperty(object, key);
      },
      get(object, key, receiver) {
        if (typeof key === 'string' && !(key in object)) return has(key) ? values[key] : null;
        return Reflect.get(object, key, receiver);
      },
      getOwnPropertyDescriptor(object, key) {
        if (typeof key === 'string' && has(key) && !(key in object)) {
          return { configurable: true, enumerable: true, value: values[key], writable: true };
        }
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
      ownKeys(object) {
        return [...new Set([...Reflect.ownKeys(object), ...Object.keys(values)])];
      },
      set(object, key, value, receiver) {
        if (typeof key === 'string' && !(key in object)) {
          values[key] = String(value);
          return true;
        }
        return Reflect.set(object, key, value, receiver);
      },
    });
  }

  function installStorage(name) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        value: createStorage(),
      });
    } catch {
      // The browser keeps its native storage property when it cannot be replaced.
    }
  }

  installStorage('localStorage');
  installStorage('sessionStorage');

  const addEventListener = window.addEventListener.bind(window);
  const removeEventListener = window.removeEventListener.bind(window);
  const wrappedListeners = new WeakMap();

  function isFocusEvent(type) {
    return type === 'focus' || type === 'blur';
  }

  window.addEventListener = function (type, listener, options) {
    if (!isFocusEvent(type) || typeof listener !== 'function') {
      return addEventListener(type, listener, options);
    }

    let wrapped = wrappedListeners.get(listener);
    if (!wrapped) {
      wrapped = function (event) {
        try {
          return listener.call(this, event);
        } catch (error) {
          if (error && typeof error === 'object' && error.name === 'SecurityError') return;
          throw error;
        }
      };
      wrappedListeners.set(listener, wrapped);
    }
    return addEventListener(type, wrapped, options);
  };

  window.removeEventListener = function (type, listener, options) {
    const wrapped = typeof listener === 'function' ? wrappedListeners.get(listener) : undefined;
    return removeEventListener(type, wrapped ?? listener, options);
  };
})();
`;

const HTML_REPORT_BOOTSTRAP_TAG = `<script>${HTML_REPORT_BOOTSTRAP}</script>`;

/**
 * Add opaque-origin compatibility before the report's own scripts execute.
 * The storage facade is scoped to this document and is never persisted.
 */
export function prepareHtmlReport(content: Buffer): Buffer {
  const source = content.toString('utf8');
  const headEnd = /<\/head\s*>/i.exec(source);
  if (headEnd && headEnd.index !== undefined) {
    const headStart = /<head(?:\s[^>]*)?>/i.exec(source);
    const headContentStart = headStart ? headStart.index + headStart[0].length : 0;
    const headContent = source.slice(headContentStart, headEnd.index);
    const firstHeadScript = /<script(?:\s|>)/i.exec(headContent);
    const insertionPoint = firstHeadScript ? headContentStart + firstHeadScript.index : headEnd.index;
    return Buffer.from(`${source.slice(0, insertionPoint)}${HTML_REPORT_BOOTSTRAP_TAG}${source.slice(insertionPoint)}`);
  }

  const firstScript = /<script(?:\s|>)/i.exec(source);
  if (firstScript && firstScript.index !== undefined) {
    return Buffer.from(
      `${source.slice(0, firstScript.index)}${HTML_REPORT_BOOTSTRAP_TAG}${source.slice(firstScript.index)}`,
    );
  }

  return Buffer.from(`${HTML_REPORT_BOOTSTRAP_TAG}${source}`);
}
