import { Model, Namespace, Operation, Program, projectProgram } from "@typespec/compiler";
import {
  BasicTestRunner,
  createTestWrapper,
  expectDiagnosticEmpty,
  expectDiagnostics,
} from "@typespec/compiler/testing";
import { ok, strictEqual } from "assert";
import { buildVersionProjections } from "../src/versioning.js";
import { createVersioningTestHost, createVersioningTestRunner } from "./test-host.js";
import { assertHasProperties } from "./utils.js";

describe("versioning: reference versioned library", () => {
  let runner: BasicTestRunner;

  beforeEach(async () => {
    const host = await createVersioningTestHost();
    runner = createTestWrapper(host, {
      wrapper: (code) => `
      import "@typespec/versioning";
      using TypeSpec.Versioning;
      @versioned(Versions)
      namespace VersionedLib {
        enum Versions {l1, l2}
        model Foo {
          name: string;
          @added(Versions.l2) age: int32;
        }
      }
      ${code}`,
    });
  });

  function assertFooV1(foo: Model) {
    ok(foo.properties.has("name"));
    ok(!foo.properties.has("age"), "Age was added in version 2 and version 1 was selected.");
  }

  function assertFooV2(Foo: Model) {
    ok(Foo.properties.has("name"));
    ok(Foo.properties.has("age"), "Age was added in version 2 and version 1 was selected.");
  }

  describe("when project is not-versioned", () => {
    it("use a versioned library given version", async () => {
      const { MyService, Test } = (await runner.compile(`
        @useDependency(VersionedLib.Versions.l1)
        @test namespace MyService {
          @test model Test extends VersionedLib.Foo {}
        } 
    `)) as { MyService: Namespace; Test: Model };
      const versions = buildVersionProjections(runner.program, MyService);
      strictEqual(versions.length, 1);
      strictEqual(versions[0].version, undefined);
      strictEqual(versions[0].projections.length, 1);

      const projector = projectProgram(runner.program, versions[0].projections, Test).projector;
      const Foo = (projector.projectedTypes.get(Test) as any).baseModel;

      assertFooV1(Foo);
    });

    it("use multiple versioned libraries given version", async () => {
      const { MyService, Test, getBar } = (await runner.compile(`
        @versioned(Versions)
        namespace OtherVersionedLib {
          enum Versions {
            m1,
          }
          model Bar {};
        }
        @useDependency(VersionedLib.Versions.l1, OtherVersionedLib.Versions.m1)
        @test namespace MyService {
          @test model Test extends VersionedLib.Foo {}
          
          @test op getBar(): OtherVersionedLib.Bar;
        } 
    `)) as { MyService: Namespace; Test: Model; getBar: Operation };
      const versions = buildVersionProjections(runner.program, MyService);
      strictEqual(versions.length, 1);
      strictEqual(versions[0].version, undefined);
      strictEqual(versions[0].projections.length, 1);

      const projector = projectProgram(runner.program, versions[0].projections, Test).projector;
      const Foo = (projector.projectedTypes.get(Test) as any).baseModel;

      assertFooV1(Foo);
      ok((getBar.returnType as Model).name === "Bar");
      ok((getBar.returnType as Model).namespace?.name === "OtherVersionedLib");
    });

    it("emit diagnostic if passing anything but an enum member", async () => {
      const diagnostics = await runner.diagnose(`
        @useDependency([[VersionedLib.Versions.l1, VersionedLib.Versions.l1]])
        namespace MyService {
          model Test extends VersionedLib.Foo {}
        } 
    `);
      expectDiagnostics(diagnostics, {
        code: "invalid-argument",
        message:
          "Argument '[[VersionedLib.Versions.l1, VersionedLib.Versions.l1]]' is not assignable to parameter of type 'TypeSpec.Reflection.EnumMember'",
      });
    });
  });

  describe("when project is versioned", () => {
    it("use a versioned library given version", async () => {
      const { MyService, Test } = (await runner.compile(`
        @versioned(Versions)
        @test namespace MyService {
          enum Versions {
            @useDependency(VersionedLib.Versions.l1)
            v1,
            @useDependency(VersionedLib.Versions.l2)
            v2
          }
          @test model Test extends VersionedLib.Foo {}
        } 
    `)) as { MyService: Namespace; Test: Model };
      const versions = buildVersionProjections(runner.program, MyService);
      strictEqual(versions.length, 2);
      strictEqual(versions[0].version, "v1");
      strictEqual(versions[1].version, "v2");

      const projectorV1 = projectProgram(runner.program, versions[0].projections, Test).projector;
      const FooV1 = (projectorV1.projectedTypes.get(Test) as any).baseModel;

      assertFooV1(FooV1);

      const projectorV2 = projectProgram(runner.program, versions[1].projections, Test).projector;
      const FooV2 = (projectorV2.projectedTypes.get(Test) as any).baseModel;
      assertFooV2(FooV2);
    });

    it("use the same versioned library version for multiple service versions", async () => {
      const { MyService, Test } = (await runner.compile(`
        @versioned(Versions)
        @test namespace MyService {
          enum Versions {
            @useDependency(VersionedLib.Versions.l1)
            v1,
            @useDependency(VersionedLib.Versions.l1)
            v2
          }
          @test model Test extends VersionedLib.Foo {}
        } 
    `)) as { MyService: Namespace; Test: Model };
      const versions = buildVersionProjections(runner.program, MyService);
      strictEqual(versions.length, 2);
      strictEqual(versions[0].version, "v1");
      strictEqual(versions[1].version, "v2");

      const projectorV1 = projectProgram(runner.program, versions[0].projections, Test).projector;
      const FooV1 = (projectorV1.projectedTypes.get(Test) as any).baseModel;

      assertFooV1(FooV1);

      const projectorV2 = projectProgram(runner.program, versions[1].projections, Test).projector;
      const FooV2 = (projectorV2.projectedTypes.get(Test) as any).baseModel;
      assertFooV1(FooV2);
    });

    it("emit diagnostic if @useDependency and @versioned are used on a Namespace", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        @useDependency(VersionedLib.Versions.l1)
        namespace MyService {
          enum Versions {v1, v2}
          model Test extends VersionedLib.Foo {}
        } 
    `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/incompatible-versioned-namespace-use-dependency",
        message:
          "The useDependency decorator can only be used on a Namespace if the namespace is unversioned. For versioned namespaces, put the useDependency decorator on the version enum members.",
      });
    });

    it("emit diagnostic if @useDependency is used on an enum that isn't in the namespace.", async () => {
      const diagnostics = await runner.diagnose(`
        enum TestServiceVersions {
          @useDependency(VersionedLib.Versions.l1)
          v1,
          @useDependency(VersionedLib.Versions.l2)
          v2,
        }
        @versioned(TestServiceVersions)
        namespace TestService {
          @added(TestServiceVersions.v2)
          op test(): VersionedLib.Foo;
        }
      `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/version-not-found",
        message:
          "The provided version 'v2' from 'TestServiceVersions' is not declared as a version enum. Use '@versioned(TestServiceVersions)' on the containing namespace.",
      });
    });
  });

  describe("when using versioned library without @useDependency", () => {
    it("emit diagnostic when used in extends", async () => {
      const diagnostics = await runner.diagnose(`
        namespace MyService {
          model Test extends VersionedLib.Foo {}
        } 
    `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/using-versioned-library",
        message:
          "Namespace 'MyService' is referencing types from versioned namespace 'VersionedLib' but didn't specify which versions with @useDependency.",
      });
    });

    it("emit diagnostic when used in properties", async () => {
      const diagnostics = await runner.diagnose(`
        namespace MyService {
          model Test {
            foo: VersionedLib.Foo
          }
        } 
    `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/using-versioned-library",
        message:
          "Namespace 'MyService' is referencing types from versioned namespace 'VersionedLib' but didn't specify which versions with @useDependency.",
      });
    });

    it("emit diagnostic when project has no namespace", async () => {
      const diagnostics = await runner.diagnose(`
        model Test extends VersionedLib.Foo {}
    `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/using-versioned-library",
        message:
          "Namespace '' is referencing types from versioned namespace 'VersionedLib' but didn't specify which versions with @useDependency.",
      });
    });

    it("doesn't emit diagnostic when versioned library use templated type from non versioned lib", async () => {
      const diagnostics = await runner.diagnose(`
        namespace NonVersioned {
          model Foo<T> {
            foo: T;
          }
        }
        @versioned(Versions)
        namespace MyService {
          enum Versions {v1, v2}
          
          model Bar {}
          model Test extends NonVersioned.Foo<Bar> {}
        } 
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("doesn't emit diagnostic when extends interface of non versioned lib", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace MyService {
          enum Versions {v1, v2}
          
          model Foo {}
          interface Test {
            test(): Foo;
          }
        } 
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("doesn't emit diagnostic using union in non versioned lib", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace DemoService {
          enum Versions {v1, v2}
          
          model Foo {}
          interface Test extends NonVersioned.Foo<Foo> {}
        }
        namespace NonVersioned {
          interface Foo<T> {
            foo(): T | {};
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });
  });

  describe("sub namespace of versioned namespace", () => {
    it("doesn't emit diagnostic when parent namespace is versioned and using type from it", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace DemoService {
          enum Versions {v1, v2}
          
          model Foo {}
          namespace SubNamespace {
            op use(): Foo;
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("doesn't emit diagnostic when referencing to versioned library from subnamespace with parent namespace with versioned dependency", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace Lib {
          enum Versions {v1, v2}
          
          model Foo {}
        }
        @useDependency(Lib.Versions.v1)
        namespace MyService {
          namespace SubNamespace {
            op use(): Lib.Foo;
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("succeed if sub namespace of versioned service reference versioned library", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace Lib {
          enum Versions {v1, v2}
          
          model Foo {}
        }
        @versioned(Versions)
        namespace MyService {
          enum Versions {
            @useDependency(Lib.Versions.v1)
            m1
          }
          namespace SubNamespace {
            op use(): Lib.Foo;
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("succeed if versioned service reference sub namespace type", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace MyService {
          enum Versions {m1}
          op use(): SubNamespace.Foo;
          namespace SubNamespace {
            model Foo {}
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("succeed reference versioned library sub namespace", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace Lib {
          enum Versions {v1, v2}
          namespace LibSub {
            model Foo {}
          }
        }
        @versioned(Versions)
        namespace MyService {
          enum Versions {
            @useDependency(Lib.Versions.v1)
            m1
          }
          namespace ServiceSub {
            op use(): Lib.LibSub.Foo;
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("emit diagnostic when used in properties of generic type", async () => {
      const diagnostics = await runner.diagnose(`
        namespace MyService {
          model Test<T> {
            t: T;
            foo: VersionedLib.Foo
          }
        } 
    `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/using-versioned-library",
        message:
          "Namespace 'MyService' is referencing types from versioned namespace 'VersionedLib' but didn't specify which versions with @useDependency.",
      });
    });
  });
});

describe("versioning (deprecated): reference versioned library (@versionedDependency)", () => {
  let runner: BasicTestRunner;

  beforeEach(async () => {
    const host = await createVersioningTestHost();
    runner = createTestWrapper(host, {
      wrapper: (code) => `
      import "@typespec/versioning";
      using TypeSpec.Versioning;
      @versioned(Versions)
      namespace VersionedLib {
        enum Versions {l1, l2}
        model Foo {
          name: string;
          @added(Versions.l2) age: int32;
        }
      }
      ${code}`,
    });
  });

  function assertFooV1(foo: Model) {
    ok(foo.properties.has("name"));
    ok(!foo.properties.has("age"), "Age was added in version 2 and version 1 was selected.");
  }

  function assertFooV2(Foo: Model) {
    ok(Foo.properties.has("name"));
    ok(Foo.properties.has("age"), "Age was added in version 2 and version 1 was selected.");
  }

  describe("when project is not-versioned", () => {
    it("use a versioned library given version", async () => {
      const { MyService, Test } = (await runner.compile(`
        #suppress "deprecated"
        @versionedDependency(VersionedLib.Versions.l1)
        @test namespace MyService {
          @test model Test extends VersionedLib.Foo {}
        } 
    `)) as { MyService: Namespace; Test: Model };
      const versions = buildVersionProjections(runner.program, MyService);
      strictEqual(versions.length, 1);
      strictEqual(versions[0].version, undefined);
      strictEqual(versions[0].projections.length, 1);

      const projector = projectProgram(runner.program, versions[0].projections, Test).projector;
      const Foo = (projector.projectedTypes.get(Test) as any).baseModel;

      assertFooV1(Foo);
    });

    it("emit diagnostic if passing version mapping", async () => {
      const diagnostics = await runner.diagnose(`
        #suppress "deprecated"
        @versionedDependency([[VersionedLib.Versions.l1, VersionedLib.Versions.l1]])
        namespace MyService {
          model Test extends VersionedLib.Foo {}
        } 
    `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/versioned-dependency-not-picked",
        message:
          "The versionedDependency decorator must provide a version of the dependency 'VersionedLib'.",
      });
    });
  });

  describe("when project is versioned", () => {
    it("use a versioned library given version", async () => {
      const { MyService, Test } = (await runner.compile(`
        #suppress "deprecated"
        @versioned(Versions)
        @versionedDependency([[Versions.v1, VersionedLib.Versions.l1], [Versions.v2, VersionedLib.Versions.l2]])
        @test namespace MyService {
          enum Versions {v1, v2}
          @test model Test extends VersionedLib.Foo {}
        } 
    `)) as { MyService: Namespace; Test: Model };
      const versions = buildVersionProjections(runner.program, MyService);
      strictEqual(versions.length, 2);
      strictEqual(versions[0].version, "v1");
      strictEqual(versions[1].version, "v2");

      const projectorV1 = projectProgram(runner.program, versions[0].projections, Test).projector;
      const FooV1 = (projectorV1.projectedTypes.get(Test) as any).baseModel;

      assertFooV1(FooV1);

      const projectorV2 = projectProgram(runner.program, versions[1].projections, Test).projector;
      const FooV2 = (projectorV2.projectedTypes.get(Test) as any).baseModel;
      assertFooV2(FooV2);
    });

    it("use the same versioned library version for multiple service versions", async () => {
      const { MyService, Test } = (await runner.compile(`
        #suppress "deprecated"
        @versioned(Versions)
        @versionedDependency([[Versions.v1, VersionedLib.Versions.l1], [Versions.v2, VersionedLib.Versions.l1]])
        @test namespace MyService {
          enum Versions {v1, v2}
          @test model Test extends VersionedLib.Foo {}
        } 
    `)) as { MyService: Namespace; Test: Model };
      const versions = buildVersionProjections(runner.program, MyService);
      strictEqual(versions.length, 2);
      strictEqual(versions[0].version, "v1");
      strictEqual(versions[1].version, "v2");

      const projectorV1 = projectProgram(runner.program, versions[0].projections, Test).projector;
      const FooV1 = (projectorV1.projectedTypes.get(Test) as any).baseModel;

      assertFooV1(FooV1);

      const projectorV2 = projectProgram(runner.program, versions[1].projections, Test).projector;
      const FooV2 = (projectorV2.projectedTypes.get(Test) as any).baseModel;
      assertFooV1(FooV2);
    });

    it("emit diagnostic if passing a specific version", async () => {
      const diagnostics = await runner.diagnose(`
        #suppress "deprecated"
        @versioned(Versions)
        @versionedDependency(VersionedLib.Versions.l1)
        namespace MyService {
          enum Versions {v1, v2}
          model Test extends VersionedLib.Foo {}
        } 
    `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/versioned-dependency-record-not-mapping",
        message:
          "The versionedDependency decorator must provide a model mapping local versions to dependency 'VersionedLib' versions",
      });
    });
  });

  describe("sub namespace of versioned namespace", () => {
    it("doesn't emit diagnostic when parent namespace is versioned and using type from it", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace DemoService {
          enum Versions {v1, v2}
          
          model Foo {}
          namespace SubNamespace {
            op use(): Foo;
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("doesn't emit diagnostic when referencing to versioned library from subnamespace with parent namespace with versioned dependency", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace Lib {
          enum Versions {v1, v2}
          
          model Foo {}
        }
        #suppress "deprecated"
        @versionedDependency(Lib.Versions.v1)
        namespace MyService {
          namespace SubNamespace {
            op use(): Lib.Foo;
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("succeed if sub namespace of versioned service reference versioned library", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace Lib {
          enum Versions {v1, v2}
          
          model Foo {}
        }
        #suppress "deprecated"
        @versioned(Versions)
        @versionedDependency([[Versions.m1, Lib.Versions.v1]])
        namespace MyService {
          enum Versions {m1}
          namespace SubNamespace {
            op use(): Lib.Foo;
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("succeed if versioned service reference sub namespace type", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace MyService {
          enum Versions {m1}
          op use(): SubNamespace.Foo;
          namespace SubNamespace {
            model Foo {}
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("succeed reference versioned library sub namespace", async () => {
      const diagnostics = await runner.diagnose(`
        @versioned(Versions)
        namespace Lib {
          enum Versions {v1, v2}
          namespace LibSub {
            model Foo {}
          }
        }
        #suppress "deprecated"
        @versioned(Versions)
        @versionedDependency([[Versions.m1, Lib.Versions.v1]])
        namespace MyService {
          enum Versions {m1}
          namespace ServiceSub {
            op use(): Lib.LibSub.Foo;
          }
        }
    `);
      expectDiagnosticEmpty(diagnostics);
    });

    it("emit diagnostic when used in properties of generic type", async () => {
      const diagnostics = await runner.diagnose(`
        namespace MyService {
          model Test<T> {
            t: T;
            foo: VersionedLib.Foo
          }
        } 
    `);
      expectDiagnostics(diagnostics, {
        code: "@typespec/versioning/using-versioned-library",
        message:
          "Namespace 'MyService' is referencing types from versioned namespace 'VersionedLib' but didn't specify which versions with @useDependency.",
      });
    });
  });
});

describe("versioning (deprecated): dependencies (@versionedDependency)", () => {
  let runner: BasicTestRunner;

  beforeEach(async () => {
    runner = await createVersioningTestRunner();
  });

  it("can spread versioned model from another library", async () => {
    const { MyService, Test } = (await runner.compile(`
      @versioned(Versions)
      namespace VersionedLib {
        enum Versions {l1, l2}
        model Spread<T> {
          t: string;
          ...T;
        }
      }
      #suppress "deprecated"
      @versioned(Versions)
      @versionedDependency([[Versions.v1, VersionedLib.Versions.l1], [Versions.v2, VersionedLib.Versions.l2]])
      @test namespace MyService {
        enum Versions {v1, v2}
        model Spreadable {
          a: int32;
          @added(Versions.v2) b: int32;
        }
        @test model Test extends VersionedLib.Spread<Spreadable> {}
      }
      `)) as { MyService: Namespace; Test: Model };

    const [v1, v2] = runProjections(runner.program, MyService);

    const SpreadInstance1 = (v1.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance1, ["t", "a"]);
    const SpreadInstance2 = (v2.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance2, ["t", "a", "b"]);
  });

  it("can handle when the versions name are the same across different libraries", async () => {
    const { MyService, Test } = (await runner.compile(`
      @versioned(Versions)
      namespace VersionedLib {
        enum Versions {v1, v2}
        model Spread<T> {
          t: string;
          ...T;
        }
      }
      #suppress "deprecated"
      @versioned(Versions)
      @versionedDependency([[Versions.v1, VersionedLib.Versions.v1], [Versions.v2, VersionedLib.Versions.v2]])
      @test namespace MyService {
        enum Versions {v1, v2}
        model Spreadable {
          a: int32;
          @added(Versions.v2) b: int32;
        }
        @test model Test extends VersionedLib.Spread<Spreadable> {}
      }
      `)) as { MyService: Namespace; Test: Model };

    const [v1, v2] = runProjections(runner.program, MyService);

    const SpreadInstance1 = (v1.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance1, ["t", "a"]);
    const SpreadInstance2 = (v2.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance2, ["t", "a", "b"]);
  });

  // Test for https://github.com/microsoft/typespec/issues/760
  it("have a nested service namespace", async () => {
    const { MyService } = (await runner.compile(`
        #suppress "deprecated"
        @service({title: "Test"})
        @versionedDependency(Lib.Versions.v1)
        @test("MyService")
        namespace MyOrg.MyService {
        }
        @versioned(Versions)
        namespace Lib {
          enum Versions {
            v1: "v1",
          }
        }
      `)) as { MyService: Namespace };

    const [v1] = runProjections(runner.program, MyService);
    ok(v1.projectedTypes.get(MyService));
  });

  // Test for https://github.com/microsoft/typespec/issues/786
  it("have a nested service namespace and libraries sharing common parent namespace", async () => {
    const { MyService } = (await runner.compile(`
        #suppress "deprecated"
        @service({title: "Test"})
        @versionedDependency(Lib.One.Versions.v1)
        @test("MyService")
        namespace MyOrg.MyService {
        }
        @versioned(Versions)
        namespace Lib.One {
          enum Versions { v1: "v1" }
        }
        
        #suppress "deprecated"
        @versionedDependency(Lib.One.Versions.v1)
        namespace Lib.Two { }
      `)) as { MyService: Namespace };

    const [v1] = runProjections(runner.program, MyService);
    ok(v1.projectedTypes.get(MyService));
  });
});

describe("versioning: dependencies", () => {
  let runner: BasicTestRunner;

  beforeEach(async () => {
    runner = await createVersioningTestRunner();
  });

  it("use model defined in non versioned library spreading properties", async () => {
    const { MyService, Test } = (await runner.compile(`
      namespace NonVersionedLib {
        enum Versions {l1, l2}
        model Spread<T> {
          t: string;
          ...T;
        }
      }
      @versioned(Versions)
      @test namespace MyService {
        enum Versions {v1, v2}
        model Spreadable {
          a: int32;
          @added(Versions.v2) b: int32;
        }
        @test model Test extends NonVersionedLib.Spread<Spreadable> {}
      }
      `)) as { MyService: Namespace; Test: Model };

    const [v1, v2] = runProjections(runner.program, MyService);

    const SpreadInstance1 = (v1.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance1, ["t", "a"]);
    const SpreadInstance2 = (v2.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance2, ["t", "a", "b"]);
  });

  it("can spread versioned model from another library", async () => {
    const { MyService, Test } = (await runner.compile(`
      @versioned(Versions)
      namespace VersionedLib {
        enum Versions {l1, l2}
        model Spread<T> {
          t: string;
          ...T;
        }
      }
      @versioned(Versions)
      @test namespace MyService {
        enum Versions {
          @useDependency(VersionedLib.Versions.l1)
          v1,
          @useDependency(VersionedLib.Versions.l2)
          v2
        }
        model Spreadable {
          a: int32;
          @added(Versions.v2) b: int32;
        }
        @test model Test extends VersionedLib.Spread<Spreadable> {}
      }
      `)) as { MyService: Namespace; Test: Model };

    const [v1, v2] = runProjections(runner.program, MyService);

    const SpreadInstance1 = (v1.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance1, ["t", "a"]);
    const SpreadInstance2 = (v2.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance2, ["t", "a", "b"]);
  });

  it("can handle when the versions name are the same across different libraries", async () => {
    const { MyService, Test } = (await runner.compile(`
      @versioned(Versions)
      namespace VersionedLib {
        enum Versions {v1, v2}
        model Spread<T> {
          t: string;
          ...T;
        }
      }
      @versioned(Versions)
      @test namespace MyService {
        enum Versions {
          @useDependency(VersionedLib.Versions.v1)
          v1,
          @useDependency(VersionedLib.Versions.v2)
          v2
        }
        model Spreadable {
          a: int32;
          @added(Versions.v2) b: int32;
        }
        @test model Test extends VersionedLib.Spread<Spreadable> {}
      }
      `)) as { MyService: Namespace; Test: Model };

    const [v1, v2] = runProjections(runner.program, MyService);

    const SpreadInstance1 = (v1.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance1, ["t", "a"]);
    const SpreadInstance2 = (v2.projectedTypes.get(Test) as any).baseModel;
    assertHasProperties(SpreadInstance2, ["t", "a", "b"]);
  });

  // Test for https://github.com/microsoft/typespec/issues/760
  it("have a nested service namespace", async () => {
    const { MyService } = (await runner.compile(`
        @service({title: "Test"})
        @useDependency(Lib.Versions.v1)
        @test("MyService")
        namespace MyOrg.MyService {
        }
        @versioned(Versions)
        namespace Lib {
          enum Versions {
            v1: "v1",
          }
        }
      `)) as { MyService: Namespace };

    const [v1] = runProjections(runner.program, MyService);
    ok(v1.projectedTypes.get(MyService));
  });

  // Test for https://github.com/microsoft/typespec/issues/786
  it("have a nested service namespace and libraries sharing common parent namespace", async () => {
    const { MyService } = (await runner.compile(`
        @service({title: "Test"})
        @useDependency(Lib.One.Versions.v1)
        @test("MyService")
        namespace MyOrg.MyService {
        }
        @versioned(Versions)
        namespace Lib.One {
          enum Versions { v1: "v1" }
        }
        
        @useDependency(Lib.One.Versions.v1)
        namespace Lib.Two { }
      `)) as { MyService: Namespace };

    const [v1] = runProjections(runner.program, MyService);
    ok(v1.projectedTypes.get(MyService));
  });
});

function runProjections(program: Program, rootNs: Namespace) {
  const versions = buildVersionProjections(program, rootNs);
  return versions.map((x) => projectProgram(program, x.projections).projector);
}
