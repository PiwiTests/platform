import { describe, expect, test } from 'vitest';
import { importedNames, missingImports } from '../src/recorder/imports';

const file = (...lines: string[]) => lines.join('\n');
const names = (text: string) => [...importedNames(text)].sort();

describe('importedNames', () => {
  test('defaults, namespaces, named imports under their local names, and import type', () => {
    const text = file(
      "import Default from 'a';",
      "import Other, { one, two as second } from 'b';",
      "import Third, * as ns from 'c';",
      "import * as all from 'd';",
      "import type { Page, Locator as L } from '@playwright/test';",
      "import { type Shape, default as fallback, 'odd-name' as odd } from 'e';",
      "import type Config from 'f';",
      "import type * as types from 'g';",
      "import legacy = require('h');",
    );
    expect(names(text)).toEqual(
      [
        'Default',
        'Other',
        'one',
        'second',
        'Third',
        'ns',
        'all',
        'Page',
        'L',
        'Shape',
        'fallback',
        'odd',
        'Config',
        'types',
        'legacy',
      ].sort(),
    );
  });

  test('a statement across lines, with comments and trailing commas', () => {
    const text = file(
      'import {',
      '  CartPage, // the cart',
      '  /* the checkout */ CheckoutPage as Checkout,',
      "} from './pages';",
      "import type from 'type-module';",
    );
    expect(names(text)).toEqual(['CartPage', 'Checkout', 'type']);
  });

  test('side-effect imports, dynamic imports, import.meta, require and code inside blocks or strings bind nothing', () => {
    const text = file(
      "import './setup';",
      "const lazy = await import('./lazy');",
      'const here = import.meta.url;',
      "const fs = require('node:fs');",
      'const text = "import { Fake } from \'x\';";',
      '// import { Commented } from "y";',
      "declare module 'z' {",
      "  import { Inner } from 'inner';",
      '}',
    );
    expect(names(text)).toEqual([]);
  });
});

describe('missingImports', () => {
  test('keeps the lines whose names the file does not bind, whatever its spacing, quotes or renames', () => {
    const text = file(
      'import {',
      '  CartPage,',
      '} from "./pages/cart.page"',
      "import { SignInPage as Login } from './pages/sign-in.page';",
      "test('t', async ({ page }) => {});",
    );
    expect(
      missingImports(text, [
        "import { CartPage } from './pages/cart.page';",
        "import { SignInPage } from './pages/sign-in.page';",
        "import { fill } from './helpers';",
      ]),
    ).toEqual(["import { SignInPage } from './pages/sign-in.page';", "import { fill } from './helpers';"]);
    expect(missingImports(text, [])).toEqual([]);
  });
});
