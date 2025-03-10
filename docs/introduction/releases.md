---
id: releases
title: Releases
---

# Releases

## Package versioning strategy

TypeSpec is not stable yet, all packages are released with `0.` major version. Each minor version might have some breaking changes to the typespec language, library API or both. Those are documented [here](./release-notes).

Every change to the `main` branch is automatically published under the npm `@next` tag.

## Current packages

| Name                                               | Changelog                        | Latest                                                                                                                                   | Next                                                                      |
| -------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Core functionality                                 |                                  |                                                                                                                                          |                                                                           |
| [@typespec/compiler][compiler_src]                 | [Changelog][compiler_chg]        | [![](https://img.shields.io/npm/v/@typespec/compiler)](https://www.npmjs.com/package/@typespec/compiler)                                 | ![](https://img.shields.io/npm/v/@typespec/compiler/next)                 |
| TypeSpec Libraries                                 |                                  |                                                                                                                                          |                                                                           |
| [@typespec/rest][rest_src]                         | [Changelog][rest_chg]            | [![](https://img.shields.io/npm/v/@typespec/rest)](https://www.npmjs.com/package/@typespec/rest)                                         | ![](https://img.shields.io/npm/v/@typespec/rest/next)                     |
| [@typespec/openapi][openapi_src]                   | [Changelog][openapi_chg]         | [![](https://img.shields.io/npm/v/@typespec/openapi)](https://www.npmjs.com/package/@typespec/openapi)                                   | ![](https://img.shields.io/npm/v/@typespec/openapi/next)                  |
| [@typespec/openapi3][openapi3_src]                 | [Changelog][openapi3_chg]        | [![](https://img.shields.io/npm/v/@typespec/openapi3)](https://www.npmjs.com/package/@typespec/openapi3)                                 | ![](https://img.shields.io/npm/v/@typespec/openapi3/next)                 |
| [@typespec/versioning][versioning_src]             | [Changelog][versioning_chg]      | [![](https://img.shields.io/npm/v/@typespec/versioning)](https://www.npmjs.com/package/@typespec/versioning)                             | ![](https://img.shields.io/npm/v/@typespec/versioning/next)               |
| TypeSpec Tools                                     |                                  |                                                                                                                                          |                                                                           |
| [@typespec/prettier-plugin-typespec][prettier_src] | [Changelog][prettier_chg]        | [![](https://img.shields.io/npm/v/@typespec/prettier-plugin-typespec)](https://www.npmjs.com/package/@typespec/prettier-plugin-typespec) | ![](https://img.shields.io/npm/v/@typespec/prettier-plugin-typespec/next) |
| [typespec-vs][typespec-vs_src]                     | [Changelog][typespec-vs_chg]     | [![](https://img.shields.io/npm/v/typespec-vs)](https://www.npmjs.com/package/typespec-vs)                                               | ![](https://img.shields.io/npm/v/typespec-vs/next)                        |
| [typespec-vscode][typespec-vscode_src]             | [Changelog][typespec-vscode_chg] | [![](https://img.shields.io/npm/v/typespec-vscode)](https://www.npmjs.com/package/typespec-vscode)                                       | ![](https://img.shields.io/npm/v/typespec-vscode/next)                    |
| [tmlanguage-generator][tmlanguage_src]             | [Changelog][tmlanguage_chg]      | [![](https://img.shields.io/npm/v/tmlanguage-generator)](https://www.npmjs.com/package/tmlanguage-generator)                             | ![](https://img.shields.io/npm/v/tmlanguage-generator/next)               |

[compiler_src]: https://github.com/microsoft/typespec/blob/main/packages/compiler
[compiler_chg]: https://github.com/microsoft/typespec/blob/main/packages/compiler/CHANGELOG.md
[rest_src]: https://github.com/microsoft/typespec/blob/main/packages/rest
[rest_chg]: https://github.com/microsoft/typespec/blob/main/packages/rest/CHANGELOG.md
[openapi_src]: https://github.com/microsoft/typespec/blob/main/packages/openapi
[openapi_chg]: https://github.com/microsoft/typespec/blob/main/packages/openapi/CHANGELOG.md
[openapi3_src]: https://github.com/microsoft/typespec/blob/main/packages/openapi3
[openapi3_chg]: https://github.com/microsoft/typespec/blob/main/packages/openapi3/CHANGELOG.md
[versioning_src]: https://github.com/microsoft/typespec/blob/main/packages/versioning
[versioning_chg]: https://github.com/microsoft/typespec/blob/main/packages/versioning/CHANGELOG.md
[prettier_src]: https://github.com/microsoft/typespec/blob/main/packages/prettier-plugin-typespec
[prettier_chg]: https://github.com/microsoft/typespec/blob/main/packages/prettier-plugin-typespec/CHANGELOG.md
[typespec-vs_src]: https://github.com/microsoft/typespec/blob/main/packages/typespec-vs
[typespec-vs_chg]: https://github.com/microsoft/typespec/blob/main/packages/typespec-vs/CHANGELOG.md
[typespec-vscode_src]: https://github.com/microsoft/typespec/blob/main/packages/typespec-vscode
[typespec-vscode_chg]: https://github.com/microsoft/typespec/blob/main/packages/typespec-vscode/CHANGELOG.md
[tmlanguage_src]: https://github.com/microsoft/typespec/blob/main/packages/tmlanguage-generator
[tmlanguage_chg]: https://github.com/microsoft/typespec/blob/main/packages/tmlanguage-generator/CHANGELOG.md

## Release cadence

We release changes from all packages the first week of every month.

You can look at the millestones https://github.com/microsoft/typespec/milestones to see upcoming changes. Millestones are named after the target release month (i.e `[2022] October` is the sprint running in september targeting a release in the first week of October.)

## Breaking changes migration guides

Release notes describing the breaking changes and how to migrate can be found in this folder:

[https://github.com/microsoft/typespec/tree/main/docs/release-notes](https://github.com/microsoft/typespec/tree/main/docs/release-notes)
