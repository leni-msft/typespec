import {
  createDiagnosticCollector,
  Diagnostic,
  Interface,
  Namespace,
  Operation,
  Program,
  Type,
} from "@typespec/compiler";
import { createDiagnostic, createStateSymbol } from "../lib.js";
import { getActionSegment, getActionSeparator, getSegment, isAutoRoute } from "../rest.js";
import { extractParamsFromPath } from "../utils.js";
import { getRouteOptionsForNamespace, getRoutePath } from "./decorators.js";
import { getOperationParameters } from "./parameters.js";
import {
  HttpOperation,
  HttpOperationParameter,
  HttpOperationParameters,
  RouteOptions,
  RouteResolutionOptions,
} from "./types.js";

// The set of allowed segment separator characters
const AllowedSegmentSeparators = ["/", ":"];

function normalizeFragment(fragment: string) {
  if (fragment.length > 0 && AllowedSegmentSeparators.indexOf(fragment[0]) < 0) {
    // Insert the default separator
    fragment = `/${fragment}`;
  }

  // Trim any trailing slash
  return fragment.replace(/\/$/g, "");
}

function buildPath(pathFragments: string[]) {
  // Join all fragments with leading and trailing slashes trimmed
  const path =
    pathFragments.length === 0
      ? "/"
      : pathFragments
          .map(normalizeFragment)
          .filter((x) => x !== "")
          .join("");

  // The final path must start with a '/'
  return path.length > 0 && path[0] === "/" ? path : `/${path}`;
}

function addActionFragment(program: Program, target: Type, pathFragments: string[]) {
  // add the action segment, if present
  const defaultSeparator = "/";
  const actionSegment = getActionSegment(program, target);
  if (actionSegment && actionSegment !== "") {
    const actionSeparator = getActionSeparator(program, target) ?? defaultSeparator;
    pathFragments.push(`${actionSeparator}${actionSegment}`);
  }
}

function addSegmentFragment(program: Program, target: Type, pathFragments: string[]) {
  // Don't add the segment prefix if it is meant to be excluded
  // (empty string means exclude the segment)
  const segment = getSegment(program, target);

  if (segment && segment !== "") {
    pathFragments.push(`/${segment}`);
  }
}

function generatePathFromParameters(
  program: Program,
  operation: Operation,
  pathFragments: string[],
  parameters: HttpOperationParameters,
  options: RouteResolutionOptions
) {
  const filteredParameters: HttpOperationParameter[] = [];
  for (const httpParam of parameters.parameters) {
    const { type, param } = httpParam;
    if (type === "path") {
      addSegmentFragment(program, param, pathFragments);

      const filteredParam = options.autoRouteOptions?.routeParamFilter?.(operation, param);
      if (filteredParam?.routeParamString) {
        pathFragments.push(`/${filteredParam.routeParamString}`);

        if (filteredParam?.excludeFromOperationParams === true) {
          // Skip the rest of the loop so that we don't add the parameter to the final list
          continue;
        }
      } else {
        // Add the path variable for the parameter
        if (param.type.kind === "String") {
          pathFragments.push(`/${param.type.value}`);
          continue; // Skip adding to the parameter list
        } else {
          pathFragments.push(`/{${param.name}}`);
        }
      }
    }

    // Push all usable parameters to the filtered list
    filteredParameters.push(httpParam);
  }

  // Replace the original parameters with filtered set
  parameters.parameters = filteredParameters;

  // Add the operation's own segment if present
  addSegmentFragment(program, operation, pathFragments);

  // Add the operation's action segment if present
  addActionFragment(program, operation, pathFragments);
}

export function resolvePathAndParameters(
  program: Program,
  operation: Operation,
  overloadBase: HttpOperation | undefined,
  options: RouteResolutionOptions
): [
  {
    path: string;
    pathSegments: string[];
    parameters: HttpOperationParameters;
  },
  readonly Diagnostic[]
] {
  let segments = getOperationRouteSegments(program, operation, overloadBase);
  let parameters: HttpOperationParameters;
  const diagnostics = createDiagnosticCollector();
  if (isAutoRoute(program, operation)) {
    const [parentSegments, parentOptions] = getParentSegments(program, operation);
    segments = parentSegments.length ? parentSegments : segments;
    parameters = diagnostics.pipe(getOperationParameters(program, operation));

    // The operation exists within an @autoRoute scope, generate the path.  This
    // mutates the pathFragments and parameters lists that are passed in!
    generatePathFromParameters(program, operation, segments, parameters, {
      ...parentOptions,
      ...options,
    });
  } else {
    const declaredPathParams = segments.flatMap(extractParamsFromPath);
    parameters = diagnostics.pipe(
      getOperationParameters(program, operation, overloadBase, declaredPathParams)
    );

    // Pull out path parameters to verify what's in the path string
    const paramByName = new Map(
      parameters.parameters
        .filter(({ type }) => type === "path")
        .map(({ param }) => [param.name, param])
    );

    // For each param in the declared path parameters (e.g. /foo/{id} has one, id),
    // delete it because it doesn't need to be added to the path.
    for (const declaredParam of declaredPathParams) {
      const param = paramByName.get(declaredParam);
      if (!param) {
        diagnostics.add(
          createDiagnostic({
            code: "missing-path-param",
            format: { param: declaredParam },
            target: operation,
          })
        );
        continue;
      }

      paramByName.delete(declaredParam);
    }

    // Add any remaining declared path params
    for (const param of paramByName.keys()) {
      segments.push(`{${param}}`);
    }
  }

  return diagnostics.wrap({
    path: buildPath(segments),
    pathSegments: segments,
    parameters,
  });
}

function getOperationRouteSegments(
  program: Program,
  operation: Operation,
  overloadBase: HttpOperation | undefined
): string[] {
  if (overloadBase !== undefined && getRoutePath(program, operation) === undefined) {
    return overloadBase.pathSegments;
  } else {
    return getRouteSegments(program, operation)[0];
  }
}

function getParentSegments(
  program: Program,
  target: Operation | Interface | Namespace
): [string[], RouteOptions | undefined] {
  return "interface" in target && target.interface
    ? getRouteSegments(program, target.interface)
    : target.namespace
    ? getRouteSegments(program, target.namespace)
    : [[], undefined];
}

function getRouteSegments(
  program: Program,
  target: Operation | Interface | Namespace
): [string[], RouteOptions | undefined] {
  const route = getRoutePath(program, target)?.path;
  const seg = route ? [route] : [];
  const [parentSegments, parentOptions] = getParentSegments(program, target);
  const options =
    target.kind === "Namespace" ? getRouteOptionsForNamespace(program, target) : undefined;
  return [[...parentSegments, ...seg], options ?? parentOptions];
}

const externalInterfaces = createStateSymbol("externalInterfaces");
/**
 * @deprecated DO NOT USE. For internal use only as a workaround.
 * @param program Program
 * @param target Target namespace
 * @param sourceInterface Interface that should be included in namespace.
 */
export function includeInterfaceRoutesInNamespace(
  program: Program,
  target: Namespace,
  sourceInterface: string
) {
  let array = program.stateMap(externalInterfaces).get(target);
  if (array === undefined) {
    array = [];
    program.stateMap(externalInterfaces).set(target, array);
  }

  array.push(sourceInterface);
}
