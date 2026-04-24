export interface VsixOverride {
  extensionId: string;
  version: string;
  filePath: string;
  /**
   * How the scanner decided this file maps to `extensionId`.
   *   'strict' — `<publisher>.<name>-<version>.vsix` shape from
   *              `vsce package`.
   *   'prefix' — fuzzy match against a managed extension id whose
   *              name portion is the longest prefix of the filename
   *              stem. Logged when it fires so an unintended match
   *              is discoverable via the output channel.
   */
  matchedBy?: 'strict' | 'prefix';
}
