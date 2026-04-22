/**
 * Copyright (c) 2026 Salesforce, Inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 **/

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/unit/**/?(*.)+(spec|test).[t]s?(x)'],
  resetMocks: true,
  restoreMocks: true,
  modulePathIgnorePatterns: ['.vscode-test'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/test/unit/mocks/vscode.ts'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ]
};
