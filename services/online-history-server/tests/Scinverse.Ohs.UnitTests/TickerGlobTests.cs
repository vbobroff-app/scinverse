using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class TickerGlobTests
{
    [Theory]
    [InlineData("Si-9.26", "Si-*.*", true)]
    [InlineData("Si-12.26", "Si-*.*", true)]
    [InlineData("RIU6", "Si-*.*", false)]
    [InlineData("RTS-12.26", "RTS-*.2[0-9]", true)]
    [InlineData("RTS-3.27", "RTS-*.2[0-9]", true)]
    [InlineData("RTS-12.19", "RTS-*.2[0-9]", false)]
    [InlineData("si-9.26", "Si-*.*", true)] // ignore-case
    [InlineData("SBRF-3.26", "SBRF-*.*", true)]
    [InlineData("Si-9.26", "Si-?.26", true)]
    [InlineData("Si-12.26", "Si-?.26", false)]
    public void IsMatch_single_pattern(string ticker, string pattern, bool expected) =>
        TickerGlob.IsMatch(ticker, pattern).Should().Be(expected);

    [Fact]
    public void IsMatch_patterns_are_or()
    {
        string[] patterns = ["RTS-*.2[0-9]", "SBRF-*.*", "Si-*.*"];
        TickerGlob.IsMatch("Si-9.26", patterns).Should().BeTrue();
        TickerGlob.IsMatch("SBRF-12.26", patterns).Should().BeTrue();
        TickerGlob.IsMatch("BR-3.26", patterns).Should().BeFalse();
    }

    [Fact]
    public void IsMatch_empty_patterns_is_false() =>
        TickerGlob.IsMatch("Si-9.26", Array.Empty<string>()).Should().BeFalse();

    [Fact]
    public void Compile_matches_short_codes_and_is_fast_on_large_set()
    {
        var match = TickerGlob.Compile(["Si*", "RTS*"]);
        match("SiU6").Should().BeTrue();
        match("Si-9.26").Should().BeTrue();
        match("RIU6").Should().BeFalse();

        // Регрессия зависания preview: Compiled regex один раз, не на каждый тикер.
        var tickers = Enumerable.Range(0, 40_000).Select(i => $"XX{i}").Append("SiU6").ToArray();
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var hits = tickers.Count(match);
        sw.Stop();
        hits.Should().Be(1);
        sw.ElapsedMilliseconds.Should().BeLessThan(500);
    }
}
