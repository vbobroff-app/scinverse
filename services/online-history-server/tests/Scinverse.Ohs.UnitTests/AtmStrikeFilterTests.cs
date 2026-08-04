using FluentAssertions;
using Scinverse.Ohs.Connectors.Transaq;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class AtmStrikeFilterTests
{
    [Fact]
    public void SelectOptCodes_TakesWindowAroundAtm()
    {
        var strikes = new List<OptionStrikeQuote>();
        foreach (var s in new[] { 100m, 110m, 120m, 130m, 140m })
        {
            strikes.Add(new OptionStrikeQuote(s, 'C', $"C{s}"));
            strikes.Add(new OptionStrikeQuote(s, 'P', $"P{s}"));
        }

        var codes = AtmStrikeFilter.SelectOptCodes(strikes, atmPrice: 121m, depth: 1);

        codes.Should().BeEquivalentTo(["C110", "P110", "C120", "P120", "C130", "P130"]);
    }

    [Fact]
    public void ParseFamilies_ReadsMatDates()
    {
        const string xml = """
            <option_families>
              <family><mat_date>16.07.2026</mat_date><lot_size>1</lot_size></family>
              <family><mat_date>17.09.2026</mat_date><lot_size>1</lot_size></family>
            </option_families>
            """;

        var families = TransaqOptionXml.ParseFamilies(xml);
        families.Select(f => f.Expiration).Should().Equal(
            new DateOnly(2026, 7, 16), new DateOnly(2026, 9, 17));
    }

    [Fact]
    public void ParseStrikes_ReadsOptCodes()
    {
        const string xml = """
            <family_strikes>
              <mat_date>16.07.2026</mat_date>
              <strike><price>82500</price><opt_type>C</opt_type><opt_code>RI82500BG6</opt_code></strike>
              <strike><strike>82500</strike><type>P</type><opt_code>RI82500BS6</opt_code></strike>
            </family_strikes>
            """;

        var strikes = TransaqOptionXml.ParseStrikes(xml);
        strikes.Should().HaveCount(2);
        strikes.Select(s => s.OptCode).Should().BeEquivalentTo(["RI82500BG6", "RI82500BS6"]);
    }
}
