/**
 * Copyright (c) 2026 Salesforce, Inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 **/

import * as vscode from 'vscode';
import { LocalizationKeys } from './localizationKeys';
import { localizationValues } from './localizationValues';

/**
 * Localize a string by key. Positional arguments are substituted into the
 * `{0}` / `{1}` / ... placeholders declared in `localizationValues.ts`.
 *
 * Runtime behavior: when VSCode has a translation for the default English
 * string in the active locale, it returns the translation; otherwise it
 * returns the English default. No errors for missing translations — the
 * English string is always the fallback.
 */
export const getLocalization = (
  key: LocalizationKeys,
  ...args: (string | number | boolean)[]
): string => vscode.l10n.t(localizationValues[key], ...args);
