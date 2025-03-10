import {
  compilerAssert,
  DiagnosticCollector,
  getEffectiveModelType,
  isVisible as isVisibleCore,
  Model,
  ModelProperty,
  Program,
  Queue,
  TwoLevelMap,
  Type,
  Union,
  walkPropertiesInherited,
} from "@typespec/compiler";
import {
  includeInapplicableMetadataInPayload,
  isBody,
  isHeader,
  isPathParam,
  isQueryParam,
  isStatusCode,
} from "./decorators.js";
import { HttpVerb } from "./types.js";

/**
 * Flags enum representation of well-known visibilities that are used in
 * REST API.
 */
export enum Visibility {
  Read = 1 << 0,
  Create = 1 << 1,
  Update = 1 << 2,
  Delete = 1 << 3,
  Query = 1 << 4,

  All = Read | Create | Update | Delete | Query,

  /**
   * Additional flag to indicate when something is nested in a collection
   * and therefore no metadata is applicable.
   */
  Item = 1 << 20,
}

const visibilityToArrayMap: Map<Visibility, string[]> = new Map();
function visibilityToArray(visibility: Visibility): readonly string[] {
  // Item flag is not a real visibility.
  visibility &= ~Visibility.Item;

  let result = visibilityToArrayMap.get(visibility);
  if (!result) {
    result = [];

    if (visibility & Visibility.Read) {
      result.push("read");
    }
    if (visibility & Visibility.Create) {
      result.push("create");
    }
    if (visibility & Visibility.Update) {
      result.push("update");
    }
    if (visibility & Visibility.Delete) {
      result.push("delete");
    }
    if (visibility & Visibility.Query) {
      result.push("query");
    }

    compilerAssert(result.length > 0, "invalid visibility");
    visibilityToArrayMap.set(visibility, result);
  }

  return result;
}

/**
 * Provides a naming suffix to create a unique name for a type with this
 * visibility.
 *
 * `Visibility.All` gets empty suffix, otherwise visibilities are joined in
 * pascal-case with `Or`. And `Item` is if `Visibility.Item` is produced.
 *
 * Examples:
 *  - Visibility.All => ""
 *  - Visibility.Read => "Read"
 *  - Visibility.Create | Visibility.Update => "CreateOrUpdate"
 *  - Visibility.Create | Visibility.Item => "CreateItem"
 *  - Visibility.Create | Visibility.Update | Visibility.Item =>  "CreateOrUpdateItem"
 *  */
export function getVisibilitySuffix(visibility: Visibility) {
  let suffix = "";

  if ((visibility & ~Visibility.Item) !== Visibility.All) {
    const visibilities = visibilityToArray(visibility);
    suffix += visibilities.map((v) => v[0].toUpperCase() + v.slice(1)).join("Or");
  }

  if (visibility & Visibility.Item) {
    suffix += "Item";
  }

  return suffix;
}

/**
 * Determines the visibility to use for a request with the given verb.
 *
 * - GET | HEAD => Visibility.Query
 * - POST => Visibility.Update
 * - PUT => Visibility.Create | Update
 * - DELETE => Visibility.Delete
 */
export function getRequestVisibility(verb: HttpVerb): Visibility {
  switch (verb) {
    case "get":
    case "head":
      return Visibility.Query;
    case "post":
      return Visibility.Create;
    case "put":
      return Visibility.Create | Visibility.Update;
    case "patch":
      return Visibility.Update;
    case "delete":
      return Visibility.Delete;
    default:
      const _assertNever: never = verb;
      compilerAssert(false, "unreachable");
  }
}

/**
 * Walks the given type and collects all applicable metadata and `@body`
 * properties recursively.
 */
export function gatherMetadata(
  program: Program,
  diagnostics: DiagnosticCollector, // currently unused, but reserved for future diagnostics
  type: Type,
  visibility: Visibility,
  isMetadataCallback = isMetadata
): Set<ModelProperty> {
  const metadata = new Map<string, ModelProperty>();
  if (type.kind !== "Model" || type.indexer || type.properties.size === 0) {
    return new Set();
  }

  const visited = new Set();
  const queue = new Queue([type]);

  while (!queue.isEmpty()) {
    const model = queue.dequeue();
    visited.add(model);

    for (const property of walkPropertiesInherited(model)) {
      if (!isVisible(program, property, visibility)) {
        continue;
      }

      // ISSUE: This should probably be an error, but that's a breaking
      // change that currently breaks some samples and tests.
      //
      // The traversal here is level-order so that the preferred metadata in
      // the case of duplicates, which is the most compatible with prior
      // behavior where nested metadata was always dropped.
      if (metadata.has(property.name)) {
        continue;
      }

      if (isApplicableMetadataOrBody(program, property, visibility, isMetadataCallback)) {
        metadata.set(property.name, property);
      }

      if (
        property.type.kind === "Model" &&
        !type.indexer &&
        type.properties.size > 0 &&
        !visited.has(property.type)
      ) {
        queue.enqueue(property.type);
      }
    }
  }

  return new Set(metadata.values());
}

/**
 * Determines if a property is metadata. A property is defined to be
 * metadata if it is marked `@header`, `@query`, `@path`, or `@statusCode`.
 */
export function isMetadata(program: Program, property: ModelProperty) {
  return (
    isHeader(program, property) ||
    isQueryParam(program, property) ||
    isPathParam(program, property) ||
    isStatusCode(program, property)
  );
}

/**
 * Determines if the given property is visible with the given visibility.
 */
export function isVisible(program: Program, property: ModelProperty, visibility: Visibility) {
  return isVisibleCore(program, property, visibilityToArray(visibility));
}

/**
 * Determines if the given property is metadata that is applicable with the
 * given visibility.
 *
 * - No metadata is applicable with Visibility.Item present.
 * - If only Visibility.Read is present, then only `@header` and `@status`
 *   properties are applicable.
 * - If Visibility.Read is not present, all metadata properties other than
 *   `@statusCode` are applicable.
 */
export function isApplicableMetadata(
  program: Program,
  property: ModelProperty,
  visibility: Visibility,
  isMetadataCallback = isMetadata
) {
  return isApplicableMetadataCore(program, property, visibility, false, isMetadataCallback);
}

/**
 * Determines if the given property is metadata or marked `@body` and
 * applicable with the given visibility.
 */
export function isApplicableMetadataOrBody(
  program: Program,
  property: ModelProperty,
  visibility: Visibility,
  isMetadataCallback = isMetadata
) {
  return isApplicableMetadataCore(program, property, visibility, true, isMetadataCallback);
}

function isApplicableMetadataCore(
  program: Program,
  property: ModelProperty,
  visibility: Visibility,
  treatBodyAsMetadata: boolean,
  isMetadataCallback: (program: Program, property: ModelProperty) => boolean
) {
  if (visibility & Visibility.Item) {
    return false; // no metadata is applicable to collection items
  }

  if (treatBodyAsMetadata && isBody(program, property)) {
    return true;
  }

  if (!isMetadataCallback(program, property)) {
    return false;
  }

  if (visibility === Visibility.Read) {
    return isHeader(program, property) || isStatusCode(program, property);
  }

  if (!(visibility & Visibility.Read)) {
    return !isStatusCode(program, property);
  }

  return true;
}

/**
 * Provides information about changes that happen to a data type's payload
 * when inapplicable metadata is added or invisible properties are removed.
 *
 * Results are computed on demand and expensive computations are memoized.
 */
export interface MetadataInfo {
  /**
   * Determines if the given type is a model that becomes empty once
   * applicable metadata is removed and visibility is applied.
   *
   * Note that a model is not considered emptied if it was already empty in
   * the first place, or has a base model or indexer.
   *
   * When the type of a property is emptied by visibility, the property
   * itself is also removed.
   */
  isEmptied(type: Type | undefined, visibility: Visibility): boolean;

  /**
   * Determines if the given type is transformed by applying the given
   * visibility and removing invisible properties or adding inapplicable
   * metadata properties.
   */
  isTransformed(type: Type | undefined, visibility: Visibility): boolean;

  /**
   * Determines if the given property is part of the request or response
   * payload and not applicable metadata (@see isApplicableMetadata) or
   * filtered out by the given visibility.
   */
  isPayloadProperty(property: ModelProperty, visibility: Visibility): boolean;

  /**
   * Determines if the given property is optional in the request or
   * response payload for the given visibility.
   */
  isOptional(property: ModelProperty, visibility: Visibility): boolean;

  /**
   * If type is an anonymous model, tries to find a named model that has the
   * same set of properties when non-payload properties are excluded.
   */
  getEffectivePayloadType(type: Type, visibility: Visibility): Type;
}

export interface MetadataInfoOptions {
  /**
   * Optional callback to indicate that a property can be shared with
   * `Visibility.All` representation even for visibilities where it is not
   * visible.
   *
   * This is used, for example, in OpenAPI emit where a property can be
   * marked `readOnly: true` to represent @visibility("read") without
   * creating a separate schema schema for Visibility.Read.
   */
  canShareProperty?(property: ModelProperty): boolean;
}

export function createMetadataInfo(program: Program, options?: MetadataInfoOptions): MetadataInfo {
  const enum State {
    NotTransformed,
    Transformed,
    Emptied,
    ComputationInProgress,
  }

  const stateMap = new TwoLevelMap<Type, Visibility, State>();

  return {
    isEmptied,
    isTransformed,
    isPayloadProperty,
    isOptional,
    getEffectivePayloadType,
  };

  function isEmptied(type: Type | undefined, visibility: Visibility): boolean {
    if (!type) {
      return false;
    }
    const state = getState(type, visibility);
    return state === State.Emptied;
  }

  function isTransformed(type: Type | undefined, visibility: Visibility): boolean {
    if (!type) {
      return false;
    }
    const state = getState(type, visibility);
    switch (state) {
      case State.Transformed:
        return true;
      case State.Emptied:
        return visibility === Visibility.All || !isEmptied(type, Visibility.All);
      default:
        return false;
    }
  }

  function getState(type: Type, visibility: Visibility): State {
    return stateMap.getOrAdd(
      type,
      visibility,
      () => computeState(type, visibility),
      State.ComputationInProgress
    );
  }

  function computeState(type: Type, visibility: Visibility): State {
    switch (type.kind) {
      case "Model":
        return computeStateForModel(type, visibility);
      case "Union":
        return computeStateForUnion(type, visibility);
      default:
        return State.NotTransformed;
    }
  }

  function computeStateForModel(model: Model, visibility: Visibility) {
    if (computeIsEmptied(model, visibility)) {
      return State.Emptied;
    }
    if (
      isTransformed(model.indexer?.value, visibility | Visibility.Item) ||
      isTransformed(model.baseModel, visibility)
    ) {
      return State.Transformed;
    }
    for (const property of model.properties.values()) {
      if (
        isAddedRemovedOrMadeOptional(property, visibility) ||
        isTransformed(property.type, visibility)
      ) {
        return State.Transformed;
      }
    }
    return State.NotTransformed;
  }

  function computeStateForUnion(union: Union, visibility: Visibility) {
    for (const variant of union.variants.values()) {
      if (isTransformed(variant.type, visibility)) {
        return State.Transformed;
      }
    }
    return State.NotTransformed;
  }

  function isAddedRemovedOrMadeOptional(property: ModelProperty, visibility: Visibility) {
    if (visibility === Visibility.All) {
      return false;
    }
    if (isOptional(property, Visibility.All) !== isOptional(property, visibility)) {
      return true;
    }
    return (
      isPayloadProperty(property, visibility, /* keep shared */ true) !==
      isPayloadProperty(property, Visibility.All, /*keep shared*/ true)
    );
  }

  function computeIsEmptied(model: Model, visibility: Visibility) {
    if (model.baseModel || model.indexer || model.properties.size === 0) {
      return false;
    }
    for (const property of model.properties.values()) {
      if (isPayloadProperty(property, visibility, /* keep shared */ true)) {
        return false;
      }
    }
    return true;
  }

  function isOptional(property: ModelProperty, visibility: Visibility): boolean {
    // Properties are only made optional for update visibility
    return property.optional || visibility === Visibility.Update;
  }

  function isPayloadProperty(
    property: ModelProperty,
    visibility: Visibility,
    keepShareableProperties?: boolean
  ): boolean {
    if (
      isEmptied(property.type, visibility) ||
      isApplicableMetadata(program, property, visibility) ||
      (isMetadata(program, property) && !includeInapplicableMetadataInPayload(program, property))
    ) {
      return false;
    }

    if (!isVisible(program, property, visibility)) {
      // NOTE: When we check if a model is transformed for a given
      // visibility, we retain shared properties. It is not considered
      // transformed if the only removed properties are shareable. However,,
      // if we do create a unique schema for a visibility, then we still
      // drop invisible shareable properties from other uses of
      // isPayloadProperty.
      //
      // For OpenAPI emit, for example, this means that we won't put a
      // readOnly: true property into a specialized schema for a non-read
      // visibility.
      return !!(keepShareableProperties && options?.canShareProperty?.(property));
    }

    return true;
  }

  /**
   * If the type is an anonymous model, tries to find a named model that has the same
   * set of properties when non-payload properties are excluded.
   */
  function getEffectivePayloadType(type: Type, visibility: Visibility): Type {
    if (type.kind === "Model" && !type.name) {
      const effective = getEffectiveModelType(program, type, (p) =>
        isPayloadProperty(p, visibility)
      );
      if (effective.name) {
        return effective;
      }
    }
    return type;
  }
}
