using FluentAssertions;
using Scinverse.Ohs.Domain;

namespace Scinverse.Ohs.UnitTests;

public sealed class CatchUpEscalationAtTests
{
    private static readonly TimeSpan T = TimeSpan.FromSeconds(60);

    [Fact]
    public void Transaq_elapsed_ge_T_returns_since_plus_T()
    {
        var since = DateTimeOffset.Parse("2026-07-28T06:44:49Z");
        var at = since.AddMinutes(33);
        LinkOwnership.CatchUpEscalationAt("transaq", since, at, T)
            .Should().Be(since.Add(T));
    }

    [Fact]
    public void Transaq_elapsed_lt_T_returns_null()
    {
        var since = DateTimeOffset.Parse("2026-07-28T06:44:49Z");
        var at = since.AddSeconds(45);
        LinkOwnership.CatchUpEscalationAt("transaq", since, at, T)
            .Should().BeNull();
    }

    [Fact]
    public void Supervisor_owner_returns_null()
    {
        var since = DateTimeOffset.Parse("2026-07-28T06:44:49Z");
        var at = since.AddMinutes(10);
        LinkOwnership.CatchUpEscalationAt("supervisor", since, at, T)
            .Should().BeNull();
    }
}
