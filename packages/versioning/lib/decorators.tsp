import "../dist/src/versioning.js";

using TypeSpec.Reflection;

namespace TypeSpec.Versioning;

extern dec versioned(target: Namespace, versions: Enum);
extern dec useDependency(target: EnumMember | Namespace, ...versionRecords: EnumMember[]);
extern dec versionedDependency(target: Namespace, mapping: EnumMember | [EnumMember, EnumMember][]);

extern dec added(target: unknown, version: EnumMember);
extern dec removed(target: unknown, version: EnumMember);
extern dec renamedFrom(target: unknown, version: EnumMember, oldName: string);
extern dec madeOptional(target: unknown, version: EnumMember);
extern dec typeChangedFrom(target: unknown, version: EnumMember, oldType: unknown);

extern fn existsAtVersion(target: unknown, version: EnumMember): boolean;
extern fn hasDifferentNameAtVersion(target: unknown, version: EnumMember): boolean;
extern fn madeOptionalAfter(target: unknown, version: EnumMember): boolean;
extern fn getVersionForEnumMember(target: unknown, version: EnumMember): boolean;
