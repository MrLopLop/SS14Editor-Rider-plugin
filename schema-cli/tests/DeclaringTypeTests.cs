using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Content.Editor.Tests.Fixtures;
using Xunit;

#pragma warning disable CS0649 // Fixture fields are never written: they exist for reflection only.

namespace Content.Editor.Tests
{
    using Content.Editor.Editor;

    /// <summary>
    /// <see cref="FieldMetadata.DeclaringType"/> — the class whose source declares
    /// a field, so the editor can jump to an inherited one (not vendored).
    /// </summary>
    public class DeclaringTypeTests : IDisposable
    {
        private readonly MetadataLoadContext _mlc;
        private readonly Assembly _asm;
        private readonly FieldExtractor _extractor;

        public DeclaringTypeTests()
        {
            var testDll = typeof(DeclaringTypeTests).Assembly.Location;
            var dir = Path.GetDirectoryName(testDll)!;
            var runtimeDir = Path.GetDirectoryName(typeof(object).Assembly.Location)!;
            var allPaths = Directory.GetFiles(dir, "*.dll").Concat(Directory.GetFiles(runtimeDir, "*.dll"))
                .GroupBy(Path.GetFileName).Select(g => g.First()).ToList();
            _mlc = new MetadataLoadContext(new PathAssemblyResolver(allPaths), "System.Runtime");
            _asm = _mlc.LoadFromAssemblyPath(testDll);
            _extractor = new FieldExtractor(new XmlDocReader(), new Dictionary<string, DataDefinitionMetadata>());
        }

        public void Dispose() => _mlc.Dispose();

        private FieldMetadata Field(string typeName, string member) =>
            _extractor.ExtractDataFields(_asm.GetTypes().First(t => t.FullName == typeName))
                .Single(f => f.Name == member);

        [Fact]
        public void NamesTheTypeItselfForItsOwnField()
        {
            Assert.Equal(
                "Content.Editor.Tests.Fixtures.FixtureConcreteEffect",
                Field("Content.Editor.Tests.Fixtures.FixtureConcreteEffect", "Message").DeclaringType);
        }

        [Fact]
        public void NamesTheBaseClassForAnInheritedField()
        {
            Assert.Equal(
                "Content.Editor.Tests.Fixtures.FixtureBaseEffect",
                Field("Content.Editor.Tests.Fixtures.FixtureConcreteEffect", "Probability").DeclaringType);
        }

        [Fact]
        public void NamesTheOpenGenericDefinitionForAFieldOfAClosedGenericBase()
        {
            Assert.Equal(
                "Content.Editor.Tests.DeclaringTypeFixtures.GenericBase`1",
                Field("Content.Editor.Tests.DeclaringTypeFixtures.ClosedGenericChild", "Value").DeclaringType);
        }

        [Fact]
        public void NamesANestedClassWithAPlus()
        {
            Assert.Equal(
                "Content.Editor.Tests.DeclaringTypeFixtures.Outer+Inner",
                Field("Content.Editor.Tests.DeclaringTypeFixtures.Outer+Inner", "Depth").DeclaringType);
        }

        [Fact]
        public void NamesAClassNestedInAGenericOneByItsOpenDefinition()
        {
            Assert.Equal(
                "Content.Editor.Tests.DeclaringTypeFixtures.GenericOuter`1+Inner",
                Field("Content.Editor.Tests.DeclaringTypeFixtures.GenericOuter`1+Inner", "Depth").DeclaringType);
        }
    }
}

namespace Content.Editor.Tests.DeclaringTypeFixtures
{
    internal abstract class GenericBase<T>
    {
        [DataField] public T? Value;
    }

    internal sealed class ClosedGenericChild : GenericBase<int>
    {
        [DataField] public string? Label;
    }

    internal static class Outer
    {
        internal sealed class Inner
        {
            [DataField] public int Depth;
        }
    }

    internal abstract class GenericOuter<T>
    {
        internal sealed class Inner
        {
            [DataField] public int Depth;
        }
    }
}
