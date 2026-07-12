using FluentAssertions;
using Scinverse.Ohs.Domain.Moex;

namespace Scinverse.Ohs.UnitTests;

public sealed class FuturesAssetTaxonomyTests
{
    [Theory]
    [InlineData("Si", FuturesAssetTaxonomy.Currency)]
    [InlineData("Eu", FuturesAssetTaxonomy.Currency)]
    [InlineData("CNY", FuturesAssetTaxonomy.Currency)]
    [InlineData("BR", FuturesAssetTaxonomy.Commodity)]
    [InlineData("GOLD", FuturesAssetTaxonomy.Commodity)]
    [InlineData("MIX", FuturesAssetTaxonomy.Index)]
    [InlineData("RTS", FuturesAssetTaxonomy.Index)]
    [InlineData("RUON", FuturesAssetTaxonomy.Rate)]
    public void Seed_ClassifiesKnownCodes(string assetCode, string expectedCategory)
    {
        FuturesAssetTaxonomy.TryClassifySeed(assetCode, out var hit).Should().BeTrue();
        hit.Category.Should().Be(expectedCategory);
    }

    [Fact]
    public void Seed_IsCaseInsensitive()
    {
        FuturesAssetTaxonomy.TryClassifySeed("si", out var hit).Should().BeTrue();
        hit.Category.Should().Be(FuturesAssetTaxonomy.Currency);
    }

    [Fact]
    public void Seed_ReturnsFalse_ForUnknownCode()
    {
        FuturesAssetTaxonomy.TryClassifySeed("ZZZZ", out _).Should().BeFalse();
    }

    [Theory]
    [InlineData("stock_shares", FuturesAssetTaxonomy.Shares)]
    [InlineData("stock_dr", FuturesAssetTaxonomy.Shares)]
    [InlineData("stock_index", FuturesAssetTaxonomy.Index)]
    [InlineData("stock_index_if", FuturesAssetTaxonomy.Index)]
    [InlineData("currency_selt", FuturesAssetTaxonomy.Currency)]
    [InlineData("stock_bonds", FuturesAssetTaxonomy.Other)]
    [InlineData(null, FuturesAssetTaxonomy.Other)]
    [InlineData("", FuturesAssetTaxonomy.Other)]
    public void CategoryFromIssGroup_MapsGroups(string? group, string expected)
    {
        FuturesAssetTaxonomy.CategoryFromIssGroup(group).Should().Be(expected);
    }
}
