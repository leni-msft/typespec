import { Program } from "./program.js";
import {
  Enum,
  ErrorType,
  Interface,
  Model,
  Namespace,
  NeverType,
  Node,
  NullType,
  Operation,
  SyntaxKind,
  TemplateDeclarationNode,
  TemplatedType,
  Type,
  UnknownType,
  VoidType,
} from "./types.js";

export function isErrorType(type: Type): type is ErrorType {
  return type.kind === "Intrinsic" && type.name === "ErrorType";
}

export function isVoidType(type: Type): type is VoidType {
  return type.kind === "Intrinsic" && type.name === "void";
}

export function isNeverType(type: Type): type is NeverType {
  return type.kind === "Intrinsic" && type.name === "never";
}

export function isUnknownType(type: Type): type is UnknownType {
  return type.kind === "Intrinsic" && type.name === "unknown";
}

export function isNullType(type: Type): type is NullType {
  return type.kind === "Intrinsic" && type.name === "null";
}

/**
 * Lookup and find the node
 * @param node Node
 * @returns Template Parent node if applicable
 */
export function getParentTemplateNode(node: Node): (Node & TemplateDeclarationNode) | undefined {
  switch (node.kind) {
    case SyntaxKind.ModelStatement:
    case SyntaxKind.ScalarStatement:
    case SyntaxKind.OperationStatement:
    case SyntaxKind.InterfaceStatement:
      return node.templateParameters.length > 0 ? node : undefined;
    case SyntaxKind.OperationSignatureDeclaration:
    case SyntaxKind.ModelProperty:
    case SyntaxKind.ModelExpression:
      return node.parent ? getParentTemplateNode(node.parent) : undefined;
    default:
      return undefined;
  }
}

/**
 * Check if the given type has template arguments.
 */
export function isTemplateInstance(
  type: Type
): type is TemplatedType & { templateArguments: Type[] } {
  const maybeTemplateType = type as TemplatedType;
  return (
    maybeTemplateType.templateMapper !== undefined && !maybeTemplateType.templateMapper.partial
  );
}

/**
 * Resolve if the type is a template type declaration(Non initialized template type).
 */
export function isTemplateDeclaration(
  type: TemplatedType
): type is TemplatedType & { node: TemplateDeclarationNode } {
  if (type.node === undefined) {
    return false;
  }
  const node = type.node as TemplateDeclarationNode;
  return node.templateParameters && node.templateParameters.length > 0 && !isTemplateInstance(type);
}

/**
 * Resolve if the type was created from a template type or is a template type declaration.
 */
export function isTemplateDeclarationOrInstance(type: TemplatedType): boolean {
  if (type.node === undefined) {
    return false;
  }
  const node = type.node as TemplateDeclarationNode;
  return node.templateParameters && node.templateParameters.length > 0;
}

/**
 * Check if the given namespace is the global namespace
 * @param program Program
 * @param namespace Namespace
 * @returns {boolean}
 */
export function isGlobalNamespace(
  program: Program,
  namespace: Namespace
): namespace is Namespace & { name: ""; namespace: undefined } {
  return program.getGlobalNamespaceType() === namespace;
}

/**
 * Check if the given type is declared in the specified namespace or, optionally, its child namespaces.
 * @param type Type
 * @param namespace Namespace
 * @returns {boolean}
 */
export function isDeclaredInNamespace(
  type: Model | Operation | Interface | Namespace | Enum,
  namespace: Namespace,
  options: { recursive?: boolean } = { recursive: true }
) {
  let candidateNs = type.namespace;
  while (candidateNs) {
    if (candidateNs === namespace) {
      return true;
    }

    // Operations can be defined inside of an interface that is defined in the
    // desired namespace
    if (type.kind === "Operation" && type.interface && type.interface.namespace === namespace) {
      return true;
    }

    // If we are allowed to check recursively, walk up the namespace hierarchy
    candidateNs = options.recursive ? candidateNs.namespace : undefined;
  }

  return false;
}
