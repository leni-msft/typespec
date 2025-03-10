import { EmitterOptions } from "../config/types.js";
import { createAssetEmitter } from "../emitter-framework/asset-emitter.js";
import { createBinder } from "./binder.js";
import { Checker, createChecker } from "./checker.js";
import { compilerAssert, createSourceFile } from "./diagnostics.js";
import { getLibraryUrlsLoaded } from "./library.js";
import { createLogger } from "./logger/index.js";
import { createTracer } from "./logger/tracer.js";
import { MANIFEST } from "./manifest.js";
import { createDiagnostic } from "./messages.js";
import {
  ModuleResolutionResult,
  NodePackage,
  ResolvedModule,
  resolveModule,
  ResolveModuleHost,
} from "./module-resolver.js";
import { CompilerOptions } from "./options.js";
import { isImportStatement, parse, parseStandaloneTypeReference } from "./parser.js";
import { getDirectoryPath, joinPaths, resolvePath } from "./path-utils.js";
import { createProjector } from "./projector.js";
import {
  CompilerHost,
  Diagnostic,
  DiagnosticTarget,
  Directive,
  DirectiveExpressionNode,
  EmitContext,
  EmitterFunc,
  JsSourceFileNode,
  LiteralType,
  Namespace,
  Node,
  NodeFlags,
  NoTarget,
  ProjectionApplication,
  Projector,
  SourceFile,
  Sym,
  SymbolFlags,
  SymbolTable,
  SyntaxKind,
  Tracer,
  Type,
  TypeSpecLibrary,
  TypeSpecScriptNode,
} from "./types.js";
import {
  deepEquals,
  doIO,
  ExternalError,
  findProjectRoot,
  isDefined,
  loadFile,
  mapEquals,
  mutate,
} from "./util.js";

export interface ProjectedProgram extends Program {
  projector: Projector;
}

export function isProjectedProgram(
  program: Program | ProjectedProgram
): program is ProjectedProgram {
  return "projector" in program;
}

export interface Program {
  compilerOptions: CompilerOptions;
  mainFile?: TypeSpecScriptNode;
  /** All source files in the program, keyed by their file path. */
  sourceFiles: Map<string, TypeSpecScriptNode>;
  jsSourceFiles: Map<string, JsSourceFileNode>;
  literalTypes: Map<string | number | boolean, LiteralType>;
  host: CompilerHost;
  tracer: Tracer;
  trace(area: string, message: string): void;
  checker: Checker;
  emitters: EmitterRef[];
  readonly diagnostics: readonly Diagnostic[];
  loadTypeSpecScript(typespecScript: SourceFile): Promise<TypeSpecScriptNode>;
  onValidate(cb: (program: Program) => void | Promise<void>): void;
  getOption(key: string): string | undefined;
  stateSet(key: symbol): Set<Type>;
  stateSets: Map<symbol, StateSet>;
  stateMap(key: symbol): Map<Type, any>;
  stateMaps: Map<symbol, StateMap>;
  hasError(): boolean;
  reportDiagnostic(diagnostic: Diagnostic): void;
  reportDiagnostics(diagnostics: readonly Diagnostic[]): void;
  reportDuplicateSymbols(symbols: SymbolTable | undefined): void;

  getGlobalNamespaceType(): Namespace;
  resolveTypeReference(reference: string): [Type | undefined, readonly Diagnostic[]];
}

interface LibraryMetadata {
  /**
   * Library name as specified in the package.json or in exported $lib.
   */
  name?: string;

  /**
   * Library homepage.
   */
  homepage?: string;

  bugs?: {
    /**
     * Url where to file bugs for this library.
     */
    url?: string;
  };
}

interface EmitterRef {
  emitFunction: EmitterFunc;
  main: string;
  metadata: LibraryMetadata;
  emitterOutputDir: string;
  options: Record<string, unknown>;
}

class StateMap extends Map<undefined | Projector, Map<Type, unknown>> {}
class StateSet extends Map<undefined | Projector, Set<Type>> {}

class StateMapView<V> implements Map<Type, V> {
  public constructor(private state: StateMap, private projector?: Projector) {}

  has(t: Type) {
    return this.dispatch(t)?.has(t) ?? false;
  }

  set(t: Type, v: any) {
    this.dispatch(t).set(t, v);
    return this;
  }

  get(t: Type) {
    return this.dispatch(t).get(t);
  }

  delete(t: Type) {
    return this.dispatch(t).delete(t);
  }

  forEach(cb: (value: V, key: Type, map: Map<Type, V>) => void, thisArg?: any) {
    this.dispatch().forEach(cb, thisArg);
    return this;
  }

  get size() {
    return this.dispatch().size;
  }

  clear() {
    return this.dispatch().clear();
  }

  entries() {
    return this.dispatch().entries();
  }

  values() {
    return this.dispatch().values();
  }

  keys() {
    return this.dispatch().keys();
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  [Symbol.toStringTag] = "StateMap";

  dispatch(keyType?: Type): Map<Type, V> {
    const key = keyType ? keyType.projector : this.projector;
    if (!this.state.has(key)) {
      this.state.set(key, new Map());
    }

    return this.state.get(key)! as any;
  }
}

class StateSetView implements Set<Type> {
  public constructor(private state: StateSet, private projector?: Projector) {}

  has(t: Type) {
    return this.dispatch(t)?.has(t) ?? false;
  }

  add(t: Type) {
    this.dispatch(t).add(t);
    return this;
  }

  delete(t: Type) {
    return this.dispatch(t).delete(t);
  }

  forEach(cb: (value: Type, value2: Type, set: Set<Type>) => void, thisArg?: any) {
    this.dispatch().forEach(cb, thisArg);
    return this;
  }

  get size() {
    return this.dispatch().size;
  }

  clear() {
    return this.dispatch().clear();
  }

  values() {
    return this.dispatch().values();
  }

  keys() {
    return this.dispatch().keys();
  }

  entries() {
    return this.dispatch().entries();
  }

  [Symbol.iterator]() {
    return this.values();
  }

  [Symbol.toStringTag] = "StateSet";

  dispatch(keyType?: Type): Set<Type> {
    const key = keyType ? keyType.projector : this.projector;
    if (!this.state.has(key)) {
      this.state.set(key, new Set());
    }

    return this.state.get(key)!;
  }
}

interface TypeSpecLibraryReference {
  path: string;
  manifest: NodePackage;
}

export function projectProgram(
  program: Program,
  projections: ProjectionApplication[],
  startNode?: Type
): ProjectedProgram {
  return createProjector(program, projections, startNode);
}

export async function compile(
  host: CompilerHost,
  mainFile: string,
  options: CompilerOptions = {},
  oldProgram?: Program // NOTE: deliberately separate from options to avoid memory leak by chaining all old programs together.
): Promise<Program> {
  const validateCbs: any = [];
  const stateMaps = new Map<symbol, StateMap>();
  const stateSets = new Map<symbol, StateSet>();
  const diagnostics: Diagnostic[] = [];
  const seenSourceFiles = new Set<string>();
  const duplicateSymbols = new Set<Sym>();
  const emitters: EmitterRef[] = [];
  const requireImports = new Map<string, string>();
  const loadedLibraries = new Map<string, TypeSpecLibraryReference>();
  let error = false;

  const logger = createLogger({ sink: host.logSink });
  const tracer = createTracer(logger, { filter: options.trace });

  const program: Program = {
    checker: undefined!,
    compilerOptions: resolveOptions(options),
    sourceFiles: new Map(),
    jsSourceFiles: new Map(),
    literalTypes: new Map(),
    host,
    diagnostics,
    emitters,
    loadTypeSpecScript,
    getOption,
    stateMaps,
    stateSets,
    tracer,
    trace,
    ...createStateAccessors(stateMaps, stateSets),
    reportDiagnostic,
    reportDiagnostics,
    reportDuplicateSymbols,
    hasError() {
      return error;
    },
    onValidate(cb) {
      validateCbs.push(cb);
    },
    getGlobalNamespaceType,
    resolveTypeReference,
  };

  trace("compiler.options", JSON.stringify(options, null, 2));

  function trace(area: string, message: string) {
    tracer.trace(area, message);
  }
  const binder = createBinder(program);

  if (!options?.nostdlib) {
    await loadStandardLibrary(program);
  }

  const resolvedMain = await resolveTypeSpecEntrypoint(mainFile);
  // Load additional imports prior to compilation
  if (resolvedMain && options.additionalImports) {
    const importScript = options.additionalImports.map((i) => `import "${i}";`).join("\n");
    const sourceFile = createSourceFile(
      importScript,
      joinPaths(getDirectoryPath(resolvedMain), `__additional_imports`)
    );
    await loadTypeSpecScript(sourceFile);
  }

  if (resolvedMain) {
    await loadMain(resolvedMain, options);
  }

  if (resolvedMain) {
    let emit = options.emit;
    let emitterOptions = options.options;
    if (options.emitters) {
      emit ??= Object.keys(options.emitters);
      emitterOptions ??= options.emitters;
    }
    await loadEmitters(resolvedMain, emit ?? [], emitterOptions ?? {});
  }

  if (
    oldProgram &&
    mapEquals(oldProgram.sourceFiles, program.sourceFiles) &&
    deepEquals(oldProgram.compilerOptions, program.compilerOptions)
  ) {
    return oldProgram;
  }

  // let GC reclaim old program, we do not reuse it beyond this point.
  oldProgram = undefined;

  program.checker = createChecker(program);
  program.checker.checkProgram();

  if (program.hasError()) {
    return program;
  }
  for (const cb of validateCbs) {
    try {
      await cb(program);
    } catch (error: any) {
      if (options.designTimeBuild) {
        program.reportDiagnostic(
          createDiagnostic({
            code: "on-validate-fail",
            format: { error: error.stack },
            target: NoTarget,
          })
        );
      } else {
        throw error;
      }
    }
  }

  for (const [requiredImport, emitterName] of requireImports) {
    if (!loadedLibraries.has(requiredImport)) {
      program.reportDiagnostic(
        createDiagnostic({
          code: "missing-import",
          format: { requiredImport, emitterName },
          target: NoTarget,
        })
      );
    }
  }

  await validateLoadedLibraries();
  if (program.hasError()) {
    return program;
  }

  for (const instance of emitters) {
    await runEmitter(instance);
  }

  return program;

  /**
   * Validate the libraries loaded during the compilation process are compatible.
   */
  async function validateLoadedLibraries() {
    const loadedRoots = new Set<string>();
    // Check all the files that were loaded
    for (const fileUrl of getLibraryUrlsLoaded()) {
      const root = await findProjectRoot(host, host.fileURLToPath(fileUrl));
      if (root) {
        loadedRoots.add(root);
      }
    }

    const libraries = new Map([...loadedLibraries.entries()]);
    const incompatibleLibraries = new Map<string, TypeSpecLibraryReference[]>();
    for (const root of loadedRoots) {
      const packageJsonPath = joinPaths(root, "package.json");
      try {
        const packageJson: NodePackage = JSON.parse((await host.readFile(packageJsonPath)).text);
        const found = libraries.get(packageJson.name);
        if (found && found.path !== root && found.manifest.version !== packageJson.version) {
          let incompatibleIndex: TypeSpecLibraryReference[] | undefined = incompatibleLibraries.get(
            packageJson.name
          );
          if (incompatibleIndex === undefined) {
            incompatibleIndex = [found];
            incompatibleLibraries.set(packageJson.name, incompatibleIndex);
          }
          incompatibleIndex.push({ path: root, manifest: packageJson });
        }
      } catch {}
    }

    for (const [name, incompatibleLibs] of incompatibleLibraries) {
      reportDiagnostic(
        createDiagnostic({
          code: "incompatible-library",
          format: {
            name: name,
            versionMap: incompatibleLibs
              .map((x) => `  - Version: "${x.manifest.version}" installed at "${x.path}"`)
              .join("\n"),
          },
          target: NoTarget,
        })
      );
    }
  }

  async function loadStandardLibrary(program: Program) {
    for (const dir of host.getLibDirs()) {
      await loadDirectory(dir, NoTarget);
    }
  }

  async function loadDirectory(
    dir: string,
    diagnosticTarget: DiagnosticTarget | typeof NoTarget
  ): Promise<string> {
    const mainFile = await resolveTypeSpecEntrypointForDir(dir);
    await loadTypeSpecFile(mainFile, diagnosticTarget);
    return mainFile;
  }

  async function loadTypeSpecFile(
    path: string,
    diagnosticTarget: DiagnosticTarget | typeof NoTarget
  ) {
    if (seenSourceFiles.has(path)) {
      return;
    }
    seenSourceFiles.add(path);

    const file = await doIO(host.readFile, path, program.reportDiagnostic, {
      diagnosticTarget,
    });

    if (file) {
      await loadTypeSpecScript(file);
    }
  }

  async function loadJsFile(
    path: string,
    diagnosticTarget: DiagnosticTarget | typeof NoTarget
  ): Promise<JsSourceFileNode | undefined> {
    const sourceFile = program.jsSourceFiles.get(path);
    if (sourceFile !== undefined) {
      return sourceFile;
    }

    const file = createSourceFile("", path);
    const exports = await doIO(host.getJsImport, path, program.reportDiagnostic, {
      diagnosticTarget,
      jsDiagnosticTarget: { file, pos: 0, end: 0 },
    });

    if (!exports) {
      return undefined;
    }

    return {
      kind: SyntaxKind.JsSourceFile,
      id: {
        kind: SyntaxKind.Identifier,
        sv: "",
        pos: 0,
        end: 0,
        symbol: undefined!,
        flags: NodeFlags.Synthetic,
      },
      esmExports: exports,
      file,
      namespaceSymbols: [],
      symbol: undefined!,
      pos: 0,
      end: 0,
      flags: NodeFlags.None,
    };
  }

  /**
   * Import the Javascript files decorator and lifecycle hooks.
   */
  async function importJsFile(path: string, diagnosticTarget: DiagnosticTarget | typeof NoTarget) {
    const file = await loadJsFile(path, diagnosticTarget);
    if (file !== undefined) {
      program.jsSourceFiles.set(path, file);
      binder.bindJsSourceFile(file);
    }
  }

  async function loadTypeSpecScript(file: SourceFile): Promise<TypeSpecScriptNode> {
    // This is not a diagnostic because the compiler should never reuse the same path.
    // It's the caller's responsibility to use unique paths.
    if (program.sourceFiles.has(file.path)) {
      throw new RangeError("Duplicate script path: " + file.path);
    }

    const script = parseOrReuse(file);
    program.reportDiagnostics(script.parseDiagnostics);
    program.sourceFiles.set(file.path, script);
    binder.bindSourceFile(script);
    await loadScriptImports(script);
    return script;
  }

  function parseOrReuse(file: SourceFile): TypeSpecScriptNode {
    const old = oldProgram?.sourceFiles.get(file.path) ?? host?.parseCache?.get(file);
    if (old?.file === file && deepEquals(old.parseOptions, options.parseOptions)) {
      return old;
    }
    const script = parse(file, options.parseOptions);
    host.parseCache?.set(file, script);
    return script;
  }

  async function loadScriptImports(file: TypeSpecScriptNode) {
    // collect imports
    const basedir = getDirectoryPath(file.file.path);
    await loadImports(
      file.statements.filter(isImportStatement).map((x) => ({ path: x.path.value, target: x })),
      basedir
    );
  }

  async function loadImports(
    imports: Array<{ path: string; target: DiagnosticTarget | typeof NoTarget }>,
    relativeTo: string
  ) {
    // collect imports
    for (const { path, target } of imports) {
      await loadImport(path, target, relativeTo);
    }
  }

  async function loadImport(
    path: string,
    target: DiagnosticTarget | typeof NoTarget,
    relativeTo: string
  ) {
    const library = await resolveTypeSpecLibrary(path, relativeTo, target);
    if (library === undefined) {
      return;
    }
    if (library.type === "module") {
      loadedLibraries.set(library.manifest.name, {
        path: library.path,
        manifest: library.manifest,
      });
      trace("import-resolution.library", `Loading library "${path}" from "${library.mainFile}"`);
    }
    const importFilePath = library.type === "module" ? library.mainFile : library.path;

    const isDirectory = (await host.stat(importFilePath)).isDirectory();
    if (isDirectory) {
      return await loadDirectory(importFilePath, target);
    }

    const sourceFileKind = host.getSourceFileKind(importFilePath);

    switch (sourceFileKind) {
      case "js":
        return await importJsFile(importFilePath, target);
      case "typespec":
        return await loadTypeSpecFile(importFilePath, target);
      default:
        program.reportDiagnostic(createDiagnostic({ code: "invalid-import", target }));
    }
  }

  async function loadEmitters(
    mainFile: string,
    emitterNameOrPaths: string[],
    emitterOptions: Record<string, EmitterOptions>
  ) {
    const emitterThatShouldExists = new Set(Object.keys(emitterOptions));
    for (const emitterNameOrPath of emitterNameOrPaths) {
      const emitter = await loadEmitter(mainFile, emitterNameOrPath, emitterOptions);
      if (emitter) {
        emitters.push(emitter);
        emitterThatShouldExists.delete(emitter.metadata.name ?? emitterNameOrPath);
      }
    }

    // This is the emitter names under options that haven't been used. We need to check if it points to an emitter that wasn't loaded
    for (const emitterName of emitterThatShouldExists) {
      // attempt to resolve a node module with this name
      const [module, _] = await resolveEmitterModuleAndEntrypoint(mainFile, emitterName);
      if (module?.entrypoint === undefined) {
        program.reportDiagnostic(
          createDiagnostic({
            code: "emitter-not-found",
            format: { emitterName },
            target: NoTarget,
          })
        );
      }
    }
  }

  async function resolveEmitterModuleAndEntrypoint(
    mainFile: string,
    emitterNameOrPath: string
  ): Promise<
    [
      { module: ModuleResolutionResult; entrypoint: JsSourceFileNode | undefined } | undefined,
      readonly Diagnostic[]
    ]
  > {
    const basedir = getDirectoryPath(mainFile);

    // attempt to resolve a node module with this name
    const [module, diagnostics] = await resolveJSLibrary(emitterNameOrPath, basedir);
    if (!module) {
      return [undefined, diagnostics];
    }

    const entrypoint = module.type === "file" ? module.path : module.mainFile;
    const file = await loadJsFile(entrypoint, NoTarget);

    return [{ module, entrypoint: file }, []];
  }
  async function loadEmitter(
    mainFile: string,
    emitterNameOrPath: string,
    emittersOptions: Record<string, EmitterOptions>
  ): Promise<EmitterRef | undefined> {
    const [resolution, diagnostics] = await resolveEmitterModuleAndEntrypoint(
      mainFile,
      emitterNameOrPath
    );

    if (resolution === undefined) {
      program.reportDiagnostics(diagnostics);
      return undefined;
    }
    const { module, entrypoint } = resolution;

    if (entrypoint === undefined) {
      program.reportDiagnostic(
        createDiagnostic({
          code: "invalid-emitter",
          format: { emitterPackage: emitterNameOrPath },
          target: NoTarget,
        })
      );
      return undefined;
    }

    const emitFunction = entrypoint.esmExports.$onEmit;
    const libDefinition: TypeSpecLibrary<any> | undefined = entrypoint.esmExports.$lib;
    const metadata = computeLibraryMetadata(module);

    let { "emitter-output-dir": emitterOutputDir, ...emitterOptions } =
      emittersOptions[metadata.name ?? emitterNameOrPath] ?? {};
    if (emitterOutputDir === undefined) {
      emitterOutputDir = [options.outputDir, metadata.name].filter(isDefined).join("/");
    }
    if (libDefinition?.requireImports) {
      for (const lib of libDefinition.requireImports) {
        requireImports.set(lib, libDefinition.name);
      }
    }
    if (emitFunction !== undefined) {
      if (libDefinition?.emitter?.options) {
        const diagnostics = libDefinition?.emitterOptionValidator?.validate(
          emitterOptions,
          NoTarget
        );
        if (diagnostics && diagnostics.length > 0) {
          program.reportDiagnostics(diagnostics);
          return;
        }
      }
      return {
        main: entrypoint.file.path,
        emitFunction,
        metadata,
        emitterOutputDir,
        options: emitterOptions,
      };
    } else {
      program.reportDiagnostic(
        createDiagnostic({
          code: "invalid-emitter",
          format: { emitterPackage: emitterNameOrPath },
          target: NoTarget,
        })
      );
      return undefined;
    }
  }

  function computeLibraryMetadata(module: ModuleResolutionResult): LibraryMetadata {
    if (module.type === "file") {
      return {};
    }

    const metadata: LibraryMetadata = {
      name: module.manifest.name,
    };

    if (module.manifest.homepage) {
      metadata.homepage = module.manifest.homepage;
    }
    if (module.manifest.bugs?.url) {
      metadata.bugs = { url: module.manifest.bugs?.url };
    }

    return metadata;
  }

  /**
   * @param emitter Emitter ref to run
   */
  async function runEmitter(emitter: EmitterRef) {
    const context: EmitContext<any> = {
      program,
      emitterOutputDir: emitter.emitterOutputDir,
      options: emitter.options,
      getAssetEmitter(TypeEmitterClass) {
        return createAssetEmitter(program, TypeEmitterClass, this);
      },
    };
    try {
      await emitter.emitFunction(context);
    } catch (error: any) {
      const msg = [`Emitter "${emitter.metadata.name ?? emitter.main}" failed!`];
      if (emitter.metadata.bugs?.url) {
        msg.push(`File issue at ${emitter.metadata.bugs?.url}`);
      } else {
        msg.push(`Please contact emitter author to report this issue.`);
      }
      msg.push("");
      if ("stack" in error) {
        msg.push(error.stack);
      } else {
        msg.push(String(error));
      }

      throw new ExternalError(msg.join("\n"));
    }
  }

  /**
   * resolves a module specifier like "myLib" to an absolute path where we can find the main of
   * that module, e.g. "/typespec/node_modules/myLib/main.tsp".
   */
  async function resolveTypeSpecLibrary(
    specifier: string,
    baseDir: string,
    target: DiagnosticTarget | typeof NoTarget
  ): Promise<ModuleResolutionResult | undefined> {
    try {
      return await resolveModule(getResolveModuleHost(), specifier, {
        baseDir,
        directoryIndexFiles: ["main.tsp", "index.mjs", "index.js"],
        resolveMain(pkg) {
          // this lets us follow node resolve semantics more-or-less exactly
          // but using typespecMain instead of main.
          return pkg.typespecMain ?? pkg.main;
        },
      });
    } catch (e: any) {
      if (e.code === "MODULE_NOT_FOUND") {
        program.reportDiagnostic(
          createDiagnostic({ code: "import-not-found", format: { path: specifier }, target })
        );
        return undefined;
      } else if (e.code === "INVALID_MAIN") {
        program.reportDiagnostic(
          createDiagnostic({
            code: "library-invalid",
            format: { path: specifier },
            messageId: "typespecMain",
            target,
          })
        );
        return undefined;
      } else {
        throw e;
      }
    }
  }

  /**
   * resolves a module specifier like "myLib" to an absolute path where we can find the main of
   * that module, e.g. "/typespec/node_modules/myLib/dist/lib.js".
   */
  async function resolveJSLibrary(
    specifier: string,
    baseDir: string
  ): Promise<[ModuleResolutionResult | undefined, readonly Diagnostic[]]> {
    try {
      return [await resolveModule(getResolveModuleHost(), specifier, { baseDir }), []];
    } catch (e: any) {
      if (e.code === "MODULE_NOT_FOUND") {
        return [
          undefined,
          [
            createDiagnostic({
              code: "import-not-found",
              format: { path: specifier },
              target: NoTarget,
            }),
          ],
        ];
      } else if (e.code === "INVALID_MAIN") {
        return [
          undefined,
          [
            createDiagnostic({
              code: "library-invalid",
              format: { path: specifier },
              target: NoTarget,
            }),
          ],
        ];
      } else {
        throw e;
      }
    }
  }

  function getResolveModuleHost(): ResolveModuleHost {
    return {
      realpath: host.realpath,
      stat: host.stat,
      readFile: async (path) => {
        const file = await host.readFile(path);
        return file.text;
      },
    };
  }

  /**
   * Resolve the path to the main file
   * @param path path to the entrypoint of the program. Can be the main.tsp, folder containing main.tsp or a project/library root.
   * @returns Absolute path to the entrypoint.
   */
  async function resolveTypeSpecEntrypoint(path: string): Promise<string | undefined> {
    const resolvedPath = resolvePath(path);
    const mainStat = await doIO(host.stat, resolvedPath, program.reportDiagnostic);
    if (!mainStat) {
      return undefined;
    }

    if (mainStat.isDirectory()) {
      return resolveTypeSpecEntrypointForDir(resolvedPath);
    } else {
      return resolvedPath;
    }
  }

  async function resolveTypeSpecEntrypointForDir(dir: string): Promise<string> {
    const pkgJsonPath = resolvePath(dir, "package.json");
    const [pkg] = await loadFile(host, pkgJsonPath, JSON.parse, program.reportDiagnostic, {
      allowFileNotFound: true,
    });
    const mainFile = resolvePath(
      dir,
      typeof pkg?.typespecMain === "string" ? pkg.typespecMain : "main.tsp"
    );
    return mainFile;
  }

  /**
   * Load the main file from the given path
   * @param mainPath Absolute path to the main file.
   * @param options Compiler options.
   * @returns
   */
  async function loadMain(mainPath: string, options: CompilerOptions): Promise<void> {
    await checkForCompilerVersionMismatch(mainPath);

    const sourceFileKind = host.getSourceFileKind(mainPath);

    switch (sourceFileKind) {
      case "js":
        return await importJsFile(mainPath, NoTarget);
      case "typespec":
        return await loadTypeSpecFile(mainPath, NoTarget);
      default:
        program.reportDiagnostic(createDiagnostic({ code: "invalid-main", target: NoTarget }));
    }
  }

  // It's important that we use the compiler version that resolves locally
  // from the input TypeSpec source location. Otherwise, there will be undefined
  // runtime behavior when decorators and handlers expect a
  // different version of typespec than the current one. Abort the compilation
  // with an error if the TypeSpec entry point resolves to a different local
  // compiler.
  async function checkForCompilerVersionMismatch(mainPath: string): Promise<boolean> {
    const baseDir = getDirectoryPath(mainPath);
    let actual: ResolvedModule;
    try {
      const resolved = await resolveModule(
        {
          realpath: host.realpath,
          stat: host.stat,
          readFile: async (path) => {
            const file = await host.readFile(path);
            return file.text;
          },
        },
        "@typespec/compiler",
        { baseDir }
      );
      compilerAssert(
        resolved.type === "module",
        `Expected to have resolved "@typespec/compiler" to a node module.`
      );
      actual = resolved;
    } catch (err: any) {
      if (err.code === "MODULE_NOT_FOUND" || err.code === "INVALID_MAIN") {
        return true; // no local typespec, ok to use any compiler
      }
      throw err;
    }

    const expected = resolvePath(
      await host.realpath(host.fileURLToPath(import.meta.url)),
      "../index.js"
    );

    if (actual.mainFile !== expected && MANIFEST.version !== actual.manifest.version) {
      // we have resolved node_modules/@typespec/compiler/dist/core/index.js and we want to get
      // to the shim executable node_modules/.bin/tsp-server
      const betterTypeSpecServerPath = resolvePath(actual.path, ".bin/tsp-server");
      program.reportDiagnostic(
        createDiagnostic({
          code: "compiler-version-mismatch",
          format: { basedir: baseDir, betterTypeSpecServerPath, actual: actual.mainFile, expected },
          target: NoTarget,
        })
      );
      return false;
    }

    return true;
  }

  function getOption(key: string): string | undefined {
    return (options.miscOptions || {})[key] as any;
  }

  function reportDiagnostic(diagnostic: Diagnostic): void {
    if (shouldSuppress(diagnostic)) {
      return;
    }

    if (options.warningAsError && diagnostic.severity === "warning") {
      diagnostic = { ...diagnostic, severity: "error" };
    }

    if (diagnostic.severity === "error") {
      error = true;
    }

    diagnostics.push(diagnostic);
  }

  function reportDiagnostics(newDiagnostics: Diagnostic[]) {
    for (const diagnostic of newDiagnostics) {
      reportDiagnostic(diagnostic);
    }
  }

  function shouldSuppress(diagnostic: Diagnostic): boolean {
    const { target } = diagnostic;
    if (diagnostic.code === "error") {
      diagnostics.push(diagnostic);
      return false;
    }

    if (target === NoTarget || target === undefined) {
      return false;
    }

    if ("file" in target) {
      return false; // No global file suppress yet.
    }

    const node = getNode(target);
    if (node === undefined) {
      return false; // Can't find target cannot be suppressed.
    }

    const suppressing = findDirectiveSuppressingOnNode(diagnostic.code, node);
    if (suppressing) {
      if (diagnostic.severity === "error") {
        // Cannot suppress errors.
        diagnostics.push({
          severity: "error",
          code: "suppress-error",
          message: "Errors cannot be suppressed.",
          target: suppressing.node,
        });

        return false;
      } else {
        return true;
      }
    }
    return false;
  }

  function findDirectiveSuppressingOnNode(code: string, node: Node): Directive | undefined {
    let current: Node | undefined = node;
    do {
      if (current.directives) {
        const directive = findDirectiveSuppressingCode(code, current.directives);
        if (directive) {
          return directive;
        }
      }
    } while ((current = current.parent));
    return undefined;
  }

  /**
   * Returns the directive node that is suppressing this code.
   * @param code Code to check for suppression.
   * @param directives List of directives.
   * @returns Directive suppressing this code if found, `undefined` otherwise
   */
  function findDirectiveSuppressingCode(
    code: string,
    directives: readonly DirectiveExpressionNode[]
  ): Directive | undefined {
    for (const directive of directives.map((x) => parseDirective(x))) {
      if (directive.name === "suppress") {
        if (directive.code === code) {
          return directive;
        }
      }
    }
    return undefined;
  }

  function parseDirective(node: DirectiveExpressionNode): Directive {
    const args = node.arguments.map((x) => {
      return x.kind === SyntaxKind.Identifier ? x.sv : x.value;
    });
    switch (node.target.sv) {
      case "suppress":
        return { name: "suppress", code: args[0], message: args[1], node };
      default:
        throw new Error("Unexpected directive name.");
    }
  }

  function getNode(target: Node | Type | Sym): Node | undefined {
    if (!("kind" in target)) {
      // symbol
      if (target.flags & SymbolFlags.Using) {
        return target.symbolSource!.declarations[0];
      }

      return target.declarations[0]; // handle multiple decls
    } else if (typeof target.kind === "number") {
      // node
      return target as Node;
    } else {
      // type
      return (target as Type).node;
    }
  }

  function reportDuplicateSymbols(symbols: SymbolTable | undefined) {
    if (!symbols) {
      return;
    }
    for (const set of symbols.duplicates.values()) {
      for (const symbol of set) {
        if (!duplicateSymbols.has(symbol)) {
          duplicateSymbols.add(symbol);
          const name = symbol.flags & SymbolFlags.Using ? symbol.symbolSource!.name : symbol.name;
          reportDiagnostic(
            createDiagnostic({
              code: "duplicate-symbol",
              format: { name },
              target: symbol,
            })
          );
        }
      }
    }
  }

  function getGlobalNamespaceType() {
    return program.checker.getGlobalNamespaceType();
  }

  function resolveTypeReference(reference: string): [Type | undefined, readonly Diagnostic[]] {
    const [node, parseDiagnostics] = parseStandaloneTypeReference(reference);
    if (parseDiagnostics.length > 0) {
      return [undefined, parseDiagnostics];
    }
    const binder = createBinder(program);
    binder.bindNode(node);
    mutate(node).parent = program.checker.getGlobalNamespaceNode();

    return program.checker.resolveTypeReference(node);
  }
}

export function createStateAccessors(
  stateMaps: Map<symbol, StateMap>,
  stateSets: Map<symbol, StateSet>,
  projector?: Projector
) {
  function stateMap<T>(key: symbol): StateMapView<T> {
    let m = stateMaps.get(key);

    if (!m) {
      m = new StateMap();
      stateMaps.set(key, m);
    }

    return new StateMapView(m, projector);
  }

  function stateSet(key: symbol): StateSetView {
    let s = stateSets.get(key);

    if (!s) {
      s = new StateSet();
      stateSets.set(key, s);
    }

    return new StateSetView(s, projector);
  }

  return { stateMap, stateSet };
}

/**
 * Resolve compiler options from input options.
 */
function resolveOptions(options: CompilerOptions): CompilerOptions {
  const outputDir = options.outputDir ?? options.outputPath;
  return {
    ...options,
    outputDir,
    outputPath: outputDir,
  };
}
