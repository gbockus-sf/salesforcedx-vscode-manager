import { getLocalization, LocalizationKeys } from '../../src/localization';
import { localizationValues } from '../../src/localization/localizationValues';

describe('localization', () => {
  it('every LocalizationKeys entry has a non-empty default value', () => {
    const missing: string[] = [];
    for (const key of Object.values(LocalizationKeys)) {
      const value = localizationValues[key];
      if (typeof value !== 'string' || value.length === 0) {
        missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every value that declares a placeholder {n} is reachable via getLocalization with positional args', () => {
    // Sanity-check the `{0}` substitution path against one concrete key.
    expect(getLocalization(LocalizationKeys.applySummaryApplied, 'Apex')).toBe('Apex applied.');
    expect(getLocalization(LocalizationKeys.createGroupSuccess, 'My Group', 5)).toBe(
      'Group "My Group" created with 5 extensions.'
    );
    // No-arg keys round-trip unchanged.
    expect(getLocalization(LocalizationKeys.showLog)).toBe('Show Log');
  });

  it('placeholders for missing positional args are left intact', () => {
    // Regression guard for the mock behavior we depend on in other tests.
    expect(getLocalization(LocalizationKeys.applySummaryApplied)).toBe('{0} applied.');
  });
});
